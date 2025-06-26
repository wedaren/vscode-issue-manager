import * as vscode from 'vscode';
import { TreeDataProvider, TreeItem, Event, EventEmitter } from 'vscode';
import { readTree, readFocused, TreeNode, TreeData, FocusedData, validateFocusList } from '../data/treeManager';
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
  refresh(): void {
    this.loadData();
  }

  /** 加载数据（tree.json 和 focused.json） */
  async loadData() {
    this.treeData = await readTree();
    this.focusedData = await readFocused();
    // 后续可在此处做过滤树构建
    this._onDidChangeTreeData.fire();
  }

  async getTreeItem(element: TreeNode): Promise<vscode.TreeItem> {
    const issueDir = getIssueDir();
    if (!issueDir) {
      throw new Error("Issue directory is not configured.");
    }

    // Handle the placeholder case
    if (element.id === 'placeholder-no-focused') {
      return new vscode.TreeItem("暂无关注问题，请在“问题总览”视图中右键选择“添加到关注”", vscode.TreeItemCollapsibleState.None);
    }

    const uri = vscode.Uri.file(path.join(issueDir, element.filePath));
    const title = await getTitle(uri);

    const item = new vscode.TreeItem(title,
      element.children && element.children.length > 0
        ? (element.expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
        : vscode.TreeItemCollapsibleState.None);

    item.id = element.id;
    item.resourceUri = uri;
    item.contextValue = 'issueNode'; // Use this for when clauses in package.json
    item.command = {
      command: 'vscode.open',
      title: 'Open File',
      arguments: [uri],
    };

    return item;
  }

  /**
   * 构建关注过滤树，仅包含 focusList 节点及其所有后代（不包含祖先）。
   */
  private buildFilteredTree(): TreeNode[] {
    if (!this.treeData || !this.focusedData) { return []; }
    const focusSet = new Set(this.focusedData.focusList);
    const idToNode = new Map<string, TreeNode>();
    // 建立 id 到节点的映射
    const collectMap = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        idToNode.set(node.id, node);
        if (node.children) { collectMap(node.children); }
      }
    };
    collectMap(this.treeData.rootNodes);

    // 只收集所有关注节点及其后代
    const result: TreeNode[] = [];
    const collectDescendants = (node: TreeNode): TreeNode => {
      return {
        ...node,
        children: node.children.map(collectDescendants)
      };
    };
    for (const id of focusSet) {
      const node = idToNode.get(id);
      if (node) {
        result.push(collectDescendants(node));
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
