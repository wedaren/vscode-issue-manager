/**
 * Chrome 扩展后台脚本
 * 负责协调 Side Panel 和 Content Script 之间的通信
 */

const DEFAULT_VSCODE_WS_URL = 'ws://localhost:37892/ws';
const WS_URL_STORAGE_KEY = 'issueManager.vscodeWsUrl';
const URI_FALLBACK_MAX_LENGTH = 60000; // 避免超长 vscode:// 链接导致失败

// WebSocket 连接管理
let ws = null;
let wsReconnectTimer = null;
let wsConnected = false;
const WS_RECONNECT_INTERVAL = 3000; // 重连间隔 3 秒
const WS_PING_INTERVAL = 30000; // 心跳间隔 30 秒
let wsPingTimer = null;
let messageIdCounter = 0;
const pendingMessages = new Map(); // 存储等待响应的消息

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

async function getWsUrl() {
  try {
    const data = await chrome.storage?.sync?.get?.(WS_URL_STORAGE_KEY) || await chrome.storage?.local?.get?.(WS_URL_STORAGE_KEY) || {};
    return data[WS_URL_STORAGE_KEY] || DEFAULT_VSCODE_WS_URL;
  } catch (_) {
    return DEFAULT_VSCODE_WS_URL;
  }
}

/**
 * 初始化 WebSocket 连接
 */
async function initWebSocket() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return; // 已经在连接或已连接
  }

  const wsUrl = await getWsUrl();
  
  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[WebSocket] 连接已建立');
      wsConnected = true;
      
      // 清除重连定时器
      if (wsReconnectTimer) {
        clearTimeout(wsReconnectTimer);
        wsReconnectTimer = null;
      }

      // 启动心跳
      startPing();
      
      // 通知 Side Panel 连接成功
      notifySidePanel({ type: 'WS_CONNECTED' });
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('[WebSocket] 收到消息:', message);

        // 处理响应消息
        if (message.id && pendingMessages.has(message.id)) {
          const { resolve, reject } = pendingMessages.get(message.id);
          pendingMessages.delete(message.id);

          if (message.type === 'success') {
            resolve(message);
          } else if (message.type === 'error') {
            reject(new Error(message.error || 'Unknown error'));
          } else if (message.type === 'pong') {
            resolve(message);
          }
        }

        // 处理服务端主动发送的消息
        if (message.type === 'connected') {
          console.log('[WebSocket] 服务端欢迎消息:', message.message);
        }
      } catch (e) {
        console.error('[WebSocket] 消息解析失败:', e);
      }
    };

    ws.onerror = (error) => {
      console.error('[WebSocket] 连接错误:', error);
      wsConnected = false;
    };

    ws.onclose = () => {
      console.log('[WebSocket] 连接已关闭');
      wsConnected = false;
      stopPing();
      
      // 拒绝所有等待中的消息
      pendingMessages.forEach(({ reject }) => {
        reject(new Error('WebSocket connection closed'));
      });
      pendingMessages.clear();

      // 通知 Side Panel 连接断开
      notifySidePanel({ type: 'WS_DISCONNECTED' });

      // 尝试重连
      scheduleReconnect();
    };
  } catch (e) {
    console.error('[WebSocket] 初始化失败:', e);
    scheduleReconnect();
  }
}

/**
 * 安排重连
 */
function scheduleReconnect() {
  if (wsReconnectTimer) {
    return; // 已经在重连中
  }
  
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    console.log('[WebSocket] 尝试重连...');
    initWebSocket();
  }, WS_RECONNECT_INTERVAL);
}

/**
 * 启动心跳
 */
function startPing() {
  stopPing(); // 确保只有一个心跳定时器
  
  wsPingTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      const msgId = generateMessageId();
      sendWebSocketMessage({ type: 'ping', id: msgId });
    }
  }, WS_PING_INTERVAL);
}

/**
 * 停止心跳
 */
function stopPing() {
  if (wsPingTimer) {
    clearInterval(wsPingTimer);
    wsPingTimer = null;
  }
}

/**
 * 定期检查 WebSocket 连接状态
 */
