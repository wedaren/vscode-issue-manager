import * as vscode from 'vscode';
import { getIssueNodeById } from '../data/issueTreeManager';

/**
 * 快速查看两个 Issue 的命令
 * 在左侧编辑器显示左侧 Issue，右侧显示右侧 Issue
 * @param leftIssueId 左侧 Issue ID
 * @param rightIssueId 右侧 Issue ID
 */
export async function quickPeekIssue(leftIssueId: string, rightIssueId: string): Promise<void> {
    try {
        // 1. 获取左侧 Issue 节点
        const leftNode = await getIssueNodeById(leftIssueId);
        if (!leftNode || !leftNode.resourceUri) {
            vscode.window.showErrorMessage(`未找到左侧 Issue: ${leftIssueId}`);
            return;
        }

        // 2. 获取右侧 Issue 节点
        const rightNode = await getIssueNodeById(rightIssueId);
        if (!rightNode || !rightNode.resourceUri) {
            vscode.window.showErrorMessage(`未找到右侧 Issue: ${rightIssueId}`);
            return;
        }

        // 3. 打开左右编辑器视图
        const leftIssueUri = leftNode.resourceUri.with({ query: `issueId=${encodeURIComponent(leftIssueId)}` });
        const rightIssueUri = rightNode.resourceUri.with({ query: `issueId=${encodeURIComponent(rightIssueId)}` });

        // 左侧：打开左侧 Issue 文档
        await vscode.window.showTextDocument(leftIssueUri, { preview: false, viewColumn: vscode.ViewColumn.One });

        // 右侧：打开右侧 Issue 文档
        await vscode.window.showTextDocument(rightIssueUri, { preview: false, viewColumn: vscode.ViewColumn.Two });

        // 4. 设置编辑器布局为左右两列
        try {
            await vscode.commands.executeCommand('vscode.setEditorLayout', {
                orientation: 0,
                groups: [
                    { size: 0.9 },
                    { size: 0.1 }
                ]
            });
        } catch (e) {
            console.error('设置编辑器布局失败', e);
        }

        // 5. 确保焦点在左侧编辑器
        try {
            await vscode.window.showTextDocument(leftIssueUri, { preview: false, viewColumn: vscode.ViewColumn.One });
        } catch (e) {
            console.error('设置焦点失败', e);
        }
    } catch (error) {
        console.error('快速查看 Issue 失败', error);
        vscode.window.showErrorMessage('快速查看 Issue 失败');
    }
}

/**
 * 注册 QuickPeekIssue 命令
 */
export function registerQuickPeekIssue(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.quickPeekIssue', async (...args: unknown[]) => {
            if (args.length < 2) {
                vscode.window.showErrorMessage('QuickPeekIssue 命令需要两个 Issue ID 参数');
                return;
            }

            const leftIssueId = typeof args[0] === 'string' ? args[0] : String(args[0]);
            const rightIssueId = typeof args[1] === 'string' ? args[1] : String(args[1]);

            await quickPeekIssue(leftIssueId, rightIssueId);
        })
    );
}
