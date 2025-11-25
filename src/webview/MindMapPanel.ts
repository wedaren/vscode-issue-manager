import * as vscode from 'vscode';
import * as path from 'path';
import { IssueStructureNode } from '../views/IssueStructureProvider';
import { getIssueDir } from '../config';

/**
 * 思维导图数据节点接口
 */
export interface MindMapNode {
    id: string;
    title: string;
    filePath?: string;
    children?: MindMapNode[];
    hasError?: boolean;
    errorMessage?: string;
}

/**
 * 思维导图面板管理器
 * 使用 @antv/x6 和 @antv/hierarchy 渲染思维导图
 */
export class MindMapPanel {
    public static currentPanel: MindMapPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    /**
     * 创建或显示思维导图面板
     */
    public static createOrShow(extensionUri: vscode.Uri, data?: MindMapNode) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // 如果已经有面板打开，则显示它
        if (MindMapPanel.currentPanel) {
            MindMapPanel.currentPanel._panel.reveal(column);
            if (data) {
                MindMapPanel.currentPanel.updateData(data);
            }
            return;
        }

        // 否则，创建新面板
        const panel = vscode.window.createWebviewPanel(
            'issueManagerMindMap',
            '思维导图',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'node_modules'),
                    vscode.Uri.joinPath(extensionUri, 'dist')
                ]
            }
        );

        MindMapPanel.currentPanel = new MindMapPanel(panel, extensionUri, data);
    }

    /**
     * 从 IssueStructureNode 转换为 MindMapNode
     */
    public static convertFromStructureNode(node: IssueStructureNode): MindMapNode {
        return {
            id: node.id,
            title: node.title,
            filePath: node.filePath,
            hasError: node.hasError,
            errorMessage: node.errorMessage,
            children: node.children?.map(child => this.convertFromStructureNode(child))
        };
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, data?: MindMapNode) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        // 设置初始 HTML 内容
        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

        // 监听面板关闭事件
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // 处理来自 webview 的消息
        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.type) {
                    case 'ready':
                        // Webview 准备就绪，发送初始数据
                        if (data) {
                            this.updateData(data);
                        }
                        break;
                    case 'openFile':
                        // 打开文件
                        await this.openFile(message.filePath);
                        break;
                    case 'export':
                        // 导出图片
                        await this.exportImage(message.dataUrl, message.format);
                        break;
                    case 'error':
                        vscode.window.showErrorMessage(message.message);
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    /**
     * 更新思维导图数据
     */
    public updateData(data: MindMapNode) {
        this._panel.webview.postMessage({
            type: 'updateData',
            data: data
        });
    }

    /**
     * 打开文件
     */
    private async openFile(filePath: string): Promise<void> {
        try {
            const issueDir = getIssueDir();
            if (!issueDir) {
                vscode.window.showErrorMessage('问题目录未配置');
                return;
            }

            const fullPath = path.join(issueDir, filePath);
            const uri = vscode.Uri.file(fullPath);
            await vscode.window.showTextDocument(uri, { preview: false });
        } catch (error) {
            vscode.window.showErrorMessage(`无法打开文件: ${error}`);
        }
    }

    /**
     * 导出图片
     */
    private async exportImage(dataUrl: string, format: 'png' | 'svg'): Promise<void> {
        try {
            const defaultUri = vscode.Uri.file(
                path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', `mindmap.${format}`)
            );

            const uri = await vscode.window.showSaveDialog({
                defaultUri,
                filters: {
                    'Images': [format]
                }
            });

            if (uri) {
                // 将 base64 数据转换为 Buffer
                const base64Data = dataUrl.split(',')[1];
                const buffer = Buffer.from(base64Data, 'base64');
                await vscode.workspace.fs.writeFile(uri, buffer);
                vscode.window.showInformationMessage(`思维导图已导出到: ${uri.fsPath}`);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`导出失败: ${error}`);
        }
    }

    /**
     * 清理资源
     */
    public dispose() {
        MindMapPanel.currentPanel = undefined;

        this._panel.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }

    /**
     * 生成 Webview 的 HTML 内容
     */
    private _getHtmlForWebview(webview: vscode.Webview): string {
        // 使用本地打包的库文件
        const x6ScriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'dist', 'libs', 'x6.js')
        );
        const hierarchyScriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'dist', 'libs', 'hierarchy.js')
        );

        // 使用 nonce 来增强安全性
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; img-src data: ${webview.cspSource}; connect-src https:;">
    <title>思维导图</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            width: 100vw;
            height: 100vh;
            overflow: hidden;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            font-family: var(--vscode-font-family);
        }
        #toolbar {
            position: absolute;
            top: 10px;
            right: 10px;
            z-index: 1000;
            display: flex;
            gap: 8px;
        }
        .toolbar-btn {
            padding: 6px 12px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: 1px solid var(--vscode-button-border);
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            transition: background-color 0.2s;
        }
        .toolbar-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        #container {
            width: 100%;
            height: 100%;
        }
        .loading {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100%;
            font-size: 16px;
            color: var(--vscode-descriptionForeground);
        }
        /* 自定义右键菜单样式 */
        .x6-widget-context-menu {
            background-color: var(--vscode-menu-background) !important;
            border: 1px solid var(--vscode-menu-border) !important;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3) !important;
        }
        .x6-widget-context-menu-item {
            color: var(--vscode-menu-foreground) !important;
            padding: 6px 12px !important;
        }
        .x6-widget-context-menu-item:hover {
            background-color: var(--vscode-menu-selectionBackground) !important;
            color: var(--vscode-menu-selectionForeground) !important;
        }
    </style>
