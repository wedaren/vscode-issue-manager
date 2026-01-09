import * as vscode from 'vscode';
import { readTree, writeTree, IssueNode, stripFocusedId } from '../data/issueTreeManager';
import { convertTreeItemToTreeNode, isTreeItem, pickTargetWithQuickCreate, buildTopLevelNodes, insertNodesAtPick } from './moveHelpers';
import { v4 as uuidv4 } from 'uuid';

function cloneNodeWithNewIds(node: IssueNode): IssueNode {
    return {
        id: uuidv4(),
        filePath: node.filePath,
        resourceUri: node.resourceUri,
        children: node.children ? node.children.map(c => cloneNodeWithNewIds(c)) : []
    };
}

export async function attachIssuesTo(selectedNodes: (IssueNode | vscode.TreeItem)[]) {
    if (!selectedNodes || selectedNodes.length === 0) {
        vscode.window.showWarningMessage('请先选择要关联的节点。');
        return;
    }

    const tree = await readTree();
    const issueFileNodes: vscode.TreeItem[] = [];
    const treeNodes: IssueNode[] = [];

    selectedNodes.forEach(node => {
        if (isTreeItem(node)) {
            issueFileNodes.push(node);
        } else {
            treeNodes.push(node as IssueNode);
        }
    });

    let convertedNodes: IssueNode[];
    try {
        convertedNodes = issueFileNodes.map(item => convertTreeItemToTreeNode(item));
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`关联问题失败: ${message}`);
        return;
    }

    const allNodesToProcess = [...treeNodes, ...convertedNodes];
    allNodesToProcess.forEach(i => i.id = stripFocusedId(i.id));

    const pick = await pickTargetWithQuickCreate(tree.rootNodes, treeNodes);
    if (!pick) return;

    const topLevelTreeNodes = buildTopLevelNodes(tree.rootNodes, treeNodes);
    const clonedTopLevelNodes = topLevelTreeNodes.map(n => cloneNodeWithNewIds(n));

    const allTopLevelNodesToInsert = [...clonedTopLevelNodes, ...convertedNodes];
    insertNodesAtPick(tree, pick, allTopLevelNodesToInsert);

    await writeTree(tree);
    vscode.commands.executeCommand('issueManager.refreshAllViews');

    if (issueFileNodes.length > 0) {
        vscode.window.showInformationMessage(`已在目标处关联 ${issueFileNodes.length} 个问题文件和 ${treeNodes.length} 个问题节点。`);
    } else {
        vscode.window.showInformationMessage('节点已成功关联。');
    }
}
