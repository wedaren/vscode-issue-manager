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

        // 3. 打开 Issue 视图
        const issueUri = node.resourceUri.with({ query: `issueId=${encodeURIComponent(issueId)}` });

        // 在当前编辑器旁边打开 Issue 文档，但保持焦点在当前编辑器（保留焦点避免闪烁）
        await vscode.window.showTextDocument(issueUri, { preview: false, viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });

        // 4. 动态设置编辑器布局：保持现有栏不变，新增的栏设置为最小
        // 延迟一小段时间确保编辑器已经打开，然后再调整布局
        setTimeout(async () => {
            try {
                const newGroupCount = vscode.window.tabGroups.all.length;
                const addedGroups = newGroupCount - currentGroupCount;
                
                if (addedGroups > 0) {
                    // 构建布局数组：现有组保持均分，新增的组设置为最小
                    const groups = [];
                    const existingGroupSize = 0.95 / currentGroupCount; // 现有组共占 95%
                    const newGroupSize = 0.05 / addedGroups; // 新增组共占 5%
                    
                    // 添加现有组
                    for (let i = 0; i < currentGroupCount; i++) {
                        groups.push({ size: existingGroupSize });
                    }
                    
                    // 添加新增组
                    for (let i = 0; i < addedGroups; i++) {
                        groups.push({ size: newGroupSize });
                    }
                    
                    await vscode.commands.executeCommand('vscode.setEditorLayout', {
                        orientation: 0,
                        groups: groups
                    });
                }
            } catch (e) {
                console.error('设置编辑器布局失败', e);
            }
        }, 50);
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
