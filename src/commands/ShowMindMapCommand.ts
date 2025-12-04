import * as vscode from 'vscode';
import { WebviewManager } from '../webview/WebviewManager';
import { GraphDataService } from '../services/GraphDataService';

/**
 * 显示思维导图命令
 */
export class ShowMindMapCommand {
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
            // 获取当前文件路径
            const filePath = uri?.fsPath || vscode.window.activeTextEditor?.document.uri.fsPath;

            if (!filePath) {
                vscode.window.showWarningMessage('请先打开一个 Markdown 文件');
                return;
            }

            if (!filePath.endsWith('.md')) {
                vscode.window.showWarningMessage('只能为 Markdown 文件生成思维导图');
                return;
            }

            // 创建 Webview Panel
            const panel = this.webviewManager.createMindMapPanel('思维导图');

            // 监听消息
            this.webviewManager.onMessage(panel, async (message) => {
                switch (message.type) {
                    case 'READY':
                        await this.sendMindMapData(panel, filePath);
                        break;
                    case 'NODE_CLICKED':
                        // TODO: 实现跳转到对应标题
                        vscode.window.showInformationMessage(`点击了节点: ${message.payload.nodeId}`);
                        break;
                    case 'ERROR':
                        vscode.window.showErrorMessage(`思维导图错误: ${message.payload.message}`);
                        break;
                }
            });

        } catch (error) {
            vscode.window.showErrorMessage(`显示思维导图失败: ${error}`);
        }
    }

    /**
     * 发送思维导图数据
     */
    private async sendMindMapData(panel: vscode.WebviewPanel, filePath: string): Promise<void> {
        try {
            const data = await this.graphDataService.getMindMapData(filePath);
            this.webviewManager.postMessage(panel, {
                type: 'INIT_MINDMAP',
                payload: data
            });
        } catch (error) {
            vscode.window.showErrorMessage(`加载思维导图数据失败: ${error}`);
        }
    }
}
