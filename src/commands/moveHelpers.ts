import * as vscode from 'vscode';
import * as path from 'path';
import { getIssueDir } from '../config';
import { v4 as uuidv4 } from 'uuid';
import { getIssueMarkdownTitle } from '../data/IssueMarkdowns';
import { IssueNode, stripFocusedId, readTree } from '../data/issueTreeManager';
import { quickCreateIssue } from './quickCreateIssue';

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

// 将指定的 treeNodes 收集为 excludeIds，然后展示可选目标的 QuickPick
export async function showTargetPicker(treeRootNodes: IssueNode[], treeNodesToExclude: IssueNode[]) {
    const excludeIds = new Set<string>();
    function collectIds(node: IssueNode) {
        excludeIds.add(node.id);
        if (node.children) node.children.forEach(collectIds);
    }
    treeNodesToExclude.forEach(collectIds);

    interface FlatNode extends IssueNode {
        parentPath: IssueNode[];
        hasChildren: boolean;
    }

    function flatten(nodes: IssueNode[], parentNodes: IssueNode[] = []): FlatNode[] {
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

// 使用 quickCreateIssue 作为选择或新建目标的复用入口。
// 返回与 showTargetPicker 相同形状的对象 `{ node: IssueNode | null }` 或 `undefined`（用户取消）
export async function pickTargetWithQuickCreate(treeNodesToExclude: IssueNode[]) {
    // 构建被排除的 stripped id 集合，防止选择自身或子节点
    const excludeStripped = new Set<string>();
    function collect(node: IssueNode) {
        excludeStripped.add(stripFocusedId(node.id));
        if (node.children) node.children.forEach(collect);
    }
    treeNodesToExclude.forEach(collect);

    const targetId = await quickCreateIssue();
    if (!targetId) return undefined;

    if (excludeStripped.has(targetId)) {
        vscode.window.showWarningMessage('不能将节点移到自身或其子节点，请选择其他目标。');
        return undefined;
    }

    // 重新读取树以捕获 quickCreateIssue 可能新增的节点
    const tree = await readTree();
    function find(nodes: IssueNode[]): IssueNode | null {
        for (const n of nodes) {
            if (stripFocusedId(n.id) === targetId) return n;
            if (n.children) {
                const f = find(n.children);
                if (f) return f;
            }
        }
        return null;
    }

    const found = find(tree.rootNodes);
    return { node: found } as { node: IssueNode | null };
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

export function insertNodesAtPick(tree: { rootNodes: IssueNode[] }, pick: { node: IssueNode | null } | undefined, nodesToInsert: IssueNode[]) {
    if (!pick || !pick.node) {
        tree.rootNodes.unshift(...nodesToInsert);
    } else {
        pick.node.children = pick.node.children || [];
        pick.node.children.unshift(...nodesToInsert);
    }
}
