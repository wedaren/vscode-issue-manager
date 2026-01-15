import * as vscode from 'vscode';
import { getIssueNodeById } from '../data/issueTreeManager';

/**
 * 快速查看 Issue 的命令
 * 保持当前编辑器不变（占据大部分空间），在旁边打开 Issue（占据小部分空间）
 * @param issueId Issue ID
 */
export async function quickPeekIssue(issueId: string): Promise<void> {
    try {
        // 1. 保存当前活动编辑器和当前编辑器组数量
        const currentEditor = vscode.window.activeTextEditor;
        const currentViewColumn = currentEditor?.viewColumn;
        
        // 获取当前所有可见编辑器组
        const tabGroups = vscode.window.tabGroups;
        const currentGroupCount = tabGroups.all.length;

        // 2. 获取 Issue 节点
        const node = await getIssueNodeById(issueId);
        if (!node || !node.resourceUri) {
            vscode.window.showErrorMessage(`未找到 Issue: ${issueId}`);
            return;
        }

        const issueUri = node.resourceUri.with({ query: `issueId=${encodeURIComponent(issueId)}` });
        await vscode.window.showTextDocument(issueUri, { preview: true, viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });

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
            if (args.length < 1) {
                vscode.window.showErrorMessage('QuickPeekIssue 命令需要一个 Issue ID 参数');
                return;
            }

            const issueId = typeof args[0] === 'string' ? args[0] : String(args[0]);

            await quickPeekIssue(issueId);
        })
    );
}
