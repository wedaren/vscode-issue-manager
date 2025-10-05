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
 * 保持问题总览中的树结构
 */
type ParaViewNode = 
  | { type: 'category'; category: ParaCategory }
  | { type: 'issue'; id: string; category: ParaCategory; treeNode: IssueTreeNode };

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

    // 分类节点：显示该分类下的问题（根节点）
    if (element.type === 'category') {
      const issueIds = this.paraData[element.category];
      const nodes: ParaViewNode[] = [];
      
      for (const id of issueIds) {
        const treeNode = this.findNodeById(id);
        if (treeNode) {
          nodes.push({
            type: 'issue' as const,
            id,
            category: element.category,
            treeNode
          });
        }
      }
      
      return nodes;
    }

    // 问题节点：显示其子节点（保持树结构）
    if (element.type === 'issue') {
      const children = element.treeNode.children;
      return children.map(child => ({
        type: 'issue' as const,
        id: child.id,
        category: element.category,
        treeNode: child
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
    
    // 根据是否有子节点决定折叠状态
    const hasChildren = node.children && node.children.length > 0;
    const collapsibleState = hasChildren
      ? (node.expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
      : vscode.TreeItemCollapsibleState.None;
    
    const item = new vscode.TreeItem(
      title,
      collapsibleState
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
    if (!this.paraData || !this.treeData) {
      return null;
    }

    if (element.type === 'issue') {
      // 查找父节点
      const parentTreeNode = this.findParentNode(element.id);
      
      if (parentTreeNode) {
        // 有父节点，返回父节点的 ParaViewNode
        return {
          type: 'issue' as const,
          id: parentTreeNode.id,
          category: element.category,
          treeNode: parentTreeNode
        };
      } else {
        // 没有父节点，说明是根节点，父节点是分类节点
        return { type: 'category', category: element.category };
      }
    }

    return null;
  }

  /**
   * 查找节点的父节点
   */
  private findParentNode(childId: string): IssueTreeNode | null {
    if (!this.treeData) {
      return null;
    }

    const findParent = (node: IssueTreeNode, targetId: string): IssueTreeNode | null => {
      // 检查子节点中是否有目标节点
      for (const child of node.children) {
        if (child.id === targetId) {
          return node;
        }
      }
      // 递归查找
      for (const child of node.children) {
        const found = findParent(child, targetId);
        if (found) {
          return found;
        }
      }
      return null;
    };

    for (const root of this.treeData.rootNodes) {
      const found = findParent(root, childId);
      if (found) {
        return found;
      }
    }

    return null;
  }
}
