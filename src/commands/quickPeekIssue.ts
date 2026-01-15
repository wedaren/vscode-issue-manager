import * as vscode from 'vscode';
import { getIssueNodeById } from '../data/issueTreeManager';

/**
 * 快速查看两个 Issue 的命令
 * 保持当前编辑器不变（占据大部分空间），在旁边打开两个 Issue（占据小部分空间）
 * @param leftIssueId 左侧 Issue ID
 * @param rightIssueId 右侧 Issue ID
 */
export async function quickPeekIssue(leftIssueId: string, rightIssueId: string): Promise<void> {
    try {
        // 1. 保存当前活动编辑器
        const currentEditor = vscode.window.activeTextEditor;

        // 2. 获取左侧 Issue 节点
        const leftNode = await getIssueNodeById(leftIssueId);
        if (!leftNode || !leftNode.resourceUri) {
            vscode.window.showErrorMessage(`未找到左侧 Issue: ${leftIssueId}`);
            return;
        }

        // 3. 获取右侧 Issue 节点
        const rightNode = await getIssueNodeById(rightIssueId);
        if (!rightNode || !rightNode.resourceUri) {
            vscode.window.showErrorMessage(`未找到右侧 Issue: ${rightIssueId}`);
            return;
        }

        // 4. 打开左右 Issue 视图
        const leftIssueUri = leftNode.resourceUri.with({ query: `issueId=${encodeURIComponent(leftIssueId)}` });
        const rightIssueUri = rightNode.resourceUri.with({ query: `issueId=${encodeURIComponent(rightIssueId)}` });

        // 在旁边打开左侧 Issue 文档
        await vscode.window.showTextDocument(leftIssueUri, { preview: false, viewColumn: vscode.ViewColumn.Two });

        // 在旁边打开右侧 Issue 文档
        await vscode.window.showTextDocument(rightIssueUri, { preview: false, viewColumn: vscode.ViewColumn.Three });

        // 5. 设置编辑器布局：当前编辑器占 90%，两个 Issue 各占 5%
        try {
            await vscode.commands.executeCommand('vscode.setEditorLayout', {
                orientation: 0,
                groups: [
                    { size: 0.9 },
                    { size: 0.05 },
                    { size: 0.05 }
                ]
            });
        } catch (e) {
            console.error('设置编辑器布局失败', e);
        }

        // 6. 恢复焦点到原来的编辑器
        if (currentEditor) {
            try {
                await vscode.window.showTextDocument(currentEditor.document, { 
                    preview: false, 
                    viewColumn: currentEditor.viewColumn,
                    preserveFocus: false
                });
            } catch (e) {
                console.error('恢复焦点失败', e);
            }
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
