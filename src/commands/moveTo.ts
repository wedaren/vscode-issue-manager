import * as vscode from 'vscode';
import { readTree, writeTree, IssueTreeNode, removeNode } from '../data/treeManager';
import { getTitle } from '../utils/markdown';

/**
 * “移动到...”命令实现：支持多选节点移动到指定父节点，防止循环引用。
 */
export async function moveToCommand(selectedNodes: IssueTreeNode[]) {
  if (!selectedNodes || selectedNodes.length === 0) {
    vscode.window.showWarningMessage('请先选择要移动的节点。');
    return;
  }
  const tree = await readTree();
  // 收集所有要排除的 id（自身及所有后代）
  const excludeIds = new Set<string>();
  function collectIds(node: IssueTreeNode) {
    excludeIds.add(node.id);
    if (node.children) {
      node.children.forEach(collectIds);
    }
  }
  selectedNodes.forEach(collectIds);
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
          result = result.concat(flatten(node.children, [...parentNodes, node]));
        }
      }
    }
    return result;
  }
  const flatNodes = flatten(tree.rootNodes);
  // 添加“根目录”选项
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
      description = [ '', ...(await Promise.all(node.parentPath.map(async n => {
        return await getTitle(n.resourceUri!);
      })))].join(' / ');
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
  // 只处理“顶层”选中节点，避免父子节点重复操作
  const selectedIds = new Set(selectedNodes.map(n => n.id));

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

  // 只保留顶层选中节点（其父节点未被选中）
  const topLevelSelectedNodes = selectedNodes.filter(node => {
    const parentId = parentMap.get(node.id);
    return !parentId || !selectedIds.has(parentId);
  });

  // 1. 只从原父节点中移除顶层节点
  topLevelSelectedNodes.forEach(node => removeNode(tree, node.id));

  // 2. 将顶层节点添加到目标位置
  if (!pick.node) {
    // 选择根目录，插入到 rootNodes
    tree.rootNodes.unshift(...topLevelSelectedNodes);
  } else {
    pick.node.children = pick.node.children || [];
    pick.node.children.unshift(...topLevelSelectedNodes);
  }
  await writeTree(tree);
  vscode.commands.executeCommand('issueManager.refreshAllViews');
  vscode.window.showInformationMessage('节点已成功移动。');
}
