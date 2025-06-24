import * as vscode from 'vscode';
import * as path from 'path';
import { getIssueDir } from '../config';
import { readTree, writeTree, TreeData, TreeNode, removeNode } from '../data/treeManager';
import { getTitle } from '../utils/markdown';
import { debug } from 'console';

export class IssueOverviewProvider implements vscode.TreeDataProvider<TreeNode> {

  private _onDidChangeTreeData: vscode.EventEmitter<TreeNode | undefined | null | void> = new vscode.EventEmitter<TreeNode | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined | null | void> = this._onDidChangeTreeData.event;

  private treeData: TreeData | null = null;

  constructor() {
    this.refresh();
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('issueManager.issueDir')) {
        this.refresh();
      }
    });
  }

  private async loadTreeData(): Promise<void> {
    const issueDir = getIssueDir();
    if (issueDir) {
      this.treeData = await readTree();
    } else {
      this.treeData = null;
    }
  }

  refresh(): void {
    this.loadTreeData().then(() => {
      this._onDidChangeTreeData.fire(null);
    });
  }

  async getTreeItem(element: TreeNode): Promise<vscode.TreeItem> {
    if (element.id === 'placeholder-no-issues') {
      return new vscode.TreeItem("可以从“孤立问题”拖拽到此处", vscode.TreeItemCollapsibleState.None);
    }
    const issueDir = getIssueDir();
    if (!issueDir) {
        // This should not happen if the view is displayed
        throw new Error("Issue directory is not configured.");
    }
    const uri = vscode.Uri.file(path.join(issueDir, element.filePath));
    const title = await getTitle(uri);

    const item = new vscode.TreeItem(title, element.children.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
    item.id = element.id;
    item.command = {
        command: 'vscode.open',
        title: 'Open File',
        arguments: [uri],
    };
    item.contextValue = 'issueNode'; // for context menu
    item.resourceUri = uri;

    return item;
  }

  getChildren(element?: TreeNode): vscode.ProviderResult<TreeNode[]> {
    console.debug('getChildren called', element);
    console.debug('getChildren this.treeData', this.treeData);

    if (element) {
      return element.children;
    }

    if (!this.treeData || this.treeData.rootNodes.length === 0) {
      return [{ id: 'placeholder-no-issues', filePath: '', children: [] }];
    }

    return this.treeData.rootNodes;
  }

  // --- Command Implementations ---

  async disassociateIssue(node: TreeNode): Promise<void> {
    if (node.id === 'placeholder-no-issues') {
      return; // 不能解除占位符的关联
    }
    if (!this.treeData) {
      return;
    }

    const originalTree = JSON.stringify(this.treeData.rootNodes);
    this.treeData.rootNodes = removeNode(this.treeData.rootNodes, node.id);

    // 检查树是否真的发生了变化
    if (originalTree !== JSON.stringify(this.treeData.rootNodes)) {
      await writeTree(this.treeData);
      this.refresh();
      // 通知孤立问题视图刷新，因为有新的孤立问题出现了
      vscode.commands.executeCommand('issueManager.isolatedIssues.refresh');
    }
  }
}
