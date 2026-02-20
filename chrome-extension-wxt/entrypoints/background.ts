/**
 * Chrome 扩展后台脚本
 * 负责协调 Side Panel 和 Content Script 之间的通信
 */

import { ChromeConfigManager } from '../utils/ChromeConfigManager';
import { isReceiverNotExistError } from '../utils/chromeErrorUtils';

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

interface PageSelectionData {
  text: string;
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
  filePath?: string;
}

interface SidePanelNotification {
  type: 'WS_CONNECTED' | 'WS_DISCONNECTED' | 'CREATION_SUCCESS' | 'CREATION_ERROR' | 'FOCUSED_LIST_UPDATED';
  error?: string;
}

export default defineBackground(() => {
  const URI_FALLBACK_MAX_LENGTH = 60000;
  const configManager = ChromeConfigManager.getInstance();

  let ws: WebSocket | null = null;
  let wsReconnectTimer: NodeJS.Timeout | null = null;
  let wsPingTimer: NodeJS.Timeout | null = null;
  let wsConnected = false;

  // 存储 LLM 交互的选取挂起 Promise resolve 和 reject
  let llmSelectionResolver: ((value: any) => void) | null = null;
  let llmSelectionRejector: ((reason?: any) => void) | null = null;
  let messageIdCounter = 0;
  const pendingMessages = new Map<string, { resolve: (value: WebSocketMessage) => void; reject: (reason?: Error) => void }>();
  // 简单的 markdown 缓存与并发请求去重
  // 使用 Map 的插入顺序实现 LRU：访问时删除后重插入，回收时删除 Map.keys().next().value
  const issueMarkdownCache = new Map<string, { content: string; mtime?: number; sizeBytes: number }>();
  const pendingMarkdownRequests = new Map<string, Promise<{ success: boolean; content?: string; error?: string; mtime?: number }>>();
  const MAX_CACHE_ITEMS = 50; // 可配置

  // WebSocket 配置（从配置管理器获取）
  let wsConfig: {
    url: string;
    reconnectInterval: number;
    pingInterval: number;
  } | null = null;

  /**
   * 获取 WebSocket 配置
   */
  async function getWsConfig() {
    if (wsConfig) {
      return wsConfig;
    }

    const config = await configManager.getWebSocketConfig();
    wsConfig = {
      url: config.url,
      reconnectInterval: config.retryDelay,
      pingInterval: 30000 // 30秒心跳
    };

    return wsConfig;
  }

  /**
   * 获取 WebSocket URL（支持端口自动发现）
   */
  async function getWsUrl(): Promise<string> {
    try {
      const config = await configManager.getWebSocketConfig();

      // 如果启用了端口发现，尝试发现可用端口
      if (config.enablePortDiscovery) {
        console.log('[Config] 端口自动发现已启用');
        const discoveredPort = await configManager.discoverPort();
        if (discoveredPort) {
          console.log(`[Config] 使用发现的端口: ${discoveredPort}`);
          return `ws://${config.host}:${discoveredPort}/ws`;
        }
      }

      // 使用配置中的 URL
      return config.url;
    } catch (error) {
      console.error('[Config] 获取 WebSocket URL 失败:', error);
      // 返回默认值
      return 'ws://localhost:37892/ws';
    }
  }

  async function initWebSocket() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
      return;
    }

    // 获取配置
    const config = await getWsConfig();
    const wsUrl = await getWsUrl();

    console.log(`[WebSocket] 尝试连接到: ${wsUrl}`);

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

            // 保存服务器返回的配置信息
            const serverConfig = (message as any).config;
            if (serverConfig) {
              console.log('[WebSocket] 保存服务器配置:', serverConfig);
              configManager.save({
                websocket: {
                  ...serverConfig,
                  url: `ws://${serverConfig.host}:${serverConfig.port}/ws`
                }
              }).catch(err => {
                console.error('[WebSocket] 保存配置失败:', err);
              });
            }
          } else if (message.type === 'focused-list-updated') {
            // 关注列表已更新，通知 Side Panel 刷新
            console.log('[WebSocket] 关注列表已更新');
            notifySidePanel({ type: 'FOCUSED_LIST_UPDATED' });
          } else if (message.type === 'llm-push' || message.type === 'llm-stream' || message.type === 'llm-reply') {
            // LLM 推送/流式消息，直接转发给 Side Panel（例如聊天界面）
            // 附带 requestId（= WebSocket 消息的 id），前端用于精确路由到发起该请求的会话
            chrome.runtime.sendMessage({ type: 'LLM_PUSH', payload: message.data, requestId: message.id }).catch((err) => {
              if (isReceiverNotExistError(err)) {
                console.log('[WebSocket] Side Panel 未打开，跳过 LLM 推送');
              } else {
                console.error('[WebSocket] 转发 LLM 推送失败:', err);
              }
            });
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

  async function scheduleReconnect() {
    if (wsReconnectTimer) {
      return;
    }

    const config = await getWsConfig();
    wsReconnectTimer = setTimeout(() => {
      wsReconnectTimer = null;
      console.log('[WebSocket] 尝试重连...');
      initWebSocket();
    }, config.reconnectInterval);
  }

  async function startPing() {
    await stopPing();

    const config = await getWsConfig();
    wsPingTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        const msgId = generateMessageId();
        sendWebSocketMessage({ type: 'ping', id: msgId });
      }
    }, config.pingInterval) as unknown as NodeJS.Timeout;
  }

  function stopPing() {
    if (wsPingTimer) {
      clearInterval(wsPingTimer);
      wsPingTimer = null;
    }
    return Promise.resolve();
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

  async function getIssueTreeFromWs(): Promise<any[]> {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket 未连接');
    }
    const response = await sendWebSocketMessage({ type: 'get-issue-tree' }, 5000);
    if (response && response.type === 'issue-tree') {
      return (response as any).data || [];
    }
    if (response && response.type === 'error') {
      throw new Error(response.error || 'Failed to get issue tree');
    }
    throw new Error('Unexpected response from VSCode');
  }

  async function getIssueMarkdownFromWs(filePath: string): Promise<{ success: boolean; content?: string; error?: string; mtime?: number }> {
    // 去重并发请求
    if (pendingMarkdownRequests.has(filePath)) {
      return pendingMarkdownRequests.get(filePath)!;
    }

    const p = (async () => {
      try {
        // 检查缓存
        const cached = issueMarkdownCache.get(filePath);
        if (cached) {
          // 将该缓存项移动到 Map 末尾，表示最近使用
          issueMarkdownCache.delete(filePath);
          issueMarkdownCache.set(filePath, { content: cached.content, mtime: cached.mtime, sizeBytes: cached.sizeBytes });
          return { success: true, content: cached.content, mtime: cached.mtime };
        }

        if (!ws || ws.readyState !== WebSocket.OPEN) {
          throw new Error('WebSocket 未连接');
        }

        const response = await sendWebSocketMessage({ type: 'get-issue-content', data: { filePath } }, 8000);
        if (response && response.type === 'issue-content') {
          const data = (response as any).data || {};
          const content = data.content || '';
          const mtime = data.mtime;

          // 缓存
          try {
            const sizeBytes = new TextEncoder().encode(content).length;
            issueMarkdownCache.set(filePath, { content, mtime, sizeBytes });
            // 简单回收策略：删除 Map 中最旧（最少使用）的键（Map 按插入顺序迭代）
            if (issueMarkdownCache.size > MAX_CACHE_ITEMS) {
              const oldestKey = issueMarkdownCache.keys().next().value as string | undefined;
              if (oldestKey) {
                issueMarkdownCache.delete(oldestKey);
              }
            }
          } catch (e) {
            console.warn('[Background] Failed to update issue markdown cache:', e);
          }

          return { success: true, content, mtime };
        } else if (response && response.type === 'error') {
          return { success: false, error: response.error || 'VSCode error' };
        }

        return { success: false, error: 'Unexpected response from VSCode' };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { success: false, error: msg };
      } finally {
        pendingMarkdownRequests.delete(filePath);
      }
    })();

    pendingMarkdownRequests.set(filePath, p);
    return p;
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

  chrome.runtime.onMessage.addListener((message: ChromeMessage, sender, sendResponse) => {
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
            await handleStartSelection(message.tabId || sender.tab?.id, 'START_SELECTION');
            sendResponse({ success: true });
          } catch (e: unknown) {
            console.error('Failed to activate selection mode:', e);
            const errorMessage = e instanceof Error ? e.message : String(e);
            sendResponse({ success: false, error: errorMessage });
          }
        })();
        break;

      case 'START_LLM_SELECTION':
        (async () => {
          try {
            // 清理上一个未完成的任务
            if (llmSelectionRejector) {
              llmSelectionRejector(new Error('Interrupted by new selection'));
              llmSelectionRejector = null;
              llmSelectionResolver = null;
            }

            // 建立挂起的 Promise
            const selectionPromise = new Promise((resolve, reject) => {
              llmSelectionResolver = resolve;
              llmSelectionRejector = reject;
            });

            await handleStartSelection(message.tabId || sender.tab?.id, 'START_LLM_SELECTION');

            // 等待用户操作
            const data = await selectionPromise;
            sendResponse({ success: true, data });
          } catch (e: unknown) {
            console.error('Failed or cancelled LLM selection:', e);
            const errorMessage = e instanceof Error ? e.message : String(e);
            sendResponse({ success: false, error: errorMessage });
          } finally {
            llmSelectionResolver = null;
            llmSelectionRejector = null;
          }
        })();
        break;

      case 'CONTENT_SELECTED':
        handleContentSelected(message.data!);
        sendResponse({ success: true });
        break;

      case 'LLM_CONTENT_SELECTED':
        if (llmSelectionResolver) {
          llmSelectionResolver(message.data);
          llmSelectionResolver = null;
          llmSelectionRejector = null;
        }
        sendResponse({ success: true });
        break;

      case 'CANCEL_SELECTION':
        if (llmSelectionRejector) {
          llmSelectionRejector(new Error('User cancelled selection'));
          llmSelectionResolver = null;
          llmSelectionRejector = null;
        }
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

      case 'GET_PAGE_SELECTION':
        (async () => {
          try {
            const data = await getPageSelection(message.tabId || sender.tab?.id);
            sendResponse({ success: true, data });
          } catch (e: unknown) {
            console.error('[Background] Failed to get page selection:', e);
            const errorMessage = e instanceof Error ? e.message : String(e);
            sendResponse({ success: false, error: errorMessage });
          }
        })();
        break;

      case 'GET_PAGE_CONTENT':
        (async () => {
          try {
            const data = await getPageContent(message.tabId || sender.tab?.id);
            sendResponse({ success: true, data });
          } catch (e: unknown) {
            console.error('[Background] Failed to get page content:', e);
            const errorMessage = e instanceof Error ? e.message : String(e);
            sendResponse({ success: false, error: errorMessage });
          }
        })();
        break;

      case 'GET_ISSUE_TREE':
        (async () => {
          try {
            const data = await getIssueTreeFromWs();
            sendResponse({ success: true, data });
          } catch (e: unknown) {
            console.error('[Background] Failed to get issue tree:', e);
            const errorMessage = e instanceof Error ? e.message : String(e);
            sendResponse({ success: false, error: errorMessage });
          }
        })();
        break;

      case 'GET_ISSUE_MARKDOWN':
        (async () => {
          try {
            const filePath = message.filePath;
            if (!filePath) {
              sendResponse({ success: false, error: 'Missing filePath' });
              return;
            }

            const result = await getIssueMarkdownFromWs(filePath);
            if (result.success) {
              sendResponse({ success: true, content: result.content, mtime: result.mtime });
            } else {
              sendResponse({ success: false, error: result.error });
            }
          } catch (e: unknown) {
            console.error('[Background] GET_ISSUE_MARKDOWN failed:', e);
            const errorMessage = e instanceof Error ? e.message : String(e);
            sendResponse({ success: false, error: errorMessage });
          }
        })();
        break;

      case 'LLM_REQUEST':
        (async () => {
          try {
            // 从消息体中提取 model 与 prompt（允许两种字段位置）
            const model = (message as any).model || (message.data && (message.data as any).model);
            const prompt = (message as any).prompt || (message.data && (message.data as any).prompt) || (message.data && (message.data as any).text);
            // 提取历史对话上下文（由 LLMPanel 传入，格式为 {role, content}[]）
            const history = (message as any).history || [];

            if (!prompt) {
              sendResponse({ success: false, error: 'Missing prompt' });
              return;
            }

            // 确保 WebSocket 已连接
            if (!ws || ws.readyState !== WebSocket.OPEN) {
              await initWebSocket();
            }

            if (!ws || ws.readyState !== WebSocket.OPEN) {
              sendResponse({ success: false, error: 'WebSocket not connected' });
              return;
            }

            // 转发到 VSCode（由 VSCode 插件负责调用 Copilot） - 采用流式：不等待最终回复，直接发送请求并立刻返回成功
            // history 字段包含本轮消息之前的所有对话，VS Code 端可用于构建多轮上下文
            try {
              const msgId = generateMessageId();
              const msg = { type: 'llm-request', id: msgId, data: { model, prompt, history } };
              if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(msg));
                // 立即返回，后续的流式 chunk 与最终回复会由 ws.onmessage 转发给 SidePanel
                sendResponse({ success: true, data: { requestId: msgId } });
              } else {
                sendResponse({ success: false, error: 'WebSocket not connected' });
              }
            } catch (e: unknown) {
              const errMsg = e instanceof Error ? e.message : String(e);
              sendResponse({ success: false, error: errMsg });
            }
          } catch (e: unknown) {
            console.error('LLM_REQUEST failed:', e);
            const errorMessage = e instanceof Error ? e.message : String(e);
            sendResponse({ success: false, error: errorMessage });
          }
        })();
        break;

      case 'GENERATE_TITLE':
        (async () => {
          try {
            const filePath = message.filePath;
            if (!filePath) {
              sendResponse({ success: false, error: 'Missing filePath' });
              return;
            }

            // 转发到 VSCode，执行命令
            const wsResponse = await sendWebSocketMessage({
              type: 'execute-command',
              data: {
                command: 'issueManager.generateTitleCommand',
                args: [{ filePath }]
              }
            }, 15000);

            if (wsResponse && wsResponse.type === 'success') {
              // 请求成功，通知 Side Panel 刷新关注列表
              notifySidePanel({ type: 'FOCUSED_LIST_UPDATED' });
              sendResponse({ success: true });
            } else if (wsResponse) {
              sendResponse({ success: false, error: wsResponse.error || 'VSCode error' });
            } else {
              sendResponse({ success: false, error: 'Unexpected response from VSCode' });
            }
          } catch (e: unknown) {
            console.error('GENERATE_TITLE failed:', e);
            const errorMessage = e instanceof Error ? e.message : String(e);
            sendResponse({ success: false, error: errorMessage });
          }
        })();
        break;

      case 'GENERATE_BRIEF_SUMMARY':
        (async () => {
          try {
            const filePath = message.filePath;
            if (!filePath) {
              sendResponse({ success: false, error: 'Missing filePath' });
              return;
            }

            // 转发到 VSCode，执行命令
            const wsResponse = await sendWebSocketMessage({
              type: 'execute-command',
              data: {
                command: 'issueManager.generateBriefSummaryCommand',
                args: [{ filePath }]
              }
            }, 15000);

            if (wsResponse && wsResponse.type === 'success') {
              // 请求成功，通知 Side Panel 刷新关注列表
              notifySidePanel({ type: 'FOCUSED_LIST_UPDATED' });
              sendResponse({ success: true });
            } else if (wsResponse) {
              sendResponse({ success: false, error: wsResponse.error || 'VSCode error' });
            } else {
              sendResponse({ success: false, error: 'Unexpected response from VSCode' });
            }
          } catch (e: unknown) {
            console.error('GENERATE_BRIEF_SUMMARY failed:', e);
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

  async function handleStartSelection(tabId?: number, actionType: 'START_SELECTION' | 'START_LLM_SELECTION' = 'START_SELECTION') {
    if (!tabId) {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = activeTab?.id;
      } catch (e: unknown) {
        console.error('Failed to query active tab:', e);
      }

      if (!tabId) {
        console.error('No tab ID provided');
        if (actionType === 'START_SELECTION') {
          notifySidePanel({ type: 'CREATION_ERROR', error: '无法获取当前标签页，无法进入选取模式。' });
        }
        throw new Error('无法获取当前标签页，无法进入选取模式。');
      }
    }

    try {
      await chrome.tabs.sendMessage(tabId, { type: actionType });
      console.log('Selection mode activated in tab', tabId, 'action:', actionType);
      return;
    } catch (error: unknown) {
      console.warn('First attempt to activate selection failed, trying to inject content script...', error);
    }

    try {
      await ensureContentScriptInjected(tabId);
      await chrome.tabs.sendMessage(tabId, { type: actionType });
      console.log('Selection mode activated after injection in tab', tabId, 'action:', actionType);
    } catch (error: unknown) {
      try {
        const tab = await chrome.tabs.get(tabId);
        const url = tab?.url || '';
        if (/^(chrome|chrome-extension|edge|about|chrome-search):/i.test(url) || /chromewebstore\.google\.com/i.test(url)) {
          throw new Error('该页面不支持内容脚本（如 chrome:// 或 Chrome Web Store），无法进入选取模式。请在普通网页中重试。');
        }
      } catch (_: unknown) { }
      throw error;
    }
  }

  async function getActiveTabId(): Promise<number | undefined> {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return activeTab?.id;
  }

  async function getPageSelection(tabId?: number): Promise<PageSelectionData> {
    let resolvedTabId = tabId;
    if (!resolvedTabId) {
      resolvedTabId = await getActiveTabId();
    }

    if (!resolvedTabId) {
      throw new Error('无法获取当前标签页');
    }

    try {
      const response = await chrome.tabs.sendMessage(resolvedTabId, { type: 'GET_PAGE_SELECTION' }) as {
        success?: boolean;
        data?: PageSelectionData;
        error?: string;
      };

      if (response?.success && response.data) {
        return response.data;
      }

      throw new Error(response?.error || '获取划线内容失败');
    } catch (firstError: unknown) {
      console.warn('[Background] First GET_PAGE_SELECTION failed, try inject content script:', firstError);
      await ensureContentScriptInjected(resolvedTabId);

      const response = await chrome.tabs.sendMessage(resolvedTabId, { type: 'GET_PAGE_SELECTION' }) as {
        success?: boolean;
        data?: PageSelectionData;
        error?: string;
      };

      if (response?.success && response.data) {
        return response.data;
      }

      throw new Error(response?.error || '获取划线内容失败');
    }
  }

  async function getPageContent(tabId?: number): Promise<PageSelectionData> {
    let resolvedTabId = tabId;
    if (!resolvedTabId) {
      resolvedTabId = await getActiveTabId();
    }

    if (!resolvedTabId) {
      throw new Error('无法获取当前标签页');
    }

    try {
      const response = await chrome.tabs.sendMessage(resolvedTabId, { type: 'GET_PAGE_CONTENT' }) as {
        success?: boolean;
        data?: PageSelectionData;
        error?: string;
      };

      if (response?.success && response.data) {
        return response.data;
      }

      throw new Error(response?.error || '获取页面内容失败');
    } catch (firstError: unknown) {
      console.warn('[Background] First GET_PAGE_CONTENT failed, try inject content script:', firstError);
      await ensureContentScriptInjected(resolvedTabId);

      const response = await chrome.tabs.sendMessage(resolvedTabId, { type: 'GET_PAGE_CONTENT' }) as {
        success?: boolean;
        data?: PageSelectionData;
        error?: string;
      };

      if (response?.success && response.data) {
        return response.data;
      }

      throw new Error(response?.error || '获取页面内容失败');
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
            chrome.tabs.remove(tab.id!).catch(() => { });
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
      if (isReceiverNotExistError(error)) {
        console.log('Side Panel is not open, skipping notification.');
      } else {
        console.error('Failed to notify side panel:', error);
      }
    }
  }
});
