import * as vscode from 'vscode';
import * as path from 'path';

export function registerDeleteIsolatedIssueCommand(context: vscode.ExtensionContext) {
    const command = vscode.commands.registerCommand('issueManager.deleteIssue', async (item: vscode.TreeItem) => {
        if (!item || !item.resourceUri) {
            vscode.window.showErrorMessage('无法删除问题：未找到有效的文件路径。');
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            `您确定要永久删除文件 “${path.basename(item.resourceUri.fsPath)}” 吗？此操作无法撤销。`,
            { modal: true },
            '确认删除'
        );

        if (confirm === '确认删除') {
            try {
                await vscode.workspace.fs.delete(item.resourceUri);
                vscode.window.showInformationMessage(`文件 “${path.basename(item.resourceUri.fsPath)}” 已被删除。`);
                // The view will refresh automatically via the FileSystemWatcher.
            } catch (error) {
                vscode.window.showErrorMessage(`删除文件时出错: ${String(error)}`);
            }
        }
    });

    context.subscriptions.push(command);
}