</head>
<body>
    <div id="toolbar">
        <button class="toolbar-btn" id="fitViewBtn">适应视图</button>
        <button class="toolbar-btn" id="exportPNGBtn">导出 PNG</button>
        <button class="toolbar-btn" id="exportSVGBtn">导出 SVG</button>
    </div>
    <div id="container">
        <div class="loading">正在加载思维导图...</div>
    </div>
    
    <script nonce="${nonce}">
        // 等待所有库加载完成
        let x6Loaded = false;
        let hierarchyLoaded = false;
        
        console.log('[MindMap] Script started');
        
        function checkAndInit() {
            console.log('[MindMap] checkAndInit called', { x6Loaded, hierarchyLoaded });
            if (x6Loaded && hierarchyLoaded) {
                console.log('[MindMap] Both libraries loaded, initializing...');
                initApp();
            }
        }
        
        function initApp() {
            console.log('[MindMap] initApp started');
            const vscode = acquireVsCodeApi();
            let graph = null;
            let currentData = null;

            // 检查库是否加载成功
            if (typeof X6 === 'undefined') {
                console.error('[MindMap] X6 library not loaded');
                document.getElementById('container').innerHTML = '<div class="loading">错误: X6 库加载失败</div>';
                vscode.postMessage({ type: 'error', message: 'X6 库加载失败' });
                return;
            }

            console.log('[MindMap] X6 loaded successfully', X6);

            if (typeof Hierarchy === 'undefined') {
                console.warn('[MindMap] Hierarchy library not loaded, will use simple layout');
            } else {
                console.log('[MindMap] Hierarchy loaded successfully', Hierarchy);
            }

            // 初始化图形
            function initGraph() {
                const container = document.getElementById('container');
                container.innerHTML = '';

                try {
                    graph = new X6.Graph({
                        container: container,
                        autoResize: true,
                        panning: {
                            enabled: true,
                            modifiers: 'shift'
                        },
                        mousewheel: {
                            enabled: true,
                            modifiers: 'ctrl',
                            minScale: 0.3,
                            maxScale: 3
                        },
                        background: {
                            color: 'transparent'
                        },
                        grid: {
                            visible: true,
                            type: 'dot',
                            args: {
                                color: 'var(--vscode-panel-border)',
                                thickness: 1
                            }
                        },
                        selecting: {
                            enabled: true,
                            rubberband: true,
                            showNodeSelectionBox: true
                        },
                        interacting: {
                            nodeMovable: true
                        }
                    });

                    // 节点点击事件 - 打开文件
                    graph.on('node:click', ({ node }) => {
                        const data = node.getData();
                        if (data && data.filePath && !data.hasError) {
                            vscode.postMessage({
                                type: 'openFile',
                                filePath: data.filePath
                            });
                        }
                    });

                    // 节点右键菜单
                    graph.on('node:contextmenu', ({ node, e }) => {
                        e.preventDefault();
                        const data = node.getData();
                        
                        // 创建简单的右键菜单
                        const menu = document.createElement('div');
                        menu.className = 'x6-widget-context-menu';
                        menu.style.position = 'fixed';
                        menu.style.left = e.clientX + 'px';
                        menu.style.top = e.clientY + 'px';
                        
                        const menuItems = [];
                        
                        if (data && data.filePath && !data.hasError) {
                            menuItems.push({
                                label: '打开文件',
                                action: () => {
                                    vscode.postMessage({
                                        type: 'openFile',
                                        filePath: data.filePath
                                    });
                                }
                            });
                        }
                        
                        menuItems.push({
                            label: '复制标题',
                            action: () => {
                                navigator.clipboard.writeText(node.getAttrByPath('label/text') || '');
                            }
                        });
                        
                        menuItems.forEach(item => {
                            const menuItem = document.createElement('div');
                            menuItem.className = 'x6-widget-context-menu-item';
                            menuItem.textContent = item.label;
                            menuItem.onclick = () => {
                                item.action();
                                document.body.removeChild(menu);
                            };
                            menu.appendChild(menuItem);
                        });
                        
                        document.body.appendChild(menu);
                        
                        // 点击其他地方关闭菜单
                        const closeMenu = (e) => {
                            if (!menu.contains(e.target)) {
                                document.body.removeChild(menu);
                                document.removeEventListener('click', closeMenu);
                            }
                        };
                        setTimeout(() => document.addEventListener('click', closeMenu), 0);
                    });

                    // 通知扩展 webview 已准备就绪
                    vscode.postMessage({ type: 'ready' });
                } catch (error) {
                    container.innerHTML = '<div class="loading">错误: 图形初始化失败 - ' + error.message + '</div>';
                    vscode.postMessage({ type: 'error', message: '图形初始化失败: ' + error.message });
                }
            }

            // 使用 @antv/hierarchy 计算布局
            function calculateLayout(data) {
                try {
                    // 使用 @antv/hierarchy 计算思维导图布局
                    const result = Hierarchy.mindmap(data, {
                        direction: 'H', // 水平方向
                        getHeight(d) {
                            return d.height || 60;
                        },
                        getWidth(d) {
                            return d.width || 120;
                        },
                        getHGap() {
                            return 40;
                        },
                        getVGap() {
                            return 20;
                        },
                        getSide: () => 'right'
                    });
                    return result;
                } catch (error) {
                    console.error('[MindMap] Layout calculation error:', error);
                    return data;
                }
            }

            // 获取节点样式
            function getNodeStyle(node) {
                const baseStyle = {
                    body: {
                        strokeWidth: 2,
                        rx: 6,
                        ry: 6
                    },
                    label: {
                        fontSize: 13,
                        fontWeight: 500
                    }
                };

                if (node.hasError) {
                    return {
                        ...baseStyle,
                        body: {
                            ...baseStyle.body,
                            fill: 'var(--vscode-inputValidation-errorBackground)',
                            stroke: 'var(--vscode-inputValidation-errorBorder)'
                        },
                        label: {
                            ...baseStyle.label,
                            fill: 'var(--vscode-errorForeground)'
                        }
                    };
                }

                // 根节点样式
                if (!node.depth || node.depth === 0) {
                    return {
                        ...baseStyle,
                        body: {
                            ...baseStyle.body,
                            fill: 'var(--vscode-button-background)',
                            stroke: 'var(--vscode-button-border)'
                        },
                        label: {
                            ...baseStyle.label,
                            fill: 'var(--vscode-button-foreground)',
                            fontSize: 14,
                            fontWeight: 600
                        }
                    };
                }

                // 第一层子节点
                if (node.depth === 1) {
                    return {
                        ...baseStyle,
                        body: {
                            ...baseStyle.body,
                            fill: 'var(--vscode-editor-background)',
                            stroke: 'var(--vscode-focusBorder)'
                        },
                        label: {
                            ...baseStyle.label,
                            fill: 'var(--vscode-editor-foreground)'
                        }
                    };
                }

                // 其他层级
                return {
                    ...baseStyle,
                    body: {
                        ...baseStyle.body,
                        fill: 'var(--vscode-editor-background)',
                        stroke: 'var(--vscode-input-border)'
                    },
                    label: {
                        ...baseStyle.label,
                        fill: 'var(--vscode-editor-foreground)'
                    }
                };
            }

            // 渲染思维导图
            function renderMindMap(data) {
                if (!graph || !data) {
                    return;
                }

                currentData = data;
                graph.clearCells();

                // 使用 hierarchy 计算布局
                const layoutData = calculateLayout(data);

                // 递归创建节点和边
                const nodes = [];
                const edges = [];

                function traverse(node, parent = null) {
                    const nodeStyle = getNodeStyle(node);
                    
                    const graphNode = graph.addNode({
                        x: node.x || 0,
                        y: node.y || 0,
                        width: 140,
                        height: 50,
                        label: node.title || node.id,
                        data: {
                            id: node.id,
                            filePath: node.filePath,
                            hasError: node.hasError,
                            errorMessage: node.errorMessage
                        },
                        attrs: nodeStyle,
                        tools: node.hasError ? [{
                            name: 'tooltip',
                            args: {
                                tooltip: node.errorMessage || '错误'
                            }
                        }] : []
                    });

                    nodes.push(graphNode);

                    if (parent) {
                        const edge = graph.addEdge({
                            source: parent,
                            target: graphNode,
                            attrs: {
                                line: {
                                    stroke: 'var(--vscode-panel-border)',
                                    strokeWidth: 2,
                                    targetMarker: null
                                }
                            },
                            connector: {
                                name: 'smooth'
                            },
                            router: {
                                name: 'er',
                                args: {
                                    offset: 25,
                                    direction: 'H'
                                }
                            }
                        });
                        edges.push(edge);
                    }

                    if (node.children && node.children.length > 0) {
                        node.children.forEach(child => traverse(child, graphNode));
                    }
                }

                traverse(layoutData);

                // 自动调整视图
                setTimeout(() => {
                    graph.zoomToFit({ padding: 40, maxScale: 1 });
                }, 100);
            }

            // 工具栏事件监听
            document.getElementById('fitViewBtn')?.addEventListener('click', () => {
                if (graph) {
                    graph.zoomToFit({ padding: 40, maxScale: 1 });
                }
            });

            document.getElementById('exportPNGBtn')?.addEventListener('click', () => {
                if (graph) {
                    graph.toPNG((dataUrl) => {
                        vscode.postMessage({
                            type: 'export',
                            dataUrl: dataUrl,
                            format: 'png'
                        });
                    }, {
                        backgroundColor: 'var(--vscode-editor-background)',
                        padding: 20
                    });
                }
            });

            document.getElementById('exportSVGBtn')?.addEventListener('click', () => {
                if (graph) {
                    graph.toSVG((dataUrl) => {
                        vscode.postMessage({
                            type: 'export',
                            dataUrl: dataUrl,
                            format: 'svg'
                        });
                    }, {
                        preserveDimensions: true
                    });
                }
            });

            // 监听来自扩展的消息
            window.addEventListener('message', event => {
                const message = event.data;
                switch (message.type) {
                    case 'updateData':
                        renderMindMap(message.data);
                        break;
                }
            });

            // 初始化
            initGraph();
        }
        
        // 使用轮询检测库是否加载完成
        let checkCount = 0;
        const maxChecks = 50; // 最多检查 5 秒
        
        function checkLibrariesLoaded() {
            checkCount++;
            console.log('[MindMap] Checking libraries...', checkCount, {
                X6: typeof X6 !== 'undefined',
                Hierarchy: typeof Hierarchy !== 'undefined'
            });
            
            if (typeof X6 !== 'undefined') {
                x6Loaded = true;
            }
            
            if (typeof Hierarchy !== 'undefined') {
                hierarchyLoaded = true;
            }
            
            if (x6Loaded && hierarchyLoaded) {
                console.log('[MindMap] Both libraries detected, initializing...');
                checkAndInit();
            } else if (checkCount < maxChecks) {
                setTimeout(checkLibrariesLoaded, 100);
            } else {
                console.error('[MindMap] Timeout waiting for libraries to load');
                document.getElementById('container').innerHTML = '<div class="loading">错误: 库加载超时。请检查网络连接。</div>';
            }
        }
        
        // 开始检测
        setTimeout(checkLibrariesLoaded, 100);
    </script>
    <script nonce="${nonce}" src="${x6ScriptUri}"></script>
    <script nonce="${nonce}" src="${hierarchyScriptUri}"></script>
</body>
</html>`;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
