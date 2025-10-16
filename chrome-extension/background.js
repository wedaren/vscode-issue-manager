/**
 * Chrome 扩展后台脚本
 * 负责协调 Side Panel 和 Content Script 之间的通信
 */

const VSCODE_NOTE_SERVER_URL = 'http://localhost:37892/create-note';  

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
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
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
    await chrome.tabs.sendMessage(tabId, { type: 'START_SELECTION' });
    console.log('Selection mode activated in tab', tabId);
    return;
  } catch (error) {
    console.warn('First attempt to activate selection failed, trying to inject content script...', error);
  }

  // 首次失败：尝试注入 content script 后重试
  try {
    await ensureContentScriptInjected(tabId);
    await chrome.tabs.sendMessage(tabId, { type: 'START_SELECTION' });
    console.log('Selection mode activated after injection in tab', tabId);
  } catch (error) {
    // 检查是否为受限页面
    try {
      const tab = await chrome.tabs.get(tabId);
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
      target: { tabId },
      files: ['content/content.js']
    });
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
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
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
    await chrome.tabs.sendMessage(tabId, {
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
    // 构建 VSCode URI
    // 方案一：使用 VSCode URI Handler
    // const vscodeUri = `vscode://wedaren.issue-manager/create-from-html?data=${encodeURIComponent(JSON.stringify(params))}`;
    
    // 方案二：发送到本地服务器 (更可靠)
    const response = await fetch(VSCODE_NOTE_SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(params)
    });

    if (response.ok) {
      console.log('Note created successfully in VSCode');
      // 通知 Side Panel 创建成功
      notifySidePanel({ type: 'CREATION_SUCCESS' });
    } else {
      throw new Error(`Server responded with ${response.status}`);
    }
  } catch (error) {
    console.error('Failed to send content to VSCode:', error);
    
    // 如果 HTTP 请求失败，尝试使用 URI Handler 作为备选方案
    try {
      const vscodeUri = `vscode://wedaren.issue-manager/create-from-html?data=${encodeURIComponent(JSON.stringify(params))}`;
      
      // 使用 chrome.tabs.create 打开 URI
      chrome.tabs.create({ url: vscodeUri, active: false }, (tab) => {
        // 创建后立即关闭标签页
        if (tab.id) {
          setTimeout(() => chrome.tabs.remove(tab.id), 100);
        }
      });
      
      notifySidePanel({ type: 'CREATION_SUCCESS' });
    } catch (fallbackError) {
      console.error('Fallback method also failed:', fallbackError);
      notifySidePanel({ 
        type: 'CREATION_ERROR', 
        error: '无法连接到 VSCode，请确保 VSCode 已打开且 Issue Manager 扩展已启用。' 
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
    await chrome.runtime.sendMessage(message);  
  } catch (error) {  
    // 如果没有监听器（例如 Side Panel 未打开），会抛出错误，可以安全地忽略  
    if (error.message.includes('Could not establish connection. Receiving end does not exist.')) {  
      console.log('Side Panel is not open, skipping notification.');  
    } else {  
      console.error('Failed to notify side panel:', error);  
    }  
  }  
}  
