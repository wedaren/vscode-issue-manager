/**
 * Chrome 扩展后台脚本
 * 负责协调 Side Panel 和 Content Script 之间的通信
 */

const DEFAULT_VSCODE_NOTE_SERVER_URL = 'http://localhost:37892/create-note';
const SERVER_URL_STORAGE_KEY = 'issueManager.vscodeNoteServerUrl';
const URI_FALLBACK_MAX_LENGTH = 60000; // 避免超长 vscode:// 链接导致失败

// --- Promise 封装：兼容部分环境下 chrome.* 不返回 Promise 的情况 ---
/**
 * 使用现代 Chrome 扩展 Promise API 的轻量别名。
 * 如需兼容更旧环境，请在外部引入 polyfill，而非在此处做回调封装。
 */
const api = {
  tabsQuery: (queryInfo) => chrome.tabs.query(queryInfo),
  tabsSendMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
  tabsGet: (tabId) => chrome.tabs.get(tabId),
  tabsCreate: (createProperties) => chrome.tabs.create(createProperties),
  tabsRemove: (tabId) => chrome.tabs.remove(tabId),
  runtimeSendMessage: (message) => chrome.runtime.sendMessage(message)
};

async function getServerUrl() {
  try {
    const data = await chrome.storage?.sync?.get?.(SERVER_URL_STORAGE_KEY) || await chrome.storage?.local?.get?.(SERVER_URL_STORAGE_KEY) || {};
    return data[SERVER_URL_STORAGE_KEY] || DEFAULT_VSCODE_NOTE_SERVER_URL;
  } catch (_) {
    return DEFAULT_VSCODE_NOTE_SERVER_URL;
  }
}

