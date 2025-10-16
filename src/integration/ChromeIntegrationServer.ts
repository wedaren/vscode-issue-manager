import * as vscode from 'vscode';
import * as http from 'http';
import { URL } from 'url';
import { createIssueFromHtml } from '../commands/createIssueFromHtml';

/**
 * 负责 VSCode 端与 Chrome 扩展集成：
 * - 本地 HTTP 服务：POST /create-note
 * - URI Handler：vscode://wedaren.issue-manager/create-from-html?data=...
 */
export class ChromeIntegrationServer {
  private static instance: ChromeIntegrationServer | null = null;
  private server: http.Server | null = null;
  private disposed = false;

  public static getInstance(): ChromeIntegrationServer {
    if (!this.instance) {
      this.instance = new ChromeIntegrationServer();
    }
    return this.instance;
  }

  public async start(context: vscode.ExtensionContext): Promise<void> {
    if (this.server) {
      return; // 已启动
    }

    const config = vscode.workspace.getConfiguration('issueManager');
    const enable = config.get<boolean>('chromeIntegration.enableServer', true);
    const port = config.get<number>('chromeIntegration.port', 37892);

    // URI Handler（无论是否开启本地服务，都注册，备用）
    const uriHandler: vscode.UriHandler = {
      handleUri: async (uri: vscode.Uri) => {
        try {
          // 仅处理路径 /create-from-html
          if (uri.path !== '/create-from-html') {
            return;
          }
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
              console.error('URI data 参数解析失败:', e);
            }
          }

          if (!html) {
            void vscode.window.showErrorMessage('链接中缺少 html 内容，无法创建笔记');
            return;
          }

          await createIssueFromHtml({ html, title, url });
        } catch (e: any) {
          console.error('URI 处理失败:', e);
          void vscode.window.showErrorMessage('处理来自浏览器的创建请求失败');
        }
      }
    };
    context.subscriptions.push(vscode.window.registerUriHandler(uriHandler));

    if (!enable) {
      console.log('[ChromeIntegration] 本地服务未启用（已注册 URI Handler 作为备用）');
      return;
    }

    this.server = http.createServer(async (req, res) => {
      try {
        // CORS 头
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        if (req.method !== 'POST' || !req.url) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'Not Found' }));
          return;
        }

        const urlObj = new URL(`http://localhost${req.url}`);
        if (urlObj.pathname !== '/create-note') {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'Not Found' }));
          return;
        }

        // 读取请求体，限制大小 5MB
        const chunks: Buffer[] = [];
        let total = 0;
        const MAX = 5 * 1024 * 1024;
        await new Promise<void>((resolve, reject) => {
          req.on('data', (chunk: Buffer) => {
            total += chunk.length;
            if (total > MAX) {
              reject(new Error('Payload too large'));
              try { req.destroy(); } catch {}
              return;
            }
            chunks.push(chunk);
          });
          req.on('end', () => resolve());
          req.on('error', (err) => reject(err));
        });

        const raw = Buffer.concat(chunks).toString('utf8');
        let body: any = {};
        try {
          body = JSON.parse(raw);
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
          return;
        }

        const html: string = body.html || '';
        const title: string | undefined = body.title || undefined;
        const pageUrl: string | undefined = body.url || undefined;
        if (!html || typeof html !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'Missing html' }));
          return;
        }

        const created = await createIssueFromHtml({ html, title, url: pageUrl });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, path: created?.toString() }));
      } catch (e: any) {
        console.error('[ChromeIntegration] 请求处理失败:', e);
        try {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: e?.message || String(e) }));
        } catch {
          // ignore
        }
      }
    });

    this.server.listen(port, '127.0.0.1', () => {
      console.log(`[ChromeIntegration] 本地服务已启动: http://127.0.0.1:${port}/create-note`);
    });

    context.subscriptions.push({
      dispose: () => this.stop()
    });
  }

  public stop(): void {
    if (!this.server || this.disposed) {
      return;
    }
    this.disposed = true;
    try {
      this.server.close(() => {
        console.log('[ChromeIntegration] 本地服务已停止');
      });
    } catch (e) {
      console.warn('[ChromeIntegration] 停止服务时出错:', e);
    } finally {
      this.server = null;
    }
  }
}
