import * as vscode from 'vscode';
import * as path from 'path';

export function registerDeleteIssueCommand(context: vscode.ExtensionContext) {
    const command = vscode.commands.registerCommand('issueManager.deleteIssue', async (item: vscode.TreeItem, selectedItems?: vscode.TreeItem[]) => {
        const itemsToDelete = selectedItems?.length ? selectedItems : (item ? [item] : []);
        if (itemsToDelete.length === 0) {
            vscode.window.showErrorMessage('没有选中要删除的文件。');
            return;
        }

        const fileNames = itemsToDelete.map(i => i.resourceUri ? path.basename(i.resourceUri.fsPath) : '未知文件').join('\n');
        const confirm = await vscode.window.showWarningMessage(
            `您确定要永久删除 ${itemsToDelete.length} 个文件吗？\n${fileNames}\n此操作无法撤销。`,
            { modal: true },
            '确认删除'
        );

        if (confirm === '确认删除') {
            let failedFiles: string[] = [];
            for (const i of itemsToDelete) {
                if (i.resourceUri) {
                    try {
                        await vscode.workspace.fs.delete(i.resourceUri);
                    } catch (error) {
                        const failedFile = path.basename(i.resourceUri.fsPath);
                        failedFiles.push(failedFile);
                        console.error(`删除文件 ${failedFile} 时出错:`, error);
                    }
                }
            }

            const successCount = itemsToDelete.length - failedFiles.length;
            if (failedFiles.length > 0) {
                vscode.window.showWarningMessage(`成功删除 ${successCount} 个文件，${failedFiles.length} 个文件删除失败: ${failedFiles.join(', ')}`);
            } else {
                vscode.window.showInformationMessage(`成功删除 ${successCount} 个文件。`);
            }
            // The view will refresh automatically via the FileSystemWatcher.
        }
    });

    context.subscriptions.push(command);
}
