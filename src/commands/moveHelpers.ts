import * as vscode from 'vscode';
import * as path from 'path';
import { getIssueDir } from '../config';
import { v4 as uuidv4 } from 'uuid';
import { getIssueMarkdownTitle } from '../data/IssueMarkdowns';
import { IssueTreeNode } from '../data/issueTreeManager';

export function isTreeItem(node: unknown): node is vscode.TreeItem {
    return node !== null && typeof node === 'object' && 'resourceUri' in node && 'label' in node && !('id' in node);
}

export function convertTreeItemToTreeNode(item: vscode.TreeItem): IssueTreeNode {
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

// 将指定的 treeNodes 收集为 excludeIds，然后展示可选目标的 QuickPick
export async function showTargetPicker(treeRootNodes: IssueTreeNode[], treeNodesToExclude: IssueTreeNode[]) {
    const excludeIds = new Set<string>();
    function collectIds(node: IssueTreeNode) {
        excludeIds.add(node.id);
        if (node.children) node.children.forEach(collectIds);
    }
    treeNodesToExclude.forEach(collectIds);

    interface FlatNode extends IssueTreeNode {
        parentPath: IssueTreeNode[];
        hasChildren: boolean;
    }

    function flatten(nodes: IssueTreeNode[], parentNodes: IssueTreeNode[] = []): FlatNode[] {
        let result: FlatNode[] = [];
        for (const node of nodes) {
            if (!excludeIds.has(node.id)) {
                const hasChildren = !!(node.children && node.children.length > 0);
                result.push({ ...node, parentPath: [...parentNodes], hasChildren });
                if (hasChildren) result.push(...flatten(node.children, [...parentNodes, node]));
            }
        }
        return result;
    }

    const flatNodes = flatten(treeRootNodes);

    const rootItem = {
        iconPath: new vscode.ThemeIcon('root-folder'),
        label: '根目录',
        description: '',
        node: null as FlatNode | null
    };

    const items = [rootItem, ...await Promise.all(flatNodes.map(async node => {
        const title = await getIssueMarkdownTitle(node.filePath);
        let description = '';
        if (node.parentPath.length > 0) {
            const parentTitles = await Promise.all(node.parentPath.map(n => getIssueMarkdownTitle(n.filePath)));
            description = ['', ...parentTitles].join(' / ');
        }
        return {
            iconPath: node.hasChildren ? new vscode.ThemeIcon('find-collapsed') : new vscode.ThemeIcon('markdown'),
            label: title,
            description,
            node
        };
    }))];

    const pick = await vscode.window.showQuickPick(items, {
        placeHolder: '搜索并选择目标父节点...',
        matchOnDescription: true
    });

    return pick;
}

// 构建父映射并返回顶层选中节点（父节点未被选中的那些）
export function buildTopLevelNodes(treeRootNodes: IssueTreeNode[], selectedTreeNodes: IssueTreeNode[]) {
    const selectedIds = new Set(selectedTreeNodes.map(n => n.id));
    const parentMap = new Map<string, string | null>();
    function buildParentMap(nodes: IssueTreeNode[], parentId: string | null) {
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

export function insertNodesAtPick(tree: { rootNodes: IssueTreeNode[] }, pick: any, nodesToInsert: IssueTreeNode[]) {
    if (!pick || !pick.node) {
        tree.rootNodes.unshift(...nodesToInsert);
    } else {
        pick.node.children = pick.node.children || [];
        pick.node.children.unshift(...nodesToInsert);
    }
}
