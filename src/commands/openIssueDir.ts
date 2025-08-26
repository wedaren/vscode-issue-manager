import * as vscode from 'vscode';
import { getIssueDir } from '../config';

/**
 * 打开问题目录命令
 * 在 VS Code 中打开配置的问题目录
 */
export function registerOpenIssueDirCommand(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('issueManager.openIssueDir', async () => {
        const issueDir = getIssueDir();
        if (!issueDir) {
            vscode.window.showWarningMessage('问题目录未配置，请先在设置中配置 issueManager.issueDir');
            return;
        }

        try {
            // 使用 vscode.Uri.file 创建文件 URI
            const issueDirUri = vscode.Uri.file(issueDir);
            // 在 VS Code 中打开文件夹
            await vscode.commands.executeCommand('vscode.openFolder', issueDirUri, { forceNewWindow: true });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`打开问题目录失败: ${message}`);
        }
    });
    context.subscriptions.push(disposable);
};
