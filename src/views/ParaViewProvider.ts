import * as vscode from 'vscode';
import * as path from 'path';
import {
  readPara,
  ParaData,
  ParaCategory,
  getCategoryLabel,
  getCategoryIcon
} from '../data/paraManager';
import { readTree, IssueTreeNode, TreeData, getTreeNodeById, findParentNodeById, getAncestors } from '../data/treeManager';
import { getIssueDir } from '../config';
import { TitleCacheService } from '../services/TitleCacheService';
import { ParaViewNode } from '../types';

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
        return await this.createIssueTreeItem(element.id, element.category, element.isTopLevel ?? false, issueDir);
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
        const treeNode = this.treeData ? getTreeNodeById(this.treeData, id) : null;
        if (treeNode) {
          nodes.push({
            type: 'issue' as const,
            id,
            category: element.category,
            treeNode,
            isTopLevel: true  // 直接在分类下的节点是顶级节点
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
        treeNode: child,
        isTopLevel: false  // 子节点不是顶级节点
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
  private async createIssueTreeItem(issueId: string, category: ParaCategory, isTopLevel: boolean, issueDir: string): Promise<vscode.TreeItem> {
    // 从树数据中查找节点以获取 filePath
  const node = this.treeData ? getTreeNodeById(this.treeData, issueId) : null;
    
    if (!node) {
      // 如果找不到节点，可能已被删除
      return new vscode.TreeItem(`[已删除] ${issueId}`, vscode.TreeItemCollapsibleState.None);
    }
    
  const absolutePath = path.join(issueDir, node.filePath);
  const fileUri = vscode.Uri.file(absolutePath);
  // 优先从标题缓存获取，未命中回退到文件名，避免在渲染阶段触发 I/O
  const titleCache = TitleCacheService.getInstance();
  const cachedTitle = await titleCache.get(node.filePath);
  const title = cachedTitle || path.basename(node.filePath, '.md');
    
    // 根据是否有子节点决定折叠状态
    const hasChildren = node.children && node.children.length > 0;
    const collapsibleState = hasChildren
      ? (node.expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
      : vscode.TreeItemCollapsibleState.None;
    
    const item = new vscode.TreeItem(
      title,
      collapsibleState
    );
    
    // contextValue 区分顶级节点和子节点
    // 只有顶级节点才能删除和移动
    if (isTopLevel) {
      item.contextValue = `paraIssue-${category}`;
    } else {
      item.contextValue = `paraIssueChild-${category}`;
    }
    
    item.resourceUri = fileUri;
    // 顶级节点使用分类图标,子节点使用文件图标
    item.iconPath = isTopLevel 
      ? new vscode.ThemeIcon(getCategoryIcon(category))
      : vscode.ThemeIcon.File;
    item.tooltip = node.filePath;
    
    // 点击打开文件
    item.command = {
      command: 'issueManager.openAndViewRelatedIssues',
      title: '打开并查看相关联问题',
      // 附带 issueId 和 viewSource，方便在编辑器中区分同一路径的不同节点上下文
      arguments: [fileUri.with({ query: `issueId=${encodeURIComponent(issueId)}&viewSource=para` })]
    };
    
    // 顶级（直接挂在分类下）的节点，展示其祖先路径，便于在 PARA 视图中辨识来源
    if (isTopLevel && this.treeData) {
      const ancestors = getAncestors(issueId, this.treeData);
      const ancestorTitles = await titleCache.getMany(ancestors.map(a => a.filePath));
      if (ancestorTitles.length > 0) {
        item.description = `/ ${ancestorTitles.join(' / ')}`;
      }
    }
    
    return item;
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
      const parentTreeNode = findParentNodeById(this.treeData.rootNodes, element.id);
      
      if (parentTreeNode) {
        // 有父节点，返回父节点的 ParaViewNode
        // 检查父节点是否是 PARA 顶级节点
        const isParentTopLevel = this.paraData[element.category].includes(parentTreeNode.id);
        return {
          type: 'issue' as const,
          id: parentTreeNode.id,
          category: element.category,
          treeNode: parentTreeNode,
          isTopLevel: isParentTopLevel
        };
      } else {
        // 没有父节点，说明是根节点，父节点是分类节点
        return { type: 'category', category: element.category };
      }
    }

    return null;
  }

}
