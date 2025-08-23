import * as vscode from 'vscode';
import { readTree, writeTree, IssueTreeNode, removeNode, stripFocusedId } from '../data/treeManager';
import { getTitle } from '../utils/markdown';
import { IssueItem } from '../views/IsolatedIssuesProvider';
import * as path from 'path';
import { getIssueDir } from '../config';
import { v4 as uuidv4 } from 'uuid';

/**
 * 判断节点是否为 IssueItem 类型
 */
function isIssueItem(node: any): node is IssueItem {
    return node && 'resourceUri' in node && 'label' in node && !('id' in node);
}

/**
 * 将 IssueItem 转换为 IssueTreeNode
 */
function convertIssueItemToTreeNode(item: IssueItem): IssueTreeNode {
    const issueDir = getIssueDir();
    if (!issueDir) {
        throw new Error('Issue directory is not configured');
    }
    const relativePath = path.relative(issueDir, item.resourceUri.fsPath);
    return {
        id: uuidv4(),
        filePath: relativePath,
        children: [],
        resourceUri: item.resourceUri
    };
}

/**
 * "移动到..."命令实现：支持多选节点移动到指定父节点，防止循环引用。
 * 支持 IssueTreeNode 和 IssueItem 两种类型的输入。
 */
export async function moveToCommand(selectedNodes: (IssueTreeNode | IssueItem)[]) {
    if (!selectedNodes || selectedNodes.length === 0) {
        vscode.window.showWarningMessage('请先选择要移动的节点。');
        return;
    }

    const tree = await readTree();
    
    // 分离孤立问题节点和树节点
    const isolatedItems: IssueItem[] = [];
    const treeNodes: IssueTreeNode[] = [];
    
    selectedNodes.forEach(node => {
        if (isIssueItem(node)) {
            isolatedItems.push(node);
        } else {
            treeNodes.push(node);
        }
    });

    // 将孤立问题转换为树节点并添加到处理列表
    const convertedNodes: IssueTreeNode[] = isolatedItems.map(item => convertIssueItemToTreeNode(item));
    const allNodesToMove = [...treeNodes, ...convertedNodes];

    // 支持关注问题视图节点移动
    allNodesToMove.forEach(i => i.id = stripFocusedId(i.id));

    // 收集所有要排除的 id（自身及所有后代），只对已在树中的节点进行排除
    const excludeIds = new Set<string>();
    function collectIds(node: IssueTreeNode) {
        excludeIds.add(node.id);
        if (node.children) {
            node.children.forEach(collectIds);
        }
    }
    treeNodes.forEach(collectIds); // 只对已在树中的节点进行排除

    // 优化：flatten 阶段直接生成带 parentPath 的节点
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
                if (hasChildren) {
                    result.push(...flatten(node.children, [...parentNodes, node]));
                }
            }
        }
        return result;
    }
    const flatNodes = flatten(tree.rootNodes);
    
    // 添加"根目录"选项
    const rootItem = {
        iconPath: new vscode.ThemeIcon('root-folder'),
        label: '根目录',
        description: '',
        node: null as FlatNode | null
    };
    const items = [rootItem, ...await Promise.all(flatNodes.map(async node => {
        const title = await getTitle(node.resourceUri!);
        // 层级路径展示优化：一级节点 description 留空，二级及以上显示父级路径
        let description = '';
        if (node.parentPath.length > 0) {
            description = ['', ...(await Promise.all(node.parentPath.map(n => getTitle(n.resourceUri!))))].join(' / ');
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
    
    if (!pick) {
        return;
    }

    // 执行移动
    // 只处理"顶层"选中节点，避免父子节点重复操作
    const selectedIds = new Set(treeNodes.map(n => n.id));

    // 构建每个节点的父节点映射
    const parentMap = new Map<string, string | null>();
    function buildParentMap(nodes: IssueTreeNode[], parentId: string | null) {
        for (const node of nodes) {
            parentMap.set(node.id, parentId);
            if (node.children) {
                buildParentMap(node.children, node.id);
            }
        }
    }
    buildParentMap(tree.rootNodes, null);

    // 只保留顶层选中节点（其父节点未被选中），对于孤立问题节点，全部保留
    const topLevelTreeNodes = treeNodes.filter(node => {
        const parentId = parentMap.get(node.id);
        return !parentId || !selectedIds.has(parentId);
    });

    // 1. 只从原父节点中移除顶层树节点（孤立问题节点本来就不在树中）
    topLevelTreeNodes.forEach(node => removeNode(tree, node.id));

    // 2. 将所有要移动的节点添加到目标位置
    if (!pick.node) {
        // 选择根目录，插入到 rootNodes
        tree.rootNodes.unshift(...allNodesToMove);
    } else {
        pick.node.children = pick.node.children || [];
        pick.node.children.unshift(...allNodesToMove);
    }
    
    await writeTree(tree);
    vscode.commands.executeCommand('issueManager.refreshAllViews');
    
    if (isolatedItems.length > 0) {
        vscode.window.showInformationMessage(`已成功移动 ${isolatedItems.length} 个孤立问题和 ${treeNodes.length} 个树节点。`);
    } else {
        vscode.window.showInformationMessage('节点已成功移动。');
    }
}
