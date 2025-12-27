import * as vscode from 'vscode';
import { readTree, writeTree, IssueTreeNode, removeNode, stripFocusedId } from '../data/issueTreeManager';
import * as path from 'path';
import { getIssueDir } from '../config';
import { v4 as uuidv4 } from 'uuid';
import { getIssueMarkdownTitle } from '../data/IssueMarkdowns';

/**
 * 判断节点是否为 vscode.TreeItem 类型
 */
function isTreeItem(node: unknown): node is vscode.TreeItem {
    return node !== null && typeof node === 'object' && 'resourceUri' in node && 'label' in node && !('id' in node);
}

/**
 * 将 vscode.TreeItem 转换为 IssueTreeNode
 */
function convertTreeItemToTreeNode(item: vscode.TreeItem): IssueTreeNode {
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

/**
 * "移动到..." 与 "添加到..." 命令实现：支持多选节点移动到指定父节点，防止循环引用。
 * 支持 IssueTreeNode 和 vscode.TreeItem 两种类型的输入。
 */
export async function moveIssuesTo(selectedNodes: (IssueTreeNode | vscode.TreeItem)[]) {
    if (!selectedNodes || selectedNodes.length === 0) {
        vscode.window.showWarningMessage('请先选择要移动的节点。');
        return;
    }

    const tree = await readTree();
    
    const issueFileNodes: vscode.TreeItem[] = [];
    const treeNodes: IssueTreeNode[] = [];
    
    selectedNodes.forEach(node => {
        if (isTreeItem(node)) {
            issueFileNodes.push(node);
        } else {
            treeNodes.push(node as IssueTreeNode);
        }
    });

    // 将问题转换为树节点并添加到处理列表
    let convertedNodes: IssueTreeNode[];
    try {
        convertedNodes = issueFileNodes.map(item => convertTreeItemToTreeNode(item));
    } catch (error: any) {
        vscode.window.showErrorMessage(`移动问题失败: ${error.message}`);
        return;
    }
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
        const title = await getIssueMarkdownTitle(node.filePath);
        // 层级路径展示优化：一级节点 description 留空，二级及以上显示父级路径
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

    // 只保留顶层选中节点（其父节点未被选中），对于问题文件节点，全部保留
    const topLevelTreeNodes = treeNodes.filter(node => {
        const parentId = parentMap.get(node.id);
        return !parentId || !selectedIds.has(parentId);
    });

    // 1. 只从原父节点中移除顶层树节点（问题文件节点本来就不在树中）
    topLevelTreeNodes.forEach(node => removeNode(tree, node.id));

    // 2. 将所有顶层节点和问题文件节点添加到目标位置
    const allTopLevelNodesToMove = [...topLevelTreeNodes, ...convertedNodes];
    if (!pick.node) {
        // 选择根目录，插入到 rootNodes
        tree.rootNodes.unshift(...allTopLevelNodesToMove);
    } else {
        pick.node.children = pick.node.children || [];
        pick.node.children.unshift(...allTopLevelNodesToMove);
    }
    
    await writeTree(tree);
    vscode.commands.executeCommand('issueManager.refreshAllViews');
    
    if (issueFileNodes.length > 0) {
        vscode.window.showInformationMessage(`已成功移动 ${issueFileNodes.length} 个问题文件和 ${treeNodes.length} 个问题节点。`);
    } else {
        vscode.window.showInformationMessage('节点已成功移动。');
    }
}
