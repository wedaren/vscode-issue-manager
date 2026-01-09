import * as vscode from 'vscode';
import { readTree, writeTree, IssueNode, removeNode, stripFocusedId } from '../data/issueTreeManager';
import { isTreeItem, convertTreeItemToTreeNode, pickTargetWithQuickCreate, buildTopLevelNodes, insertNodesAtPick } from './moveHelpers';

/**
 * "移动到..." 与 "添加到..." 命令实现：支持多选节点移动到指定父节点，防止循环引用。
 * 支持 IssueNode 和 vscode.TreeItem 两种类型的输入。
 */
export async function moveIssuesTo(selectedNodes: (IssueNode | vscode.TreeItem)[]) {
    if (!selectedNodes || selectedNodes.length === 0) {
        vscode.window.showWarningMessage('请先选择要移动的节点。');
        return;
    }

    const tree = await readTree();
    const issueFileNodes: vscode.TreeItem[] = [];
    const treeNodes: IssueNode[] = [];

    selectedNodes.forEach(node => {
        if (isTreeItem(node)) issueFileNodes.push(node);
        else treeNodes.push(node as IssueNode);
    });

    // 将问题文件转换为树节点
    let convertedNodes: IssueNode[];
    try {
        convertedNodes = issueFileNodes.map(item => convertTreeItemToTreeNode(item));
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`移动问题失败: ${message}`);
        return;
    }

    const allNodesToMove = [...treeNodes, ...convertedNodes];
    allNodesToMove.forEach(i => i.id = stripFocusedId(i.id));

    const pick = await pickTargetWithQuickCreate(treeNodes);
    if (!pick) return;

    // 执行移动：只移除原处的顶层选中节点，然后在目标处插入原节点/文件节点
    const topLevelTreeNodes = buildTopLevelNodes(tree.rootNodes, treeNodes);
    topLevelTreeNodes.forEach(node => removeNode(tree, node.id));

    const allTopLevelNodesToMove = [...topLevelTreeNodes, ...convertedNodes];
    insertNodesAtPick(tree, pick, allTopLevelNodesToMove);
    
    await writeTree(tree);
    vscode.commands.executeCommand('issueManager.refreshAllViews');
    
    if (issueFileNodes.length > 0) {
        vscode.window.showInformationMessage(`已成功移动 ${issueFileNodes.length} 个问题文件和 ${treeNodes.length} 个问题节点。`);
    } else {
        vscode.window.showInformationMessage('节点已成功移动。');
    }
}