function startConnectionCheck() {
  // 每 10 秒检查一次连接状态
  setInterval(() => {
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      console.log('[WebSocket] 定期检查发现连接已断开,尝试重连');
      initWebSocket();
    }
  }, 10000);
}

/**
 * 生成消息 ID
 */
function generateMessageId() {
  return `msg_${Date.now()}_${++messageIdCounter}`;
}

/**
 * 发送 WebSocket 消息
 */
function sendWebSocketMessage(message, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('WebSocket 未连接'));
      return;
    }

    const msgId = message.id || generateMessageId();
    const msgWithId = { ...message, id: msgId };

    // 设置超时
    const timer = setTimeout(() => {
      if (pendingMessages.has(msgId)) {
        pendingMessages.delete(msgId);
        reject(new Error('WebSocket 消息超时'));
      }
    }, timeoutMs);

    // 保存回调
    pendingMessages.set(msgId, {
      resolve: (response) => {
        clearTimeout(timer);
        resolve(response);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      }
    });

    // 发送消息
    try {
      ws.send(JSON.stringify(msgWithId));
    } catch (e) {
      clearTimeout(timer);
      pendingMessages.delete(msgId);
      reject(e);
    }
  });
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

// 监听扩展图标点击事件,打开 Side Panel
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// 扩展启动时初始化 WebSocket 连接
initWebSocket();

// 启动连接状态定期检查
startConnectionCheck();

// 监听扩展安装和启动事件
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Extension] 扩展已安装或更新');
  initWebSocket();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[Extension] 浏览器启动');
  initWebSocket();
});

// 监听 Service Worker 唤醒
self.addEventListener('activate', () => {
  console.log('[Extension] Service Worker 已激活');
  // 确保 WebSocket 连接
  if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
    initWebSocket();
  }
});

// 监听来自 Side Panel 和 Content Script 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message);
  
  // 确保 WebSocket 连接活跃
  if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
    console.log('[WebSocket] 检测到连接未建立,尝试重新连接');
    initWebSocket();
  }

  switch (message.type) {
    case 'GET_WS_STATUS':
      // Side Panel 查询 WebSocket 状态
      const status = wsConnected && ws && ws.readyState === WebSocket.OPEN 
        ? 'connected' 
        : (ws && ws.readyState === WebSocket.CONNECTING ? 'connecting' : 'disconnected');
      sendResponse({ status });
      break;
      
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
    // 优先使用 WebSocket 发送(更可靠、更快)
    if (wsConnected && ws && ws.readyState === WebSocket.OPEN) {
      const response = await sendWebSocketMessage({
        type: 'create-note',
        data: params
      }, 5000);
      
      if (response && response.type === 'success') {
        console.log('Note created successfully in VSCode via WebSocket');
        notifySidePanel({ type: 'CREATION_SUCCESS' });
        return;
      } else {
        throw new Error('WebSocket response is not success');
      }
    } else {
      throw new Error('WebSocket not connected');
    }
  } catch (error) {
    console.error('Failed to send content to VSCode via WebSocket:', error);
    // 将错误反馈到 Side Panel,便于用户排查(不立即返回,仍尝试回退方案)
    notifySidePanel({ 
      type: 'CREATION_ERROR', 
      error: `WebSocket 连接不可用或出错:${error?.message || String(error)},尝试使用备用方式...`
    });
    
    // 如果 WebSocket 失败,尝试使用 URI Handler 作为备选方案
    try {
      const dataStr = JSON.stringify(params);
      if (dataStr.length > URI_FALLBACK_MAX_LENGTH) {
        throw new Error('所选内容过大,备用链接方式可能失败。请在 VSCode 中开启 WebSocket 服务或缩小选取范围。');
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
        error: `无法通过备用方式创建笔记:${fallbackError?.message || String(fallbackError)}。\n建议:\n1) 打开 VSCode 并确保 Issue Manager 扩展已启用;\n2) 在扩展设置中开启/确认 WebSocket 服务(端口与本扩展一致);\n3) 或在 Side Panel 缩小选取范围后重试。` 
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
