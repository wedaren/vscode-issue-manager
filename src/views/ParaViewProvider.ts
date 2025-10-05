import * as vscode from 'vscode';
import * as path from 'path';
import {
  readPara,
  ParaData,
  ParaCategory,
  getCategoryLabel,
  getCategoryIcon
} from '../data/paraManager';
import { readTree, IssueTreeNode, TreeData } from '../data/treeManager';
import { getIssueDir } from '../config';
import { getTitle } from '../utils/markdown';

/**
 * PARA 视图节点类型
 */
type ParaViewNode = 
  | { type: 'category'; category: ParaCategory }
  | { type: 'issue'; id: string; category: ParaCategory };

/**
 * PARA 视图的 TreeDataProvider
 * 
 * 实现 PARA (Projects, Areas, Resources, Archives) 方法论的视图
 */
export class ParaViewProvider implements vscode.TreeDataProvider<ParaViewNode> {
  private _onDidChangeTreeData: vscode.EventEmitter<ParaViewNode | undefined | void> = 
    new vscode.EventEmitter<ParaViewNode | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<ParaViewNode | undefined | void> = 
    this._onDidChangeTreeData.event;

  private paraData: ParaData | null = null;
  private treeData: TreeData | null = null;

  constructor(private context: vscode.ExtensionContext) {}

  /**
   * 刷新视图
   */
  async refresh(): Promise<void> {
    await this.loadData();
  }

  /**
   * 加载数据
   */
  async loadData(): Promise<void> {
    this.paraData = await readPara();
    this.treeData = await readTree();
    this._onDidChangeTreeData.fire();
  }

  /**
   * 获取树节点
   */
  async getTreeItem(element: ParaViewNode): Promise<vscode.TreeItem> {
    const issueDir = getIssueDir();
    if (!issueDir) {
      return new vscode.TreeItem('未配置问题目录', vscode.TreeItemCollapsibleState.None);
    }

    switch (element.type) {
      case 'category':
        return this.createCategoryTreeItem(element.category);
      
      case 'issue':
        return await this.createIssueTreeItem(element.id, element.category, issueDir);
    }
  }

  /**
   * 获取子节点
   */
  async getChildren(element?: ParaViewNode): Promise<ParaViewNode[]> {
    if (!this.paraData) {
      await this.loadData();
    }

    if (!this.paraData) {
      return [];
    }

    // 根节点：显示四大分类
    if (!element) {
      return [
        { type: 'category', category: ParaCategory.Projects },
        { type: 'category', category: ParaCategory.Areas },
        { type: 'category', category: ParaCategory.Resources },
        { type: 'category', category: ParaCategory.Archives }
      ];
    }

    // 分类节点：显示该分类下的问题
    if (element.type === 'category') {
      const issueIds = this.paraData[element.category];
      return issueIds.map(id => ({
        type: 'issue' as const,
        id,
        category: element.category
      }));
    }

    return [];
  }

  /**
   * 创建分类树节点
   */
  private createCategoryTreeItem(category: ParaCategory): vscode.TreeItem {
    const label = getCategoryLabel(category);
    const item = new vscode.TreeItem(
      label,
      vscode.TreeItemCollapsibleState.Expanded
    );
    item.contextValue = `paraCategory:${category}`;
    item.iconPath = new vscode.ThemeIcon(getCategoryIcon(category));
    
    const issues = this.paraData?.[category] || [];
    const count = issues.length;
    item.description = count > 0 ? `${count} 个问题` : '';
    
    return item;
  }

  /**
   * 创建问题树节点
   */
  private async createIssueTreeItem(issueId: string, category: ParaCategory, issueDir: string): Promise<vscode.TreeItem> {
    // 从树数据中查找节点以获取 filePath
    const node = this.findNodeById(issueId);
    
    if (!node) {
      // 如果找不到节点，可能已被删除
      return new vscode.TreeItem(`[已删除] ${issueId}`, vscode.TreeItemCollapsibleState.None);
    }
    
    const absolutePath = path.join(issueDir, node.filePath);
    const fileUri = vscode.Uri.file(absolutePath);
    const title = await getTitle(fileUri) || path.basename(node.filePath, '.md');
    
    const item = new vscode.TreeItem(
      title,
      vscode.TreeItemCollapsibleState.None
    );
    
    item.contextValue = 'paraIssue';
    item.resourceUri = fileUri;
    item.iconPath = vscode.ThemeIcon.File;
    item.tooltip = node.filePath;
    
    // 点击打开文件
    item.command = {
      command: 'vscode.open',
      title: '打开文件',
      arguments: [fileUri]
    };
    
    return item;
  }

  /**
   * 从树数据中根据 id 查找节点
   */
  private findNodeById(id: string): IssueTreeNode | null {
    if (!this.treeData) {
      return null;
    }

    const findInNode = (node: IssueTreeNode): IssueTreeNode | null => {
      if (node.id === id) {
        return node;
      }
      for (const child of node.children) {
        const found = findInNode(child);
        if (found) {
          return found;
        }
      }
      return null;
    };

    for (const root of this.treeData.rootNodes) {
      const found = findInNode(root);
      if (found) {
        return found;
      }
    }

    return null;
  }

  /**
   * 获取父节点（用于 reveal）
   */
  getParent(element: ParaViewNode): vscode.ProviderResult<ParaViewNode> {
    if (!this.paraData) {
      return null;
    }

    if (element.type === 'issue') {
      // 问题的父节点是分类节点
      return { type: 'category', category: element.category };
    }

    return null;
  }
}
