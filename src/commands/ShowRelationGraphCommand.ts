import * as vscode from 'vscode';
import { WebviewManager } from '../webview/WebviewManager';
import { G6GraphData } from '../webview/types';
import { GraphDataService } from '../services/GraphDataService';

/**
 * 显示问题关系图命令
 */
export class ShowRelationGraphCommand {
    constructor(
        private context: vscode.ExtensionContext,
        private webviewManager: WebviewManager,
        private graphDataService: GraphDataService
    ) { }

    /**
     * 执行命令
     */
    public async execute(uri?: vscode.Uri): Promise<void> {
        try {
            console.log('[ShowRelationGraph] 命令开始执行');
            // 获取当前文件路径
            const filePath = uri?.fsPath || vscode.window.activeTextEditor?.document.uri.fsPath;
            console.log('[ShowRelationGraph] 文件路径:', filePath);

            if (!filePath) {
                vscode.window.showWarningMessage('请先打开一个问题文件');
                return;
            }

            // 检查是否是 Markdown 文件
            if (!filePath.endsWith('.md')) {
                vscode.window.showWarningMessage('只能为 Markdown 文件显示关系图');
                return;
            }

            // 创建 Webview Panel
            const panel = this.webviewManager.createG6GraphPanel('问题关系图');

            // 监听 Webview 消息
            this.webviewManager.onMessage(panel, (message) => {
                console.log('[ShowRelationGraph] 收到消息:', message.type);
                switch (message.type) {
                    case 'READY':
                        // Webview 就绪后发送数据
                        console.log('[ShowRelationGraph] Webview 已就绪');
                        this.sendGraphData(panel, filePath);
                        break;
                    case 'NODE_CLICKED':
                        // 处理节点点击
                        this.handleNodeClick(message.payload.filePath);
                        break;
                    case 'ERROR':
                        vscode.window.showErrorMessage(`关系图错误: ${message.payload.message}`);
                        break;
                }
            });

            // 监听主题变化
            vscode.window.onDidChangeActiveColorTheme(() => {
                const theme = this.webviewManager.getCurrentTheme();
                this.webviewManager.postMessage(panel, {
                    type: 'THEME_CHANGED',
                    payload: {
                        mode: theme,
                        backgroundColor: '',
                        nodeColor: '',
                        edgeColor: '',
                        textColor: ''
                    }
                });
            });

        } catch (error) {
            vscode.window.showErrorMessage(`显示关系图失败: ${error}`);
        }
    }

    /**
     * 发送图数据到 Webview
     */
    private async sendGraphData(panel: vscode.WebviewPanel, filePath: string): Promise<void> {
        try {
            console.log('[ShowRelationGraph] 开始获取图数据');
            // 从 GraphDataService 获取图数据
            const graphData: G6GraphData = await this.graphDataService.getGraphData(filePath);
            console.log('[ShowRelationGraph] 节点数:', graphData.nodes.length, '边数:', graphData.edges.length);

            // 发送数据到 Webview
            this.webviewManager.postMessage(panel, {
                type: 'INIT_GRAPH',
                payload: graphData
            });

        } catch (error) {
            vscode.window.showErrorMessage(`加载关系图数据失败: ${error}`);
        }
    }

    /**
     * 处理节点点击事件
     */
    private async handleNodeClick(filePath: string): Promise<void> {
        try {
            const uri = vscode.Uri.file(filePath);
            const document = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(document);
        } catch (error) {
            vscode.window.showErrorMessage(`打开文件失败: ${error}`);
        }
    }
}
