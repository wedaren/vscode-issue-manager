import * as vscode from 'vscode';
import { TreeDataProvider, TreeItem, Event, EventEmitter } from 'vscode';
import { readTree, readFocused, TreeNode, TreeData, FocusedData, getAncestors, isFocusedRootId, stripFocusedRootId, toFocusedRootId } from '../data/treeManager';
import * as path from 'path';
import { getTitle } from '../utils/markdown';
import { getIssueDir } from '../config';

/**
 * 关注问题视图的 TreeDataProvider。
 * 仅实现基础框架，后续补充过滤树逻辑。
 */
export class FocusedIssuesProvider implements TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData: EventEmitter<TreeNode | undefined | void> = new EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData: Event<TreeNode | undefined | void> = this._onDidChangeTreeData.event;

  private treeData: TreeData | null = null;
  private focusedData: FocusedData | null = null;

  constructor() {
    // 可在此处注册文件监听等
  }

  /** 刷新视图 */
  async refresh() {
    await this.loadData();
  }

  /** 加载数据（tree.json 和 focused.json） */
  async loadData() {
    this.treeData = await readTree();
    this.focusedData = await readFocused();
    this._onDidChangeTreeData.fire();
  }

  async getTreeItem(element: TreeNode): Promise<vscode.TreeItem> {
    const issueDir = getIssueDir();
    if (!issueDir || !this.treeData) {
      throw new Error("Issue directory or tree data is not available.");
    }

    // Handle the placeholder case
    if (element.id === 'placeholder-no-focused') {
      return new vscode.TreeItem("暂无关注问题，请在“问题总览”视图中右键选择“添加到关注”", vscode.TreeItemCollapsibleState.None);
    }

    // 如果 id 带 __focusedRoot 后缀，取原 id
    const realId = stripFocusedRootId(element.id);
    const uri = vscode.Uri.file(path.join(issueDir, element.filePath));
    const title = await getTitle(uri);

    const item = new vscode.TreeItem(title,
      element.children && element.children.length > 0
        ? (element.expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
        : vscode.TreeItemCollapsibleState.None);

    item.id = element.id;
    item.resourceUri = uri;
    if(isFocusedRootId(element.id)){
      item.contextValue = 'focusedNode'; // 用于 package.json 的 when 子句
    } else {
      item.contextValue = 'issueNode';
    }
    item.command = {
      command: 'vscode.open',
      title: 'Open File',
      arguments: [uri],
    };

    // 生成并设置 tooltip
    const ancestors = getAncestors(realId, this.treeData);
    const ancestorTitles = await Promise.all(
      ancestors.map(ancestor => getTitle(vscode.Uri.file(path.join(issueDir, ancestor.filePath))))
    );
    if (ancestorTitles.length > 0) {
        item.tooltip = `/ ${ancestorTitles.join(' / ')}`;
    }

    return item;
  }

  /**
   * 构建关注过滤树：focusList 中每个节点都独立作为顶层，完整展示其子树。
   * 为避免 VS Code TreeView id 冲突，顶层节点 id 加特殊后缀。
   */
  private buildFilteredTree(): TreeNode[] {
    if (!this.treeData || !this.focusedData) { return []; }
    const idToNode = new Map<string, TreeNode>();
    // 建立 id 到节点的映射
    const collectMap = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        idToNode.set(node.id, node);
        if (node.children) { collectMap(node.children); }
      }
    };
    collectMap(this.treeData.rootNodes);

    // 每个 focusList 节点都独立收集其完整子树，顶层节点 id 加后缀
    const result: TreeNode[] = [];
    const collectDescendants = (node: TreeNode): TreeNode => {
      return {
        ...node,
        // 子节点保持原 id
        children: node.children ? node.children.map(collectDescendants) : []
      };
    };
    for (const id of new Set(this.focusedData.focusList)) {
      const node = idToNode.get(id);
      if (node) {
        // 顶层节点 id 加后缀，避免与树中其他位置重复
        const topNode: TreeNode = {
          ...collectDescendants(node),
          id: toFocusedRootId(id),
        };
        result.push(topNode);
      }
    }
    return result;
  }

  getChildren(element?: TreeNode): Thenable<TreeNode[]> {
    if (!this.treeData || !this.focusedData) { return Promise.resolve([]); }
    const filtered = this.buildFilteredTree();
    if (!element) {
      if (filtered.length === 0) {
        // Show a placeholder message when there are no nodes
        return Promise.resolve([{ id: 'placeholder-no-focused', filePath: '', children: [] }]);
      } else {
        return Promise.resolve(filtered);
      }
    }
    return Promise.resolve(element.children);
  }
}
