/**
 * Chrome 扩展后台脚本
 * 负责协调 Side Panel 和 Content Script 之间的通信
 */

// 类型定义
interface WebSocketMessage {
  type: string;
  id?: string;
  data?: unknown;
  error?: string;
  message?: string;
}

interface ContentData {
  html: string;
  title: string;
  url: string;
}

interface FocusedIssue {
  id: string;
  title: string;
  filename: string;
  content?: string;
  mtime?: number;
  children?: FocusedIssue[];
}

interface ChromeMessage {
  type: string;
  tabId?: number;
  data?: ContentData;
}

interface SidePanelNotification {
  type: 'WS_CONNECTED' | 'WS_DISCONNECTED' | 'CREATION_SUCCESS' | 'CREATION_ERROR';
  error?: string;
}

export default defineBackground(() => {
  const DEFAULT_VSCODE_WS_URL = 'ws://localhost:37892/ws';
  const WS_URL_STORAGE_KEY = 'issueManager.vscodeWsUrl';
  const URI_FALLBACK_MAX_LENGTH = 60000;

  // WebSocket 连接管理
  let ws: WebSocket | null = null;
  let wsReconnectTimer: NodeJS.Timeout | null = null;
  let wsConnected = false;
  const WS_RECONNECT_INTERVAL = 3000;
  const WS_PING_INTERVAL = 30000;
  let wsPingTimer: NodeJS.Timeout | null = null;
  let messageIdCounter = 0;
  const pendingMessages = new Map<string, { resolve: (value: WebSocketMessage) => void; reject: (reason?: Error) => void }>();

  async function getWsUrl(): Promise<string> {
    try {
      const data = await chrome.storage?.sync?.get?.(WS_URL_STORAGE_KEY) || 
                   await chrome.storage?.local?.get?.(WS_URL_STORAGE_KEY) || {};
      return data[WS_URL_STORAGE_KEY] || DEFAULT_VSCODE_WS_URL;
    } catch {
      return DEFAULT_VSCODE_WS_URL;
    }
  }

  async function initWebSocket() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
      return;
    }

    const wsUrl = await getWsUrl();
    
    try {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[WebSocket] 连接已建立');
        wsConnected = true;
        
        if (wsReconnectTimer) {
          clearTimeout(wsReconnectTimer);
          wsReconnectTimer = null;
        }

        startPing();
        notifySidePanel({ type: 'WS_CONNECTED' });
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage;
          console.log('[WebSocket] 收到消息:', message);

          if (message.id && pendingMessages.has(message.id)) {
            const { resolve, reject } = pendingMessages.get(message.id)!;
            pendingMessages.delete(message.id);

            if (message.type === 'success' || message.type === 'pong' || message.type === 'focused-issues') {
              resolve(message);
            } else if (message.type === 'error') {
              reject(new Error(message.error || 'Unknown error'));
            } else {
              resolve(message);
            }
          }

          if (message.type === 'connected') {
            console.log('[WebSocket] 服务端欢迎消息:', message.message);
          }
        } catch (e: unknown) {
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
        
        pendingMessages.forEach(({ reject }) => {
          reject(new Error('WebSocket connection closed'));
        });
        pendingMessages.clear();

        notifySidePanel({ type: 'WS_DISCONNECTED' });
        scheduleReconnect();
      };
    } catch (e: unknown) {
      console.error('[WebSocket] 初始化失败:', e);
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (wsReconnectTimer) {
      return;
    }
    
    wsReconnectTimer = setTimeout(() => {
      wsReconnectTimer = null;
      console.log('[WebSocket] 尝试重连...');
      initWebSocket();
    }, WS_RECONNECT_INTERVAL);
  }

  function startPing() {
    stopPing();
    
    wsPingTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        const msgId = generateMessageId();
        sendWebSocketMessage({ type: 'ping', id: msgId });
      }
    }, WS_PING_INTERVAL);
  }

  function stopPing() {
    if (wsPingTimer) {
      clearInterval(wsPingTimer);
      wsPingTimer = null;
    }
  }

  function startConnectionCheck() {
    setInterval(() => {
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        console.log('[WebSocket] 定期检查发现连接已断开,尝试重连');
        initWebSocket();
      }
    }, 10000);
  }

  function generateMessageId(): string {
    return `msg_${Date.now()}_${++messageIdCounter}`;
  }

  function sendWebSocketMessage(message: Record<string, unknown>, timeoutMs = 5000): Promise<WebSocketMessage> {
    return new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket 未连接'));
        return;
      }

      const msgId = (message.id as string | undefined) || generateMessageId();
      const msgWithId = { ...message, id: msgId };

      const timer = setTimeout(() => {
        if (pendingMessages.has(msgId)) {
          pendingMessages.delete(msgId);
          reject(new Error('WebSocket 消息超时'));
        }
      }, timeoutMs);

      pendingMessages.set(msgId, {
        resolve: (response: WebSocketMessage) => {
          clearTimeout(timer);
          resolve(response);
        },
        reject: (error?: Error) => {
          clearTimeout(timer);
          reject(error);
        }
      });

      try {
        ws.send(JSON.stringify(msgWithId));
      } catch (e: unknown) {
        clearTimeout(timer);
        pendingMessages.delete(msgId);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  chrome.action.onClicked.addListener((tab) => {
    chrome.sidePanel.open({ windowId: tab.windowId });
  });

  initWebSocket();
  startConnectionCheck();

  chrome.runtime.onInstalled.addListener(() => {
    console.log('[Extension] 扩展已安装或更新');
    initWebSocket();
  });

  chrome.runtime.onStartup.addListener(() => {
    console.log('[Extension] 浏览器启动');
    initWebSocket();
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Background received message:', message);
    
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      console.log('[WebSocket] 检测到连接未建立,尝试重新连接');
      initWebSocket();
    }

    switch (message.type) {
      case 'GET_WS_STATUS':
        const status = wsConnected && ws && ws.readyState === WebSocket.OPEN 
          ? 'connected' 
          : (ws && ws.readyState === WebSocket.CONNECTING ? 'connecting' : 'disconnected');
        sendResponse({ status });
        break;
        
      case 'START_SELECTION':
        (async () => {
          try {
            await handleStartSelection(message.tabId || sender.tab?.id);
            sendResponse({ success: true });
          } catch (e: unknown) {
            console.error('Failed to activate selection mode:', e);
            const errorMessage = e instanceof Error ? e.message : String(e);
            sendResponse({ success: false, error: errorMessage });
          }
        })();
        break;

      case 'CONTENT_SELECTED':
        handleContentSelected(message.data);
        sendResponse({ success: true });
        break;

      case 'CANCEL_SELECTION':
        handleCancelSelection(message.tabId || sender.tab?.id);
        sendResponse({ success: true });
        break;

      case 'GET_FOCUSED_ISSUES':
        (async () => {
          try {
            console.log('[Background] Getting focused issues...');
            const data = await getFocusedIssues();
            console.log('[Background] Got focused issues data:', data);
            sendResponse({ success: true, data });
          } catch (e: unknown) {
            console.error('[Background] Failed to get focused issues:', e);
            const errorMessage = e instanceof Error ? e.message : String(e);
            sendResponse({ success: false, error: errorMessage });
          }
        })();
        break;

      default:
        console.warn('Unknown message type:', message.type);
        sendResponse({ success: false, error: 'Unknown message type' });
    }

    return true;
  });

  async function handleStartSelection(tabId?: number) {
    if (!tabId) {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = activeTab?.id;
      } catch (e: unknown) {
        console.error('Failed to query active tab:', e);
      }

      if (!tabId) {
        console.error('No tab ID provided');
        notifySidePanel({ type: 'CREATION_ERROR', error: '无法获取当前标签页，无法进入选取模式。' });
        return;
      }
    }

    try {
      await chrome.tabs.sendMessage(tabId, { type: 'START_SELECTION' });
      console.log('Selection mode activated in tab', tabId);
      return;
    } catch (error: unknown) {
      console.warn('First attempt to activate selection failed, trying to inject content script...', error);
    }

    try {
      await ensureContentScriptInjected(tabId);
      await chrome.tabs.sendMessage(tabId, { type: 'START_SELECTION' });
      console.log('Selection mode activated after injection in tab', tabId);
    } catch (error: unknown) {
      try {
        const tab = await chrome.tabs.get(tabId);
        const url = tab?.url || '';
        if (/^(chrome|chrome-extension|edge|about|chrome-search):/i.test(url) || /chromewebstore\.google\.com/i.test(url)) {
          throw new Error('该页面不支持内容脚本（如 chrome:// 或 Chrome Web Store），无法进入选取模式。请在普通网页中重试。');
        }
      } catch (_: unknown) {}
      throw error;
    }
  }

  async function ensureContentScriptInjected(tabId: number) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ['content-scripts/content.js']
      });
      try {
        await chrome.scripting.insertCSS({
          target: { tabId, allFrames: true },
          files: ['content-scripts/content.css']
        });
      } catch (cssErr: unknown) {
        console.warn('insertCSS failed or not needed:', cssErr);
      }
    } catch (e: unknown) {
      console.warn('executeScript failed or not needed:', e);
    }
  }

  async function handleCancelSelection(tabId?: number) {
    if (!tabId) {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = activeTab?.id;
      } catch (e: unknown) {
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
    } catch (error: unknown) {
      console.error('Failed to cancel selection mode:', error);
    }
  }

  async function handleContentSelected(data: ContentData) {
    console.log('Content selected:', data);
    const params: ContentData = {
      html: data.html,
      title: data.title,
      url: data.url
    };

    try {
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
    } catch (error: unknown) {
      console.error('Failed to send content to VSCode via WebSocket:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      notifySidePanel({ 
        type: 'CREATION_ERROR', 
        error: `WebSocket 连接不可用或出错:${errorMessage},尝试使用备用方式...`
      });
      
      try {
        const dataStr = JSON.stringify(params);
        if (dataStr.length > URI_FALLBACK_MAX_LENGTH) {
          throw new Error('所选内容过大,备用链接方式可能失败。请在 VSCode 中开启 WebSocket 服务或缩小选取范围。');
        }
        const vscodeUri = `vscode://wedaren.issue-manager/create-from-html?data=${encodeURIComponent(dataStr)}`;
        
        const tab = await chrome.tabs.create({ url: vscodeUri, active: false });
        if (tab?.id) {
          setTimeout(() => {
            chrome.tabs.remove(tab.id!).catch(() => {});
          }, 100);
        }
        
        notifySidePanel({ type: 'CREATION_SUCCESS' });
      } catch (fallbackError: unknown) {
        console.error('Fallback method also failed:', fallbackError);
        const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        notifySidePanel({ 
          type: 'CREATION_ERROR', 
          error: `无法通过备用方式创建笔记:${fallbackErrorMessage}。\n建议:\n1) 打开 VSCode 并确保 Issue Manager 扩展已启用;\n2) 在扩展设置中开启/确认 WebSocket 服务(端口与本扩展一致);\n3) 或在 Side Panel 缩小选取范围后重试。` 
        });
      }
    }
  }

  async function getFocusedIssues(): Promise<FocusedIssue[]> {
    console.log('[getFocusedIssues] Starting...');
    console.log('[getFocusedIssues] WS connected:', wsConnected);
    console.log('[getFocusedIssues] WS state:', ws?.readyState);
    
    if (!wsConnected || !ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected to VSCode');
    }

    try {
      console.log('[getFocusedIssues] Sending WebSocket message...');
      const response = await sendWebSocketMessage({
        type: 'get-focused-issues'
      }, 5000);

      console.log('[getFocusedIssues] Got response:', response);

      if (response && response.type === 'focused-issues') {
        const data = (response.data as FocusedIssue[]) || [];
        console.log('[getFocusedIssues] Returning data:', data);
        return data;
      } else if (response && response.type === 'error') {
        throw new Error(response.error || 'Failed to get focused issues');
      } else {
        throw new Error('Unexpected response from VSCode');
      }
    } catch (error: unknown) {
      console.error('[getFocusedIssues] Failed to get focused issues via WebSocket:', error);
      throw error;
    }
  }

  async function notifySidePanel(message: SidePanelNotification) {  
    try {  
      await chrome.runtime.sendMessage(message);  
    } catch (error: unknown) {  
      if (error instanceof Error && error.message.includes('Could not establish connection. Receiving end does not exist.')) {  
        console.log('Side Panel is not open, skipping notification.');  
      } else {  
        console.error('Failed to notify side panel:', error);  
      }  
    }  
  }
});
