import * as vscode from 'vscode';
import * as path from 'path';
import { HostToWebviewMessage, WebviewToHostMessage } from './types';

/**
 * Webview 管理器
 * 负责创建、管理 Webview Panel 的生命周期和消息通信
 */
export class WebviewManager {
    private static instance: WebviewManager;
    private panels: Map<string, vscode.WebviewPanel> = new Map();

    private constructor(private context: vscode.ExtensionContext) { }

    public static getInstance(context?: vscode.ExtensionContext): WebviewManager {
        if (!WebviewManager.instance && context) {
            WebviewManager.instance = new WebviewManager(context);
        }
        return WebviewManager.instance;
    }

    /**
     * 创建 G6 关系图 Webview Panel
     */
    public createG6GraphPanel(title: string): vscode.WebviewPanel {
        const panelId = `g6-graph`; // 使用固定的ID来复用面板  

        // 检查是否已存在面板
        const existingPanel = this.panels.get(panelId);
        if (existingPanel) {
            existingPanel.reveal();
            return existingPanel;
        }

        // 创建新面板
        const panel = vscode.window.createWebviewPanel(
            'issueManagerG6Graph',
            title,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: false, // 节省内存
                localResourceRoots: [
                    vscode.Uri.file(path.join(this.context.extensionPath, 'dist', 'webview'))
                ]
            }
        );

        // 设置 HTML 内容
        panel.webview.html = this.getG6GraphHtml(panel.webview);

        // 注册清理逻辑
        panel.onDidDispose(() => {
            this.panels.delete(panelId);
        });

        this.panels.set(panelId, panel);
        return panel;
    }

    /**
     * 发送消息到 Webview
     */
    public postMessage(panel: vscode.WebviewPanel, message: HostToWebviewMessage): void {
        panel.webview.postMessage(message);
    }

    /**
     * 监听来自 Webview 的消息
     */
    public onMessage(
        panel: vscode.WebviewPanel,
        handler: (message: WebviewToHostMessage) => void
    ): vscode.Disposable {
        return panel.webview.onDidReceiveMessage(handler);
    }

    /**
     * 生成 G6 Graph 的 HTML 内容
     */
    private getG6GraphHtml(webview: vscode.Webview): string {
        // 获取 Webview 脚本的 URI
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.file(path.join(this.context.extensionPath, 'dist', 'webview', 'g6-graph.js'))
        );

        // 生成 nonce 用于 CSP
        const nonce = this.getNonce();

        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" 
          content="default-src 'none'; 
                   img-src ${webview.cspSource} https:; 
                   script-src 'nonce-${nonce}'; 
                   style-src ${webview.cspSource} 'unsafe-inline';">
    <title>问题关系图</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            overflow: hidden;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
        }
        #container {
            width: 100vw;
            height: 100vh;
        }
        .loading {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            font-size: 16px;
            color: var(--vscode-foreground);
        }
    </style>
</head>
<body>
    <div id="container">
        <div class="loading">正在加载关系图...</div>
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    /**
     * 生成随机 nonce 用于 CSP
     */
    private getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    /**
     * 获取当前主题配置
     */
    public getCurrentTheme(): 'light' | 'dark' {
        const theme = vscode.window.activeColorTheme.kind;
        return theme === vscode.ColorThemeKind.Light ? 'light' : 'dark';
    }

    /**
     * 创建 X6 思维导图 Webview Panel
     */
    public createMindMapPanel(title: string): vscode.WebviewPanel {
        const panelId = `x6-mindmap-${Date.now()}`;
        const panel = vscode.window.createWebviewPanel(
            'issueManagerX6MindMap',
            title,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(this.context.extensionPath, 'dist', 'webview'))
                ]
            }
        );

        panel.webview.html = this.getMindMapHtml(panel.webview);

        panel.onDidDispose(() => {
            this.panels.delete(panelId);
        });

        this.panels.set(panelId, panel);
        return panel;
    }

    /**
     * 生成 X6 MindMap 的 HTML 内容
     */
    private getMindMapHtml(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.file(path.join(this.context.extensionPath, 'dist', 'webview', 'x6-mindmap.js'))
        );
        const nonce = this.getNonce();

        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" 
          content="default-src 'none'; 
                   img-src ${webview.cspSource} https:; 
                   script-src 'nonce-${nonce}'; 
                   style-src ${webview.cspSource} 'unsafe-inline';">
    <title>思维导图</title>
    <style>
        body { margin: 0; padding: 0; overflow: hidden; background-color: var(--vscode-editor-background); }
        #container { width: 100vw; height: 100vh; }
        #toolbar {
            position: absolute;
            top: 20px;
            right: 20px;
            z-index: 10;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 4px;
            padding: 4px;
            display: flex;
            gap: 4px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        }
        .toolbar-btn {
            background: transparent;
            border: 1px solid transparent;
            color: var(--vscode-editor-foreground);
            cursor: pointer;
            padding: 6px;
            border-radius: 2px;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
        }
        .toolbar-btn:hover {
            background: var(--vscode-toolbar-hoverBackground);
        }
        .toolbar-btn:active {
            background: var(--vscode-toolbar-activeBackground);
        }
        .toolbar-btn svg {
            width: 16px;
            height: 16px;
            fill: currentColor;
        }
    </style>
</head>
<body>
    <div id="toolbar">
        <button class="toolbar-btn" id="zoom-in" title="放大">
            <svg viewBox="0 0 16 16"><path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/></svg>
        </button>
        <button class="toolbar-btn" id="zoom-out" title="缩小">
            <svg viewBox="0 0 16 16"><path d="M4 8a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7A.5.5 0 0 1 4 8z"/></svg>
        </button>
        <button class="toolbar-btn" id="fit-view" title="适应画布">
            <svg viewBox="0 0 16 16"><path d="M2 2a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2zm1 0v12h10V2H3z"/></svg>
        </button>
        <button class="toolbar-btn" id="center-content" title="居中">
            <svg viewBox="0 0 16 16"><path d="M8 2a6 6 0 1 1 0 12A6 6 0 0 1 8 2zm0 1a5 5 0 1 0 0 10A5 5 0 0 0 8 3zM8 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/></svg>
        </button>
    </div>
    <div id="container"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    /**
     * 清理所有面板
     */
    public dispose(): void {
        this.panels.forEach(panel => panel.dispose());
        this.panels.clear();
    }
}
