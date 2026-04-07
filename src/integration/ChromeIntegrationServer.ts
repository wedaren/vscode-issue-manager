import * as vscode from 'vscode';
import * as http from 'http';
import * as net from 'net';
import { URL } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { createIssueFromHtml } from '../commands/createIssueFromHtml';
import { Logger } from '../core/utils/Logger';
import { readTree, IssueNode } from '../data/issueTreeManager';
import * as path from 'path';
import { getIssueDir } from '../config';
import { SharedConfig } from '../config/SharedConfig';
import { getIssueMarkdown } from '../data/IssueMarkdowns';
import { DEFAULT_IMAGE_PROCESS_OPTIONS } from '../utils/imageUtils';


interface ChromeRequestPayload {
  html?: string;
  title?: string;
  url?: string;
}

// WebSocket 消息通用格式
interface WSMessage<T = unknown> {
  type: string;
  id?: string | number;
  data?: T;
}

// 轻量化 issue tree 元数据节点
interface IssueTreeMetaNode {
  id: string;
  filePath: string;
  absolutePath: string;
  title: string;
  hasChildren: boolean;
  children: IssueTreeMetaNode[];
  expanded: boolean;
}

// 包含 markdown content 的完整节点（用于关注问题按需返回完整子树）
interface IssueTreeFullNode {
  id: string;
  filePath: string;
  absolutePath: string;
  title: string;
  content: string;
  children: IssueTreeFullNode[];
  expanded: boolean;
}

const URI_PATH_OPEN_DIR = '/open-issue-dir';
const URI_PATH_CREATE_FROM_HTML = '/create-from-html';
const COMMAND_OPEN_ISSUE_DIR = 'issueManager.openIssueDir';

/** 待处理的 VSCode → Chrome 请求 */
interface PendingRequest {
  resolve: (data: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * 负责 VSCode 端与 Chrome 扩展集成:
 * - WebSocket 服务:接收来自 Chrome 扩展的实时消息
 * - URI Handler:vscode://wedaren.issue-manager/create-from-html?data=... (备用)
 */
export class ChromeIntegrationServer {
  private static instance: ChromeIntegrationServer | null = null;
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private disposed = false;
  private logger = Logger.getInstance();
  /** VSCode → Chrome 请求的 pending 映射 */
  private pendingRequests = new Map<string, PendingRequest>();
  private requestIdCounter = 0;

  public static getInstance(): ChromeIntegrationServer {
    if (!this.instance) {
      this.instance = new ChromeIntegrationServer();
    }
    return this.instance;
  }

  /**
   * 向所有连接的 WebSocket 客户端广播消息
   * @param message 要广播的消息
   */
  public broadcastToClients(message: Record<string, unknown>): void {
    if (!this.wss) {
      this.logger.debug('[ChromeIntegration] WebSocket 服务未启动，无法广播消息');
      return;
    }

    const messageStr = JSON.stringify(message);
    let sentCount = 0;

    this.wss.clients.forEach((client: WebSocket) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(messageStr);
          sentCount++;
        } catch (e) {
          this.logger.warn('[ChromeIntegration] 向客户端发送消息失败', e);
        }
      }
    });

