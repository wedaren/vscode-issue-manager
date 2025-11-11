import * as vscode from 'vscode';
import * as http from 'http';
import * as net from 'net';
import { URL } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { createIssueFromHtml } from '../commands/createIssueFromHtml';
import { Logger } from '../core/utils/Logger';
import { readFocused } from '../data/focusedManager';
import { readTree, IssueTreeNode } from '../data/treeManager';
import { TitleCacheService } from '../services/TitleCacheService';
import * as path from 'path';
import { getIssueDir } from '../config';
import { SharedConfig } from '../config/SharedConfig';


interface ChromeRequestPayload {  
  html?: string;  
  title?: string;  
  url?: string;  
} 

const URI_PATH_OPEN_DIR = '/open-issue-dir';  
const URI_PATH_CREATE_FROM_HTML = '/create-from-html';  
const COMMAND_OPEN_ISSUE_DIR = 'issueManager.openIssueDir';  


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
        let message: any;
        try {
          message = JSON.parse(data.toString('utf8'));
          this.logger.debug('[ChromeIntegration] 收到消息', message);

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

            // 限制大小 5MB
            if (html.length > 5 * 1024 * 1024) {
              ws.send(JSON.stringify({ 
                type: 'error', 
                error: 'Content too large',
                id: message.id 
              }));
              return;
            }

            const created = await createIssueFromHtml({ html, title, url });
            ws.send(JSON.stringify({ 
              type: 'success', 
              path: created?.toString(),
              id: message.id 
            }));
          } else if (message.type === 'get-focused-issues') {
            // 获取关注问题树结构
            try {
              const focusedData = await readFocused();
              const treeData = await readTree();
              const issueDir = getIssueDir();
              
              if (!issueDir) {
                ws.send(JSON.stringify({ 
                  type: 'error', 
                  error: 'Issue directory not configured',
                  id: message.id 
                }));
                return;
              }

              // 构建 id 到节点的映射
              const idToNode = new Map<string, IssueTreeNode>();
              const collectMap = (nodes: IssueTreeNode[]) => {
                for (const node of nodes) {
                  idToNode.set(node.id, node);
                  if (node.children) { 
                    collectMap(node.children); 
                  }
                }
              };
              collectMap(treeData.rootNodes);

              // 获取标题缓存服务
              const titleCache = TitleCacheService.getInstance();
              
              // 递归构建树节点，包含子节点和 markdown 内容
              const buildTreeNode = async (node: IssueTreeNode): Promise<any> => {
                const title = await titleCache.get(node.filePath) ?? path.basename(node.filePath, '.md');
                const absolutePath = path.join(issueDir, node.filePath);
                
                // 读取 markdown 文件内容
                let content = '';
                try {
                  const fileUri = vscode.Uri.file(absolutePath);
                  const fileContent = await vscode.workspace.fs.readFile(fileUri);
                  content = Buffer.from(fileContent).toString('utf8');
                } catch (e) {
                  this.logger.warn(`无法读取文件: ${absolutePath}`, e);
                }
                
                // 递归处理子节点
                const children = node.children && node.children.length > 0
                  ? await Promise.all(node.children.map(child => buildTreeNode(child)))
                  : [];
                
                return {
                  id: node.id,
                  filePath: node.filePath,
                  absolutePath: absolutePath,
                  title: title,
                  content: content,
                  children: children,
                  expanded: node.expanded ?? false
                };
              };
              
              // 构建关注问题的树结构（每个关注的问题作为根节点，包含其完整子树）
              const focusedTrees = await Promise.all(
                focusedData.focusList
                  .map(id => idToNode.get(id))
                  .filter((node): node is IssueTreeNode => node !== undefined)
                  .map(node => buildTreeNode(node))
              );

              ws.send(JSON.stringify({ 
                type: 'focused-issues', 
                data: focusedTrees,
                id: message.id 
              }));
            } catch (e: any) {
              this.logger.error('[ChromeIntegration] 获取关注问题失败', e);
              ws.send(JSON.stringify({ 
                type: 'error', 
                error: e?.message || String(e),
                id: message.id 
              }));
            }
          } else if (message.type === 'ping') {
            // 心跳响应
            ws.send(JSON.stringify({ type: 'pong', id: message.id }));
          } else {
            ws.send(JSON.stringify({ 
              type: 'error', 
              error: 'Unknown message type',
              id: message.id 
            }));
          }
        } catch (e: any) {
          this.logger.error('[ChromeIntegration] 消息处理失败', e);
          try {
            ws.send(JSON.stringify({ 
              type: 'error', 
              error: e?.message || String(e),
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
