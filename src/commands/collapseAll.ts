import * as vscode from 'vscode';
import { readTree, writeTree, IssueTreeNode } from '../data/treeManager';

/**
 * 折叠所有视图命令
 * 折叠所有树状视图的节点
 */
export function registerCollapseAllCommand(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('issueManager.views.collapseAll', async () => {
        // 折叠所有树状视图的节点
        await collapseAllNodes();
        
        vscode.window.showInformationMessage('已折叠当前活动视图的所有节点');
    });
    
    context.subscriptions.push(disposable);
}

/**
 * 折叠所有树状视图的节点
 */
async function collapseAllNodes(): Promise<void> {
    try {
        const treeData = await readTree();
        if (!treeData) {
            return;
        }

        // 递归折叠所有节点
        const collapseNodeRecursively = (node: IssueTreeNode): void => {
            node.expanded = false;
            if (node.children && node.children.length > 0) {
                node.children.forEach(collapseNodeRecursively);
            }
        };

        // 折叠所有根节点及其子节点
        treeData.rootNodes.forEach(collapseNodeRecursively);

        // 保存更新后的树数据
        await writeTree(treeData);

        // 刷新所有视图以反映变更
        vscode.commands.executeCommand('issueManager.refreshAllViews');
    } catch (error) {
        console.error('折叠节点时出现错误:', error);
        vscode.window.showErrorMessage('折叠视图时出现错误');
    }
}