async function postToServerWithRetry(url, body, retries = 1, timeoutMs = 5000) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${res.statusText}${text ? ` - ${text.slice(0,200)}` : ''}`);
      }
      return res;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      // 仅在网络错误/超时情况下重试一次
      const isAbort = e?.name === 'AbortError';
      const isNetwork = e && /Failed to fetch|TypeError/i.test(String(e));
      if (attempt < retries && (isAbort || isNetwork)) {
        await new Promise(r => setTimeout(r, 300));
        continue;
      }
      break;
    }
  }
  throw lastErr;
}

// 监听扩展图标点击事件，打开 Side Panel
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// 监听来自 Side Panel 和 Content Script 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message);

  switch (message.type) {
    case 'START_SELECTION':
      // Side Panel 请求开始选取
      (async () => {
        try {
          await handleStartSelection(message.tabId || sender.tab?.id);
          sendResponse({ success: true });
        } catch (e) {
          console.error('Failed to activate selection mode:', e);
          sendResponse({ success: false, error: e?.message || String(e) });
        }
      })();
      break;

    case 'CONTENT_SELECTED':
      // Content Script 发送选中的内容
      handleContentSelected(message.data);
      sendResponse({ success: true });
      break;

    case 'CANCEL_SELECTION':
      // 取消选取
      handleCancelSelection(message.tabId || sender.tab?.id);
      sendResponse({ success: true });
      break;

    default:
      console.warn('Unknown message type:', message.type);
      sendResponse({ success: false, error: 'Unknown message type' });
  }

  return true; // 保持消息通道开启
});

/**
 * 处理开始选取请求
 */
async function handleStartSelection(tabId) {
  if (!tabId) {
    // 尝试获取当前活动标签页作为后备
    try {
      const [activeTab] = await api.tabsQuery({ active: true, currentWindow: true });
      tabId = activeTab?.id;
    } catch (e) {
      console.error('Failed to query active tab:', e);
    }

    if (!tabId) {
      console.error('No tab ID provided');
      // 通知 Side Panel 报错，便于用户感知
      notifySidePanel({ type: 'CREATION_ERROR', error: '无法获取当前标签页，无法进入选取模式。' });
      return;
    }
  }

  try {
    // 尝试直接通知 Content Script
    await api.tabsSendMessage(tabId, { type: 'START_SELECTION' });
    console.log('Selection mode activated in tab', tabId);
    return;
  } catch (error) {
    console.warn('First attempt to activate selection failed, trying to inject content script...', error);
  }

  // 首次失败：尝试注入 content script 后重试
  try {
    await ensureContentScriptInjected(tabId);
    await api.tabsSendMessage(tabId, { type: 'START_SELECTION' });
    console.log('Selection mode activated after injection in tab', tabId);
  } catch (error) {
    // 检查是否为受限页面
    try {
      const tab = await api.tabsGet(tabId);
      const url = tab?.url || '';
      if (/^(chrome|chrome-extension|edge|about|chrome-search):/i.test(url) || /chromewebstore\.google\.com/i.test(url)) {
        throw new Error('该页面不支持内容脚本（如 chrome:// 或 Chrome Web Store），无法进入选取模式。请在普通网页中重试。');
      }
    } catch (_) {
      // 忽略 tabs.get 错误，仅抛出通用错误
    }
    throw error;
  }
}

/**
 * 确保已注入 Content Script（幂等）
 */
async function ensureContentScriptInjected(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content/content.js']
    });
    // 同步注入样式，确保高亮样式在所有 frame 中可见
    try {
      await chrome.scripting.insertCSS({
        target: { tabId, allFrames: true },
        files: ['content/content.css']
      });
    } catch (cssErr) {
      console.warn('insertCSS failed or not needed:', cssErr?.message || cssErr);
    }
  } catch (e) {
    console.warn('executeScript failed or not needed:', e?.message || e);
    // 即使注入失败，可能是已存在或权限受限，由上层判断
  }
}

/**
 * 处理取消选取请求
 */
async function handleCancelSelection(tabId) {
  if (!tabId) {
    // 尝试获取当前活动标签页作为后备
    try {
      const [activeTab] = await api.tabsQuery({ active: true, currentWindow: true });
      tabId = activeTab?.id;
    } catch (e) {
      console.error('Failed to query active tab:', e);
    }

    if (!tabId) {
      console.error('No tab ID provided');
      return;
    }
  }

  try {
    await api.tabsSendMessage(tabId, {
      type: 'CANCEL_SELECTION'
    });
    console.log('Selection mode cancelled in tab', tabId);
  } catch (error) {
    console.error('Failed to cancel selection mode:', error);
  }
}

/**
 * 处理选中的内容
 */
async function handleContentSelected(data) {
  console.log('Content selected:', data);
  const params = {
    html: data.html,
    title: data.title,
    url: data.url
  };


  try {
    // 优先发送到本地服务器 (更可靠)
    const serverUrl = await getServerUrl();
    const body = JSON.stringify(params);
    const response = await postToServerWithRetry(serverUrl, body, 1, 5000);
    if (response && response.ok) {
      console.log('Note created successfully in VSCode');
      // 通知 Side Panel 创建成功
      notifySidePanel({ type: 'CREATION_SUCCESS' });
    } else {
      throw new Error(`Server responded with ${response?.status}`);
    }
  } catch (error) {
    console.error('Failed to send content to VSCode:', error);
    // 将错误反馈到 Side Panel，便于用户排查（不立即返回，仍尝试回退方案）
    notifySidePanel({ 
      type: 'CREATION_ERROR', 
      error: `本地服务不可用或出错：${error?.message || String(error)}，尝试使用备用方式...`
    });
    
    // 如果 HTTP 请求失败，尝试使用 URI Handler 作为备选方案
    try {
      const dataStr = JSON.stringify(params);
      if (dataStr.length > URI_FALLBACK_MAX_LENGTH) {
        throw new Error('所选内容过大，备用链接方式可能失败。请在 VSCode 中开启本地服务或缩小选取范围。');
      }
      const vscodeUri = `vscode://wedaren.issue-manager/create-from-html?data=${encodeURIComponent(dataStr)}`;
      
      // 使用 chrome.tabs.create 打开 URI
      const tab = await api.tabsCreate({ url: vscodeUri, active: false });
      // 创建后立即关闭标签页
      if (tab?.id) {
        setTimeout(() => {
          api.tabsRemove(tab.id).catch(() => {});
        }, 100);
      }
      
      notifySidePanel({ type: 'CREATION_SUCCESS' });
    } catch (fallbackError) {
      console.error('Fallback method also failed:', fallbackError);
      notifySidePanel({ 
        type: 'CREATION_ERROR', 
        error: `无法通过备用方式创建笔记：${fallbackError?.message || String(fallbackError)}。\n建议：\n1) 打开 VSCode 并确保 Issue Manager 扩展已启用；\n2) 在扩展设置中开启/确认本地服务（端口与本扩展一致）；\n3) 或在 Side Panel 缩小选取范围后重试。` 
      });
    }
  }
}

/**
 * 通知 Side Panel
 */
async function notifySidePanel(message) {  
  try {  
    // 向扩展的所有部分（包括 Side Panel）广播消息  
    await api.runtimeSendMessage(message);  
  } catch (error) {  
    // 如果没有监听器（例如 Side Panel 未打开），会抛出错误，可以安全地忽略  
    if (error.message.includes('Could not establish connection. Receiving end does not exist.')) {  
      console.log('Side Panel is not open, skipping notification.');  
    } else {  
      console.error('Failed to notify side panel:', error);  
    }  
  }  
}  
