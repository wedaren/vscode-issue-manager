import * as vscode from 'vscode';
import { readTree, writeTree, IssueTreeNode, TreeData } from '../data/treeManager';
import { getTitle } from '../utils/markdown';
import * as path from 'path';
import { getIssueDir } from '../config';

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
  const issueDir = getIssueDir();
  // 添加“根目录”选项
  const rootItem = {
    iconPath: new vscode.ThemeIcon('root-folder'),
    label: '根目录',
    description: '',
    node: null as any // 特殊标记
  };
  const items = [rootItem, ...await Promise.all(flatNodes.map(async node => {
    const uri = vscode.Uri.file(path.join(issueDir!, node.filePath));
    const title = await getTitle(uri);
    // 层级路径展示优化：一级节点 description 留空，二级及以上显示父级路径
    let description = '';
    if (node.parentPath.length > 0) {
      description = [ '', ...(await Promise.all(node.parentPath.map(async n => {
        const nUri = vscode.Uri.file(path.join(issueDir!, n.filePath));
        return await getTitle(nUri);
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
  // 1. 先从原父节点移除
  function removeFromParent(tree: TreeData, nodeId: string) {
    function recur(nodes: IssueTreeNode[]): boolean {
      for (let i = 0; i < nodes.length; i++) {
        const child = nodes[i];
        if (child.id === nodeId) {
          nodes.splice(i, 1);
          return true;
        }
        if (child.children && recur(child.children)) {
          return true;
        }
      }
      return false;
    }
    recur(tree.rootNodes);
  }
  selectedNodes.forEach(node => removeFromParent(tree, node.id));
  // 2. 添加到目标节点 children 或根目录
  if (!pick.node) {
    // 选择根目录，插入到 rootNodes
    tree.rootNodes.unshift(...selectedNodes);
  } else {
    pick.node.children = pick.node.children || [];
    pick.node.children.unshift(...selectedNodes);
  }
  await writeTree(tree);
  vscode.commands.executeCommand('issueManager.refreshAllViews');
  vscode.window.showInformationMessage('节点已成功移动。');
}
