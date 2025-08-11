import * as vscode from 'vscode';
import { IssueItem } from '../views/IsolatedIssuesProvider';
import path from 'path';

/**
 * 打开问题目录命令
 * 在 VS Code 中打开配置的问题目录
 */
export function registerDeleteIssueFile(context: vscode.ExtensionContext, isolatedView: vscode.TreeView<IssueItem>) {
    // 注册“删除问题”命令
    const deleteIssueCommand = vscode.commands.registerCommand('issueManager.deleteIssue', async (item: IssueItem) => {
        if (!item || !item.resourceUri) {
            vscode.window.showErrorMessage('无法删除问题：未找到有效的文件路径。');
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            `您确定要永久删除文件 “${path.basename(item.resourceUri.fsPath)}” 吗？此操作无法撤销。`,
            { modal: true }, // 模态对话框，阻止其他操作
            '确认删除'
        );

        if (confirm === '确认删除') {
            try {
                await vscode.workspace.fs.delete(item.resourceUri);
                vscode.window.showInformationMessage(`文件 “${path.basename(item.resourceUri.fsPath)}” 已被删除。`);
                // 视图会自动通过 FileSystemWatcher 刷新，无需手动调用 refresh
            } catch (error) {
                vscode.window.showErrorMessage(`删除文件时出错: ${String(error)}`);
            }
        }
    });

    context.subscriptions.push(deleteIssueCommand);

    // 注册"批量删除问题"命令
    const batchDeleteIssuesCommand = vscode.commands.registerCommand('issueManager.batchDeleteIssues', async () => {
        // 获取当前视图的选中项
        const selection = isolatedView.selection;
        
        if (!selection || selection.length === 0) {
            vscode.window.showWarningMessage('请先选择要删除的问题。');
            return;
        }

        // 验证所有选中项都是IssueItem且有有效的文件路径
        const validItems = selection.filter(  
            (item): item is IssueItem => item instanceof IssueItem && !!item.resourceUri  
        );  
        
        if (validItems.length === 0) {
            vscode.window.showErrorMessage('未找到有效的文件路径。');
            return;
        }

        // 显示确认对话框
        const fileNames = validItems.map(item => path.basename(item.resourceUri!.fsPath));
        const fileList = fileNames.length > 5 
            ? fileNames.slice(0, 5).join('\n') + `\n... 以及其他 ${fileNames.length - 5} 个文件`
            : fileNames.join('\n');

        const confirm = await vscode.window.showWarningMessage(
            `您确定要永久删除以下 ${validItems.length} 个文件吗？此操作无法撤销。\n\n${fileList}`,
            { modal: true },
            '确认删除'
        );

        if (confirm === '确认删除') {
            const results = await Promise.allSettled(  
                validItems.map(item => vscode.workspace.fs.delete(item.resourceUri!))  
            );  

            const failedFiles: string[] = [];  
            results.forEach((result, index) => {  
                if (result.status === 'rejected') {  
                    const item = validItems[index];  
                    const fileName = path.basename(item.resourceUri!.fsPath);  
                    failedFiles.push(fileName);  
                    console.error(`删除文件 ${fileName} 时出错:`, result.reason);  
                }  
            });  

            const successCount = validItems.length - failedFiles.length;  

            // 显示结果消息
            if (successCount === validItems.length) {
                vscode.window.showInformationMessage(`成功删除 ${successCount} 个文件。`);
            } else if (successCount > 0) {
                vscode.window.showWarningMessage(
                    `成功删除 ${successCount} 个文件，${failedFiles.length} 个文件删除失败：${failedFiles.join(', ')}`
                );
            } else {
                vscode.window.showErrorMessage(`删除失败：${failedFiles.join(', ')}`);
            }
        }
    });

    context.subscriptions.push(batchDeleteIssuesCommand);
};
