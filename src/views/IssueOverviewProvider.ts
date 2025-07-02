import * as vscode from 'vscode';
import * as path from 'path';
import { readTree, TreeData, TreeNode } from '../data/treeManager';
import { getIssueDir } from '../config';
import { getTitle } from '../utils/markdown';
import { readFocused } from '../data/focusedManager';

export class IssueOverviewProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData: vscode.EventEmitter<TreeNode | undefined | null | void> = new vscode.EventEmitter<TreeNode | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined | null | void> = this._onDidChangeTreeData.event;

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

  async getTreeItem(element: TreeNode): Promise<vscode.TreeItem> {
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
    const focusedData = readFocused(issueDir);
    const isFocused = focusedData.focusList.includes(element.id);

    const item = new vscode.TreeItem(title,
      element.children && element.children.length > 0
        ? (element.expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
        : vscode.TreeItemCollapsibleState.None);

    item.id = element.id;
    item.resourceUri = uri;
    item.contextValue = isFocused ? 'focusedNode' : 'issueNode'; // 根据关注状态设置 contextValue
    item.command = {
      command: 'vscode.open',
      title: 'Open File',
      arguments: [uri],
    };

    return item;
  }

  getChildren(element?: TreeNode): vscode.ProviderResult<TreeNode[]> {
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
