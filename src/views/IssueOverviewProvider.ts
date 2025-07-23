import * as vscode from 'vscode';
import * as path from 'path';
import { readTree, TreeData, IssueTreeNode } from '../data/treeManager';
import { getIssueDir } from '../config';
import { getTitle } from '../utils/markdown';
import { readFocused } from '../data/focusedManager';

export class IssueOverviewProvider implements vscode.TreeDataProvider<IssueTreeNode> {
  /**
   * 根据文件 URI 查找树节点
   * @param uri vscode.Uri
   */
  public findNodeByUri(uri: vscode.Uri): IssueTreeNode | undefined {
    if (!this.treeData || !uri) { return undefined; }
    const fsPath = uri.fsPath;
    // 递归查找
    const findNode = (node: IssueTreeNode): IssueTreeNode | undefined => {
      const issueDir = getIssueDir();
      if (!issueDir) { return undefined; }
      // 计算节点绝对路径
      const nodeAbsPath = path.join(issueDir, node.filePath);
      if (fsPath === nodeAbsPath) { return node; }
      if (node.children) {
        for (const child of node.children) {
          const found = findNode(child);
          if (found) { return found; }
        }
      }
      return undefined;
    };
    for (const root of this.treeData.rootNodes) {
      const found = findNode(root);
      if (found) { return found; }
    }
    return undefined;
  }
  /**  
   * 获取指定元素的父节点。  
   * 此方法是 TreeDataProvider 接口的一部分，用于支持 `reveal` 等操作。  
   * @param element 要查找其父节点的元素。  
   * @returns 父节点 `IssueTreeNode`，如果元素是根节点或未找到，则返回 `null`。  
   */  
  getParent(element: IssueTreeNode): IssueTreeNode | null {
    if (!this.treeData) { return null; }
    // 递归查找父节点
    const findParent = (node: IssueTreeNode, target: IssueTreeNode): IssueTreeNode | null => {
      if (node.children && node.children.some(child => child.id === target.id)) {
        return node;
      }
      if (node.children) {
        for (const child of node.children) {
          const parent = findParent(child, target);
          if (parent) { return parent; }
        }
      }
      return null;
    };
    for (const root of this.treeData.rootNodes) {
      const parent = findParent(root, element);
      if (parent) { return parent; }
    }
    return null;
  }
  private _onDidChangeTreeData: vscode.EventEmitter<IssueTreeNode | undefined | null | void> = new vscode.EventEmitter<IssueTreeNode | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<IssueTreeNode | undefined | null | void> = this._onDidChangeTreeData.event;

  private treeData: TreeData | null = null;

  constructor(private context: vscode.ExtensionContext) {
    this.loadData();
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('issueManager.issueDir')) {
        this.loadData();
      }
    });

    
  }

  private async loadData(): Promise<void> {
    const issueDir = getIssueDir();
    if (issueDir) {
      this.treeData = await readTree();
    } else {
      this.treeData = null;
    }
    this._onDidChangeTreeData.fire();
  }

  public refresh(): void {
    this.loadData();
  }

  async getTreeItem(element: IssueTreeNode): Promise<vscode.TreeItem> {
    const issueDir = getIssueDir();
    if (!issueDir) {
      throw new Error("Issue directory is not configured.");
    }

    // Handle the placeholder case
    if (element.id === 'placeholder-no-issues') {
      return new vscode.TreeItem("从“孤立问题”视图拖拽问题至此", vscode.TreeItemCollapsibleState.None);
    }

    const uri = vscode.Uri.file(path.join(issueDir, element.filePath));
    const title = await getTitle(uri);

    // 判断是否已关注
    const focusedData = await readFocused();
    const isFocused = focusedData.focusList.includes(element.id);

    const item = new vscode.TreeItem(title,
      element.children && element.children.length > 0
        ? (element.expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
        : vscode.TreeItemCollapsibleState.None);

    item.id = element.id;
    item.resourceUri = uri;
    if (isFocused) {
      item.contextValue = 'focusedNode'; // 根据关注状态设置 contextValue
      item.iconPath = new vscode.ThemeIcon('star');
    } else {
      item.contextValue = 'issueNode';
    }
    item.command = {
      command: 'vscode.open',
      title: 'Open File',
      arguments: [uri],
    };

    return item;
  }

  getChildren(element?: IssueTreeNode): vscode.ProviderResult<IssueTreeNode[]> {
    if (element) {
      return [...element.children];
    }

    if (this.treeData && this.treeData.rootNodes.length > 0) {
      return [...this.treeData.rootNodes];
    }

    // Show a placeholder message when there are no nodes
    return [{ id: 'placeholder-no-issues', filePath: '', children: [] }];
  }
}
