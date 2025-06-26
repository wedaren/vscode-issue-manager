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
   * 构建关注过滤树，包含 focusList 节点及其所有祖先和后代。
   */
  private buildFilteredTree(): TreeNode[] {
    if (!this.treeData || !this.focusedData || this.focusedData.focusList.length === 0) {
      return [];
    }

    const idToNode = new Map<string, TreeNode>();
    const parentMap = new Map<string, string>(); // childId -> parentId

    const buildMaps = (nodes: TreeNode[], parentId?: string) => {
      for (const node of nodes) {
        idToNode.set(node.id, node);
        if (parentId) {
          parentMap.set(node.id, parentId);
        }
        if (node.children) {
          buildMaps(node.children, node.id);
        }
      }
    };

    buildMaps(this.treeData.rootNodes);

    const nodesToShow = new Set<string>();

    // 1. 添加所有关注节点及其所有祖先和后代
    for (const focusId of this.focusedData.focusList) {
      // 添加自身
      if (idToNode.has(focusId)) {
        nodesToShow.add(focusId);

        // 添加所有后代
        const addDescendants = (nodeId: string) => {
          const node = idToNode.get(nodeId);
          if (node && node.children) {
            for (const child of node.children) {
              nodesToShow.add(child.id);
              addDescendants(child.id);
            }
          }
        };
        addDescendants(focusId);

        // 添加所有祖先
        let currentId = focusId;
        while (parentMap.has(currentId)) {
          const parentId = parentMap.get(currentId)!;
          nodesToShow.add(parentId);
          currentId = parentId;
        }
      }
    }

    // 2. 基于需要展示的节点，递归构建新树
    const buildNewTree = (nodes: TreeNode[]): TreeNode[] => {
      const result: TreeNode[] = [];
      for (const node of nodes) {
        if (nodesToShow.has(node.id)) {
          const newNode: TreeNode = { ...node };
          if (node.children) {
            newNode.children = buildNewTree(node.children);
          }
          result.push(newNode);
        }
      }
      return result;
    };

    return buildNewTree(this.treeData.rootNodes);
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
