import * as vscode from 'vscode';
import * as path from 'path';
import { getIssueDir } from '../config';
import { v4 as uuidv4 } from 'uuid';
import { IssueNode, stripFocusedId, readTree, getIssueNodeById } from '../data/issueTreeManager';
import { selectOrCreateIssue } from './selectOrCreateIssue';

export function isTreeItem(node: unknown): node is vscode.TreeItem {
    return node !== null && typeof node === 'object' && 'resourceUri' in node && 'label' in node && !('id' in node);
}

export function convertTreeItemToTreeNode(item: vscode.TreeItem): IssueNode {
    const issueDir = getIssueDir();
    if (!issueDir) {
        throw new Error('问题目录未配置，无法转换孤立问题节点');
    }
    if (!item.resourceUri) {
        throw new Error('问题节点缺少 resourceUri，无法转换');
    }
    const relativePath = path.relative(issueDir, item.resourceUri.fsPath);
    return {
        id: uuidv4(),
        filePath: relativePath,
        children: [],
        resourceUri: item.resourceUri
    };
}


// 使用 selectOrCreateIssue 作为选择或新建目标的复用入口。
export async function pickTargetWithQuickCreate(treeNodesToExclude: IssueNode[]) {
    // 构建被排除的 stripped id 集合，防止选择自身或子节点
    const excludeStripped = new Set<string>();
    function collect(node: IssueNode) {
        excludeStripped.add(stripFocusedId(node.id));
        if (node.children) node.children.forEach(collect);
    }
    treeNodesToExclude.forEach(collect);

    const targetId = await selectOrCreateIssue();
    if (!targetId) return undefined;

    if (excludeStripped.has(targetId)) {
        vscode.window.showWarningMessage('不能将节点移到自身或其子节点，请选择其他目标。');
        return undefined;
    }

    const found = await getIssueNodeById(targetId);
    return { node: found };
}

// 构建父映射并返回顶层选中节点（父节点未被选中的那些）
export function buildTopLevelNodes(treeRootNodes: IssueNode[], selectedTreeNodes: IssueNode[]) {
    const selectedIds = new Set(selectedTreeNodes.map(n => n.id));
    const parentMap = new Map<string, string | null>();
    function buildParentMap(nodes: IssueNode[], parentId: string | null) {
        for (const node of nodes) {
            parentMap.set(node.id, parentId);
            if (node.children) buildParentMap(node.children, node.id);
        }
    }
    buildParentMap(treeRootNodes, null);

    const topLevel = selectedTreeNodes.filter(node => {
        const parentId = parentMap.get(node.id);
        return !parentId || !selectedIds.has(parentId);
    });
    return topLevel;
}

export function insertNodesAtPick(tree: { rootNodes: IssueNode[] }, pick: { node?: IssueNode } | undefined, nodesToInsert: IssueNode[]) {
    if (!pick || !pick.node) {
        tree.rootNodes.unshift(...nodesToInsert);
    } else {
        pick.node.children = pick.node.children || [];
        pick.node.children.unshift(...nodesToInsert);
    }
}
