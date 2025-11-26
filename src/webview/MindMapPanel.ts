import * as vscode from 'vscode';
import * as path from 'path';
import { IssueStructureNode } from '../views/IssueStructureProvider';
import { getIssueDir } from '../config';
import {
    MindMapFromWebviewMessage,
    MindMapNode,
    MindMapToWebviewMessage,
} from './webviewTypes';
import { getReactWebviewHtml } from './ReactWebviewHost';

/**
 * 思维导图面板管理器（React Webview 版）
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
                    vscode.Uri.joinPath(extensionUri, 'dist'),
                ],
            },
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
            children: node.children?.map(child => this.convertFromStructureNode(child)),
        };
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, data?: MindMapNode) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        // 设置初始 HTML 内容（React Webview）
        this._panel.webview.html = getReactWebviewHtml({
            webview: this._panel.webview,
            extensionUri: this._extensionUri,
            bundlePath: 'dist/webview/mindmapWebview.js',
            title: '思维导图',
            initialState: data
                ? {
                    mindMapData: data,
                }
                : undefined,
        });

        // 监听面板关闭事件
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // 处理来自 webview 的消息
        this._panel.webview.onDidReceiveMessage(
            async (message: MindMapFromWebviewMessage) => {
                switch (message.type) {
                    case 'ready':
                        // Webview 准备就绪，如果构造时没有初始数据，这里可以再发送一次
                        if (data) {
                            this.updateData(data);
                        }
                        break;
                    case 'openFile':
                        // 打开文件
                        await this.openFile(message.filePath);
                        break;
                    case 'export':
                        // 导出（React 版当前未实现图形导出，这里保留协议）
                        await this.exportImage(message.dataUrl, message.format);
                        break;
                    case 'error':
                        vscode.window.showErrorMessage(message.message);
                        break;
                }
            },
            null,
            this._disposables,
        );
    }

    /**
     * 更新思维导图数据
     */
    public updateData(data: MindMapNode) {
        const message: MindMapToWebviewMessage = {
            type: 'updateData',
            data,
        };
        this._panel.webview.postMessage(message);
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
     * React 版暂时直接写文件（需要 Webview 侧提供 dataUrl）
     */
    private async exportImage(dataUrl: string, format: 'png' | 'svg'): Promise<void> {
        try {
            const defaultUri = vscode.Uri.file(
                path.join(
                    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
                    `mindmap.${format}`,
                ),
            );

            const uri = await vscode.window.showSaveDialog({
                defaultUri,
                filters: {
                    Images: [format],
                },
            });

            if (uri) {
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
}

 