    this.logger.debug(`[ChromeIntegration] 广播消息到 ${sentCount} 个客户端`, message);
  }

  /**
   * 向 Chrome 扩展发送请求并等待响应（请求/响应模式）
   * @param type 请求类型
   * @param data 请求数据
   * @param timeoutMs 超时时间（毫秒），默认 30 秒
   */
  public sendRequest<T = any>(type: string, data?: unknown, timeoutMs = 30000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.wss) {
        reject(new Error('WebSocket 服务未启动'));
        return;
      }

      // 寻找一个 OPEN 状态的客户端
      let targetClient: WebSocket | undefined;
      this.wss.clients.forEach((client: WebSocket) => {
        if (client.readyState === WebSocket.OPEN && !targetClient) {
          targetClient = client;
        }
      });

      if (!targetClient) {
        reject(new Error('没有已连接的 Chrome 扩展'));
        return;
      }

      const msgId = `vscode-req-${++this.requestIdCounter}-${Date.now()}`;

      const timer = setTimeout(() => {
        if (this.pendingRequests.has(msgId)) {
          this.pendingRequests.delete(msgId);
          reject(new Error(`Chrome 请求超时: ${type} (${timeoutMs}ms)`));
        }
      }, timeoutMs);

      this.pendingRequests.set(msgId, { resolve, reject, timer });

      try {
        targetClient.send(JSON.stringify({ type, id: msgId, data }));
        this.logger.info(`[ChromeIntegration] 发送请求到 Chrome: ${type} (${msgId})`);
      } catch (e) {
        clearTimeout(timer);
        this.pendingRequests.delete(msgId);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  /**
   * 检查是否有 Chrome 扩展连接
   */
  public hasConnectedClient(): boolean {
    if (!this.wss) { return false; }
    let hasOpen = false;
    this.wss.clients.forEach((client: WebSocket) => {
      if (client.readyState === WebSocket.OPEN) { hasOpen = true; }
    });
    return hasOpen;
  }

  public async start(context: vscode.ExtensionContext): Promise<void> {
    if (this.httpServer) {
      return; // 已启动
    }

    const config = vscode.workspace.getConfiguration('issueManager');
    const enable = config.get<boolean>('chromeIntegration.enableServer', true);

    // 使用共享配置
    const sharedConfig = SharedConfig.getInstance();
    const wsConfig = sharedConfig.getWebSocketConfig();

    // 尝试找到可用端口
    let port = wsConfig.port;
    if (wsConfig.enablePortDiscovery) {
      port = await this.findAvailablePort(wsConfig.portRange.start, wsConfig.portRange.end);
      this.logger.info(`[ChromeIntegration] 使用端口: ${port} (配置端口: ${wsConfig.port})`);
    }

    // URI Handler(无论是否开启本地服务,都注册,备用)
    const uriHandler: vscode.UriHandler = {
      handleUri: async (uri: vscode.Uri) => {
        try {

          switch (uri.path) {
            case URI_PATH_OPEN_DIR:
              // 处理打开问题目录
              await vscode.commands.executeCommand(COMMAND_OPEN_ISSUE_DIR);
              return;

            case URI_PATH_CREATE_FROM_HTML: {
              // 处理创建笔记  
              const params = new URL(uri.toString()).searchParams;

              let html = params.get('html') || '';
              let title = params.get('title') || undefined;
              let url = params.get('url') || undefined;

              const dataRaw = params.get('data');
              if (dataRaw) {
                try {
                  const parsed = JSON.parse(dataRaw);
                  html = parsed.html ?? html;
                  title = parsed.title ?? title;
                  url = parsed.url ?? url;
                } catch (e) {
                  this.logger.error('URI data 参数解析失败', e);
                  void vscode.window.showErrorMessage('解析来自 Chrome 扩展的数据失败,请重试。');
                }
              }

              if (!html) {
                void vscode.window.showErrorMessage('链接中缺少 html 内容,无法创建笔记');
                return;
              }

              await createIssueFromHtml({ html, title, url });
              return;
            }

            default:
              // 未知路径  
              this.logger.warn('未知的 URI 路径', { path: uri.path });
          }

        } catch (e: any) {
          this.logger.error('URI 处理失败', e);
          const message = e instanceof Error ? e.message : String(e);
          void vscode.window.showErrorMessage(`处理来自浏览器的请求失败: ${message}`);
        }
      }
    };
    context.subscriptions.push(vscode.window.registerUriHandler(uriHandler));

    if (!enable) {
      this.logger.info('[ChromeIntegration] WebSocket 服务未启用(已注册 URI Handler 作为备用)');
      return;
    }

    // 创建 HTTP 服务器用于 WebSocket 升级
    this.httpServer = http.createServer((req, res) => {
      // 对于非 WebSocket 的 HTTP 请求,返回 404
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'WebSocket only' }));
    });

    // 创建 WebSocket 服务器
    this.wss = new WebSocketServer({
      server: this.httpServer,
      path: '/ws'
    });

    // 处理 WebSocket 连接
    this.wss.on('connection', (ws: WebSocket) => {
      this.logger.info('[ChromeIntegration] Chrome 扩展已连接');

      // 发送欢迎消息和配置信息
      const sharedConfig = SharedConfig.getInstance();
      const wsConfig = sharedConfig.getWebSocketConfig();
      ws.send(JSON.stringify({
        type: 'connected',
        message: '已连接到 VSCode Issue Manager',
        config: {
          port,
          host: wsConfig.host,
          portRange: wsConfig.portRange
        }
      }));

      // 发送欢迎消息
      ws.send(JSON.stringify({ type: 'connected', message: 'VSCode 已连接' }));

      // 处理接收到的消息
      ws.on('message', async (data: Buffer) => {
        let message: WSMessage | null = null;
        try {
          const parsed = JSON.parse(data.toString('utf8')) as unknown;
          this.logger.debug('[ChromeIntegration] 收到消息', parsed);
          if (!parsed || typeof parsed !== 'object') {
            ws.send(JSON.stringify({ type: 'error', error: 'Invalid message', id: undefined }));
            return;
          }
          const parsedObj = parsed as WSMessage;
          if (typeof parsedObj.type !== 'string') {
            ws.send(JSON.stringify({ type: 'error', error: 'Invalid message.type', id: parsedObj.id }));
            return;
          }
          message = parsedObj;

          // 检查是否为 VSCode→Chrome 请求的响应
          if (message.id && this.pendingRequests.has(String(message.id))) {
            const pending = this.pendingRequests.get(String(message.id))!;
            this.pendingRequests.delete(String(message.id));
            clearTimeout(pending.timer);
            if (message.type === 'error') {
              pending.reject(new Error((message as any).error || 'Chrome 请求失败'));
            } else {
              pending.resolve(message.data ?? message);
            }
            return;
          }

          if (message.type === 'create-note') {
            const payload: ChromeRequestPayload = message.data || {};
            const html: string = payload.html || '';
            const title: string | undefined = payload.title || undefined;
            const url: string | undefined = payload.url || undefined;

            if (!html || typeof html !== 'string') {
              ws.send(JSON.stringify({
                type: 'error',
                error: 'Missing html',
                id: message.id
              }));
              return;
            }

            // 限制大小 50MB
            if (html.length > 50 * 1024 * 1024) {
              ws.send(JSON.stringify({
                type: 'error',
                error: 'Content too large',
                id: message.id
              }));
              return;
            }

            const created = await createIssueFromHtml({ html, title, url, imageProcessOptions: DEFAULT_IMAGE_PROCESS_OPTIONS });
            ws.send(JSON.stringify({
              type: 'success',
              path: created?.toString(),
              id: message.id
            }));
          } else if (message.type === 'get-issue-tree') {
            // 返回轻量化的 issue tree（不包含完整 content），用于 Chrome 扩展按需加载
            try {
              const treeData = await readTree();
              const issueDir = getIssueDir();

              if (!issueDir) {
                ws.send(JSON.stringify({ type: 'error', error: 'Issue directory not configured', id: message.id }));
                return;
              }


              const buildMeta = async (node: IssueNode): Promise<IssueTreeMetaNode> => {
                const md = await getIssueMarkdown(node.filePath);
                const title = md ? md.title : '不合法 issueMarkdown';
                const children: IssueTreeMetaNode[] = node.children && node.children.length > 0
                  ? await Promise.all(node.children.map(child => buildMeta(child)))
                  : [];

                return {
                  id: node.id,
                  filePath: node.filePath,
                  absolutePath: path.join(issueDir, node.filePath),
                  title,
                  hasChildren: !!(node.children && node.children.length > 0),
                  children,
                  expanded: node.expanded ?? false
                };
              };

              const data = await Promise.all(
                treeData.rootNodes
                  .map(node => buildMeta(node))
              );

              ws.send(JSON.stringify({ type: 'issue-tree', data, id: message.id }));
            } catch (e: unknown) {
              this.logger.error('[ChromeIntegration] 获取 issue tree 失败', e as Error ?? e);
              const errorMessage = e instanceof Error ? e.message : String(e);
              ws.send(JSON.stringify({ type: 'error', error: errorMessage, id: message?.id }));
            }
          } else if (message.type === 'get-issue-content') {
            // 按需返回单个 issue 的 markdown 内容
            try {
              const data = message.data as Record<string, unknown> | undefined;
              const filePath = typeof data?.filePath === 'string' ? data!.filePath : undefined;
              if (!filePath) {
                ws.send(JSON.stringify({ type: 'error', error: 'Missing filePath', id: message?.id }));
                return;
              }

              const issueDir = getIssueDir();
              if (!issueDir) {
                ws.send(JSON.stringify({ type: 'error', error: 'Issue directory not configured', id: message.id }));
                return;
              }

              const absolutePath = path.join(issueDir, filePath);
              let content = '';
              let mtime: number | undefined = undefined;
              try {
                const fileUri = vscode.Uri.file(absolutePath);
                const fileContent = await vscode.workspace.fs.readFile(fileUri);
                content = Buffer.from(fileContent).toString('utf8');
                try {
                  const stat = await vscode.workspace.fs.stat(fileUri);
                  mtime = stat.mtime;
                } catch { /* ignore */ }
              } catch (e: unknown) {
                this.logger.warn(`无法读取文件: ${absolutePath}`, e as Error ?? e);
              }

              ws.send(JSON.stringify({ type: 'issue-content', data: { filePath, content, mtime }, id: message?.id }));
            } catch (e: unknown) {
              this.logger.error('[ChromeIntegration] 获取 issue content 失败', e as Error ?? e);
              const errorMessage = e instanceof Error ? e.message : String(e);
              ws.send(JSON.stringify({ type: 'error', error: errorMessage, id: message?.id }));
            }
          } else if (message.type === 'execute-command') {
            // 远程执行受限命令
            try {
              interface ExecuteCommandPayload {
                command: string;
                args?: any[];
              }
              const payload = (message.data || {}) as Partial<ExecuteCommandPayload>;
              const command = payload.command;
              const args = payload.args || [];
              const allowedCommands = ['issueManager.generateTitleCommand', 'issueManager.generateBriefSummaryCommand'];
              if (!command || !allowedCommands.includes(command)) {
                ws.send(JSON.stringify({ type: 'error', error: 'Command not allowed', id: message.id }));
                return;
              }

              // 如果第一个参数包含 filePath，则做路径校验
              if (args.length > 0 && typeof args[0] === 'object' && args[0] !== null && (args[0].filePath || args[0].file)) {
                const filePath = args[0].filePath || args[0].file;
                const issueDir = getIssueDir();
                if (!issueDir) {
                  ws.send(JSON.stringify({ type: 'error', error: 'Issue directory not configured', id: message.id }));
                  return;
                }

                const resolved = path.normalize(path.join(issueDir, filePath));
                const normalizedIssueDir = path.normalize(issueDir);
                if (!resolved.startsWith(normalizedIssueDir)) {
                  ws.send(JSON.stringify({ type: 'error', error: 'Invalid filePath', id: message.id }));
                  return;
                }

                args[0] = vscode.Uri.file(resolved);
              }

              await vscode.commands.executeCommand(command, ...(args || []));
              ws.send(JSON.stringify({ type: 'success', id: message.id }));
            } catch (e: unknown) {
              const errorMessage = e instanceof Error ? e.message : String(e);
              ws.send(JSON.stringify({ type: 'error', error: errorMessage, id: message.id }));
            }
          } else if (message.type === 'get-llm-models') {
            // 查询当前可用的 Copilot 模型列表（供 Chrome 扩展动态展示）
            try {
              const allModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
              const modelList = allModels.map(m => ({
                id: (m as any).id || m.family,
                family: m.family,
                vendor: m.vendor,
                maxInputTokens: m.maxInputTokens,
              }));
              ws.send(JSON.stringify({ type: 'llm-models', data: modelList, id: message.id }));
            } catch (e: unknown) {
              const errMsg = e instanceof Error ? e.message : String(e);
              ws.send(JSON.stringify({ type: 'error', error: errMsg, id: message.id }));
            }
          } else if (message.type === 'ping') {
            // 心跳响应
            ws.send(JSON.stringify({ type: 'pong', id: message.id }));
          } else if (message.type === 'llm-request') {
            // 来自 Chrome 扩展的 LLM 请求（转发到 Copilot/LLMService），支持流式推送
            try {
              const payload = message.data as any || {};
              const prompt = payload.prompt || payload.text || '';

              if (!prompt || typeof prompt !== 'string') {
                ws.send(JSON.stringify({ type: 'error', error: 'Missing prompt', id: message.id }));
                return;
              }

              // 动态导入以避免循环依赖问题
              const mod = await import('../llm/LLMService');
              const LLMServiceClass = (mod as any).LLMService;

              // 将历史对话 history: {role: 'user'|'assistant', content: string}[]
              // 转换为 VS Code LanguageModelChatMessage 数组，实现多轮上下文
              const history: Array<{ role: string; content: string }> = Array.isArray(payload.history) ? payload.history : [];
              const chatMessages: vscode.LanguageModelChatMessage[] = [
                ...history.map(h => {
                  if (h.role === 'assistant') {
                    return vscode.LanguageModelChatMessage.Assistant(h.content || '');
                  }
                  return vscode.LanguageModelChatMessage.User(h.content || '');
                }),
                vscode.LanguageModelChatMessage.User(prompt)
              ];

              const msgId = message?.id;
              // 提取客户端指定的模型 family（Chrome 扩展下拉选择的模型）
              const requestedModelFamily: string | undefined = payload.model
                ? String(payload.model)
                : undefined;

              this.logger.info(`[ChromeIntegration] LLM 请求模型: ${requestedModelFamily ?? '(VS Code 配置默认)'}`);

              // 先发送一个 started 推送（可选）
              ws.send(JSON.stringify({ type: 'llm-push', data: { event: 'started' }, id: msgId }));

              // 流式调用：携带完整历史上下文，传入指定模型 family
              const result = await LLMServiceClass.stream(chatMessages, (chunk: string) => {
                try {
                  ws.send(JSON.stringify({ type: 'llm-push', data: { chunk }, id: msgId }));
                } catch (e) {
                  this.logger.warn('[ChromeIntegration] 发送 llm-push chunk 失败', e as Error ?? e);
                }
              }, { modelFamily: requestedModelFamily });

              if (!result) {
                ws.send(JSON.stringify({ type: 'error', error: 'No available LLM model', id: msgId }));
                return;
              }

              // 流结束，发送最终回复
              ws.send(JSON.stringify({ type: 'llm-reply', data: { reply: result.text, modelFamily: result.modelFamily }, id: msgId }));
            } catch (e: unknown) {
              const errMsg = e instanceof Error ? e.message : String(e);
              try {
                ws.send(JSON.stringify({ type: 'error', error: errMsg, id: message?.id }));
              } catch { }
            }
          } else if (message.type === 'start-web-agent') {
            // Chrome Side Panel 发起的 Web Research Agent 任务
            try {
              const payload = message.data as any || {};
              const taskText = payload.task || '';
              if (!taskText || typeof taskText !== 'string') {
                ws.send(JSON.stringify({ type: 'error', error: '请提供研究任务描述', id: message.id }));
                return;
              }

              // @ts-ignore webpack resolves .ts directly
              const agentMod = await import('../webAgent/WebAgentService');
              const agent = agentMod.WebAgentService.getInstance();
              const taskId = `agent-${Date.now()}`;

              // 先告知 Chrome 任务已启动
              ws.send(JSON.stringify({ type: 'web-agent-started', id: message.id, data: { taskId } }));

              // 异步执行研究任务，进度事件实时推送
              agent.startResearch(
                { id: taskId, task: taskText, createdAt: Date.now() },
                (event) => {
                  try {
                    ws.send(JSON.stringify({ type: 'web-agent-progress', data: event, taskId }));
                  } catch { /* 连接可能已断开 */ }
                },
              ).then((result) => {
                try {
                  ws.send(JSON.stringify({ type: 'web-agent-complete', data: result, taskId }));
                } catch { /* ignore */ }
              }).catch((e: unknown) => {
                const errMsg = e instanceof Error ? e.message : String(e);
                try {
                  ws.send(JSON.stringify({ type: 'web-agent-error', data: { error: errMsg }, taskId }));
                } catch { /* ignore */ }
              });
            } catch (e: unknown) {
              const errMsg = e instanceof Error ? e.message : String(e);
              ws.send(JSON.stringify({ type: 'error', error: errMsg, id: message.id }));
            }

          } else if (message.type === 'llm-request-with-tools') {
            // 带工具调用的 LLM 请求（支持 search_issues, web_search, create_issue_tree 等）
            try {
              const payload = message.data as any || {};
              const prompt = payload.prompt || payload.text || '';
              if (!prompt || typeof prompt !== 'string') {
                ws.send(JSON.stringify({ type: 'error', error: 'Missing prompt', id: message.id }));
                return;
              }

              const history: Array<{ role: string; content: string }> = Array.isArray(payload.history) ? payload.history : [];

              // 构建系统提示（Chrome 面板上下文）
              const systemContent = '[系统] 你是一个运行在 Chrome 浏览器侧边面板中的 AI 助手。\n\n'
                + '[搜索与抓取]\n'
                + '- web_search: 通过搜索引擎搜索并返回结果页面文本\n'
                + '- fetch_url: 访问 URL 并提取页面文本内容\n\n'
                + '[笔记工具]\n'
                + '- search_issues: 搜索笔记\n'
                + '- read_issue: 读取笔记内容\n'
                + '- create_issue: 创建单个笔记\n'
                + '- create_issue_tree: 创建层级结构的笔记树（推荐）\n'
                + '- list_issue_tree: 查看笔记树结构\n'
                + '- update_issue: 更新已有笔记\n\n'
                + '[使用指引]\n'
                + '- 用户要求搜索某个话题 → 使用 web_search\n'
                + '- 用户要求创建笔记 → 优先使用 create_issue_tree\n'
                + '- 请积极使用工具来完成用户的请求，不要仅仅用文字回复可以操作的事情。';

              const chatMessages: vscode.LanguageModelChatMessage[] = [
                vscode.LanguageModelChatMessage.User(systemContent),
                ...history.map((h: { role: string; content: string }) =>
                  h.role === 'assistant'
                    ? vscode.LanguageModelChatMessage.Assistant(h.content || '')
                    : vscode.LanguageModelChatMessage.User(h.content || ''),
                ),
                vscode.LanguageModelChatMessage.User(prompt),
              ];

              const msgId = message?.id;
              const requestedModelFamily: string | undefined = payload.model ? String(payload.model) : undefined;

              // @ts-ignore webpack resolves .ts directly
              const chatToolsMod = await import('../llmChat/chatTools');
              const { CHAT_TOOLS, executeChatTool } = chatToolsMod;

              // @ts-ignore webpack resolves .ts directly
              const mod = await import('../llm/LLMService');
              const LLMServiceClass = (mod as any).LLMService;

              this.logger.info(`[ChromeChat] llm-request-with-tools | model=${requestedModelFamily ?? 'default'} | tools=${CHAT_TOOLS.length} | msgs=${chatMessages.length} | prompt=${prompt.slice(0, 80)}`);
              ws.send(JSON.stringify({ type: 'llm-push', data: { event: 'started' }, id: msgId }));

              const _logger = this.logger;
              const result = await LLMServiceClass.streamWithTools(
                chatMessages,
                CHAT_TOOLS,
                (chunk: string) => {
                  try { ws.send(JSON.stringify({ type: 'llm-push', data: { chunk }, id: msgId })); } catch { }
                },
                async (toolName: string, input: Record<string, unknown>): Promise<string> => {
                  _logger.info(`[ChromeChat] 工具调用: ${toolName}`, input);
                  const summary = getToolInputSummary(toolName, input);
                  try { ws.send(JSON.stringify({ type: 'llm-push', data: { event: 'tool_call', toolName, summary }, id: msgId })); } catch { }
                  const res = await executeChatTool(toolName, input, { autonomous: true });
                  const preview = typeof res.content === 'string' ? res.content.slice(0, 300) : '';
                  _logger.info(`[ChromeChat] 工具结果: ${toolName} | success=${res.success} | ${preview.slice(0, 100)}`);
                  try { ws.send(JSON.stringify({ type: 'llm-push', data: { event: 'tool_result', toolName, preview, success: res.success }, id: msgId })); } catch { }
                  return res.content;
                },
                { modelFamily: requestedModelFamily, maxToolRounds: 10 },
              );

              if (!result) {
                this.logger.warn('[ChromeChat] streamWithTools 返回 null（无可用模型）');
                ws.send(JSON.stringify({ type: 'error', error: 'No available LLM model', id: msgId }));
                return;
              }
              this.logger.info(`[ChromeChat] 完成 | 响应长度=${result.text.length}字 | model=${result.modelFamily}`);
              ws.send(JSON.stringify({ type: 'llm-reply', data: { reply: result.text, modelFamily: result.modelFamily }, id: msgId }));
            } catch (e: unknown) {
              const errMsg = e instanceof Error ? e.message : String(e);
              try { ws.send(JSON.stringify({ type: 'error', error: errMsg, id: message?.id })); } catch { }
            }

          } else if (message.type === 'cancel-web-agent') {
            // 取消正在运行的 Agent 任务
            try {
              const payload = message.data as any || {};
              const taskId = payload.taskId || '';
              // @ts-ignore webpack resolves .ts directly
              const agentMod = await import('../webAgent/WebAgentService');
              const agent = agentMod.WebAgentService.getInstance();
              agent.cancelTask(taskId);
              ws.send(JSON.stringify({ type: 'web-agent-cancelled', id: message.id, taskId }));
            } catch (e: unknown) {
              const errMsg = e instanceof Error ? e.message : String(e);
              ws.send(JSON.stringify({ type: 'error', error: errMsg, id: message.id }));
            }

          } else if (message.type === 'chrome-chat-list') {
            // 获取所有 Chrome 面板聊天对话列表
            try {
              // @ts-ignore webpack resolves .ts directly
              const mod = await import('../llmChat/llmChatDataManager');
              const convos = await mod.getAllChromeChatConversations();
              ws.send(JSON.stringify({ type: 'chrome-chat-list-result', data: convos, id: message.id }));
            } catch (e: unknown) {
              const errMsg = e instanceof Error ? e.message : String(e);
              ws.send(JSON.stringify({ type: 'error', error: errMsg, id: message.id }));
            }

          } else if (message.type === 'chrome-chat-create') {
            // 创建新的 Chrome 面板聊天对话
            try {
              const payload = (message.data || {}) as { title?: string };
              // @ts-ignore webpack resolves .ts directly
              const mod = await import('../llmChat/llmChatDataManager');
              const result = await mod.createChromeChatConversation(payload.title);
              if (result) {
                ws.send(JSON.stringify({ type: 'chrome-chat-create-result', data: result, id: message.id }));
              } else {
                ws.send(JSON.stringify({ type: 'error', error: '创建对话失败', id: message.id }));
              }
            } catch (e: unknown) {
              const errMsg = e instanceof Error ? e.message : String(e);
              ws.send(JSON.stringify({ type: 'error', error: errMsg, id: message.id }));
            }

          } else if (message.type === 'chrome-chat-delete') {
            // 删除 Chrome 面板聊天对话
            try {
              const payload = (message.data || {}) as { id?: string };
              if (!payload.id) {
                ws.send(JSON.stringify({ type: 'error', error: 'Missing id', id: message.id }));
                return;
              }
              // @ts-ignore webpack resolves .ts directly
              const mod = await import('../llmChat/llmChatDataManager');
              const ok = await mod.deleteChromeChatConversation(payload.id);
              ws.send(JSON.stringify({ type: ok ? 'success' : 'error', error: ok ? undefined : '删除失败', id: message.id }));
            } catch (e: unknown) {
              const errMsg = e instanceof Error ? e.message : String(e);
              ws.send(JSON.stringify({ type: 'error', error: errMsg, id: message.id }));
            }

          } else if (message.type === 'chrome-chat-rename') {
            // 重命名 Chrome 面板聊天对话
            try {
              const payload = (message.data || {}) as { id?: string; title?: string };
              if (!payload.id || !payload.title) {
                ws.send(JSON.stringify({ type: 'error', error: 'Missing id or title', id: message.id }));
                return;
              }
              // @ts-ignore webpack resolves .ts directly
              const mod = await import('../llmChat/llmChatDataManager');
              const ok = await mod.renameChromeChatConversation(payload.id, payload.title);
              ws.send(JSON.stringify({ type: ok ? 'success' : 'error', error: ok ? undefined : '重命名失败', id: message.id }));
            } catch (e: unknown) {
              const errMsg = e instanceof Error ? e.message : String(e);
              ws.send(JSON.stringify({ type: 'error', error: errMsg, id: message.id }));
            }

          } else if (message.type === 'chrome-chat-messages') {
            // 获取 Chrome 面板聊天对话的消息列表
            try {
              const payload = (message.data || {}) as { id?: string };
              if (!payload.id) {
                ws.send(JSON.stringify({ type: 'error', error: 'Missing id', id: message.id }));
                return;
              }
              // @ts-ignore webpack resolves .ts directly
              const mod = await import('../llmChat/llmChatDataManager');
              const messages = await mod.getChromeChatMessages(payload.id);
              ws.send(JSON.stringify({ type: 'chrome-chat-messages-result', data: messages, id: message.id }));
            } catch (e: unknown) {
              const errMsg = e instanceof Error ? e.message : String(e);
              ws.send(JSON.stringify({ type: 'error', error: errMsg, id: message.id }));
            }

          } else if (message.type === 'chrome-chat-append') {
            // 向 Chrome 面板聊天对话追加消息
            try {
              const payload = (message.data || {}) as { id?: string; role?: string; content?: string };
              if (!payload.id || !payload.role || !payload.content) {
                ws.send(JSON.stringify({ type: 'error', error: 'Missing id, role, or content', id: message.id }));
                return;
              }
              // @ts-ignore webpack resolves .ts directly
              const mod = await import('../llmChat/llmChatDataManager');
              const ok = await mod.appendChromeChatMessage(payload.id, payload.role as 'user' | 'assistant', payload.content);
              ws.send(JSON.stringify({ type: ok ? 'success' : 'error', error: ok ? undefined : '追加消息失败', id: message.id }));
            } catch (e: unknown) {
              const errMsg = e instanceof Error ? e.message : String(e);
              ws.send(JSON.stringify({ type: 'error', error: errMsg, id: message.id }));
            }

          } else {
            ws.send(JSON.stringify({
              type: 'error',
              error: 'Unknown message type',
              id: message.id
            }));
          }
        } catch (e: unknown) {
          this.logger.error('[ChromeIntegration] 消息处理失败', e as Error ?? e);
          const errorMessage = e instanceof Error ? e.message : String(e);
          try {
            ws.send(JSON.stringify({
              type: 'error',
              error: errorMessage,
              id: message?.id
            }));
          } catch {
            // ignore
          }
        }
      });

      // 处理连接关闭
      ws.on('close', () => {
        this.logger.info('[ChromeIntegration] Chrome 扩展已断开连接');
      });

      // 处理错误
      ws.on('error', (error: Error) => {
        this.logger.error('[ChromeIntegration] WebSocket 错误', error);
      });
    });

    this.httpServer.listen(port, '127.0.0.1', () => {
      this.logger.info(`[ChromeIntegration] WebSocket 服务已启动: ws://127.0.0.1:${port}/ws`);

      // 可选：将端口信息显示在状态栏
      vscode.window.setStatusBarMessage(
        `$(broadcast) Chrome 扩展端口: ${port}`,
        5000
      );
    });

    context.subscriptions.push({
      dispose: () => this.stop()
    });
  }

  /**
   * 查找可用端口
   */
  private async findAvailablePort(startPort: number, endPort: number): Promise<number> {
    for (let port = startPort; port <= endPort; port++) {
      if (await this.isPortAvailable(port)) {
        return port;
      }
    }
    // 如果没有找到可用端口，使用起始端口（会报错，但至少有个明确的错误信息）
    this.logger.warn(`[ChromeIntegration] 端口范围 ${startPort}-${endPort} 内没有可用端口，使用 ${startPort}`);
    return startPort;
  }

  /**
   * 检查端口是否可用
   */
  private isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();

      server.once('error', () => {
        resolve(false);
      });

      server.once('listening', () => {
        server.close();
        resolve(true);
      });

      server.listen(port, '127.0.0.1');
    });
  }

  public stop(): void {
    if ((!this.httpServer && !this.wss) || this.disposed) {
      return;
    }
    this.disposed = true;

    try {
      // 关闭所有 WebSocket 连接
      if (this.wss) {
        this.wss.clients.forEach((client: WebSocket) => {
          if (client.readyState === WebSocket.OPEN) {
            client.close();
          }
        });
        this.wss.close(() => {
          this.logger.info('[ChromeIntegration] WebSocket 服务已停止');
        });
        this.wss = null;
      }

      // 关闭 HTTP 服务器
      if (this.httpServer) {
        this.httpServer.close(() => {
          this.logger.info('[ChromeIntegration] HTTP 服务器已停止');
        });
        this.httpServer = null;
      }
    } catch (e) {
      this.logger.warn('[ChromeIntegration] 停止服务时出错', e);
    }
  }
}

/** 为工具调用生成简短摘要，用于推送给 Chrome 端显示 */
function getToolInputSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'web_search': return `搜索: ${input.query || ''}`;
    case 'fetch_url': return `访问: ${input.url || ''}`;
    case 'search_issues': return `检索: ${input.query || ''}`;
    case 'read_issue': return `读取: ${input.filename || ''}`;
    case 'create_issue': return `创建: ${input.title || ''}`;
    case 'create_issue_tree': return `创建笔记树: ${(input.nodes as any[])?.length ?? 0} 个节点`;
    case 'update_issue': return `更新: ${input.filename || ''}`;
    default: return JSON.stringify(input).slice(0, 80);
  }
}
