import * as vscode from 'vscode';
import * as path from 'path';
import { readTree, writeTree, TreeData, TreeNode, removeNode as removeNodeFromData, findNodeById } from '../data/treeManager';
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
      return element.children;
    }

    if (this.treeData && this.treeData.rootNodes.length > 0) {
      return this.treeData.rootNodes;
    }

    // Show a placeholder message when there are no nodes
    return [{ id: 'placeholder-no-issues', filePath: '', children: [] }];
  }

  public getTreeData(): TreeData | null {
    return this.treeData;
  }

  public getNode(id: string): TreeNode | null {
    if (!this.treeData) {
      return null;
    }
    return findNodeById(this.treeData.rootNodes, id)?.node || null;
  }

  async disassociateIssue(node: TreeNode): Promise<boolean> {
    if (!this.treeData || node.id === 'placeholder-no-issues') {
      return false;
    }

    // 判断是否有子节点
    if (node.children && node.children.length > 0) {
      const confirm = await vscode.window.showWarningMessage(
        '该节点下包含子问题，解除关联将一并移除其所有子节点。是否继续？',
        { modal: true },
        '确定'
      );
      if (confirm !== '确定') {
        return false;
      }
    }

    const { success } = removeNodeFromData(this.treeData, node.id);

    if (success) {
      await writeTree(this.treeData);
      return true;
    } else {
      vscode.window.showWarningMessage('无法在树中找到该节点以解除关联。');
      return false;
    }
  }
}
