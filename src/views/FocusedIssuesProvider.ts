import * as vscode from 'vscode';
import { TreeDataProvider, Event, EventEmitter } from 'vscode';
import { readTree, IssueNode, TreeData, FocusedData, getAncestors, isFocusedRootId, stripFocusedId, toFocusedId, findParentNodeById, getIssueNodeContextValue } from '../data/issueTreeManager';
import { readFocused, trimFocusedToMaxItems } from '../data/focusedManager';
import { getIssueNodeIconPath } from '../data/issueTreeManager';

import * as path from 'path';
import { getIssueDir } from '../config';
import { getIssueMarkdownTitleFromCache } from '../data/IssueMarkdowns';

/**
 * 关注问题视图的 TreeDataProvider。
 * 仅实现基础框架，后续补充过滤树逻辑。
 */
export class FocusedIssuesProvider implements TreeDataProvider<IssueNode> {
  private _onDidChangeTreeData: EventEmitter<IssueNode | undefined | void> = new EventEmitter<IssueNode | undefined | void>();
  readonly onDidChangeTreeData: Event<IssueNode | undefined | void> = this._onDidChangeTreeData.event;

  private treeData: TreeData | null = null;
  private focusedData: FocusedData | null = null;
  private filteredTreeCache: IssueNode[] | null = null;
  constructor(private context: vscode.ExtensionContext) {
    // 监听配置变更，当 maxItems 改变时裁剪列表并刷新视图
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(async e => {
        if (e.affectsConfiguration('issueManager.focused.maxItems')) {
          await this.handleMaxItemsChange();
        }
      })
    );
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

  /** 处理 maxItems 配置变更 */
  private async handleMaxItemsChange() {
    const removedCount = await trimFocusedToMaxItems();
    if (removedCount > 0) {
      // 有节点被移除，显示通知
      vscode.window.showInformationMessage(
        `关注列表已裁剪，移除了 ${removedCount} 个最旧的问题以符合新的配置限制。`
      );
    }
    // 刷新视图以反映变更
    await this.refresh();
  }


  async getTreeItem(element: IssueNode): Promise<vscode.TreeItem> {
    const issueDir = getIssueDir();
    if (!issueDir || !this.treeData) {
      throw new Error("Issue directory or tree data is not available.");
    }

    // 占位节点处理
    if (element.id === 'placeholder-no-focused') {
      return new vscode.TreeItem("暂无关注问题，请在“问题总览”视图中右键选择“添加到关注”", vscode.TreeItemCollapsibleState.None);
    }

    const realId = stripFocusedId(element.id);
  const uri = vscode.Uri.file(path.join(issueDir, element.filePath));
  // 使用标题缓存，未命中回退到文件名，避免渲染阶段 I/O
  const title = getIssueMarkdownTitleFromCache(element.filePath);

    const item = new vscode.TreeItem(title,
      element.children && element.children.length > 0
        ? (element.expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
        : vscode.TreeItemCollapsibleState.None);

    item.id = element.id;
    item.resourceUri = uri;

    const focusIndex = this.focusedData?.focusList.indexOf(realId);
    const isFirstLevelNode = isFocusedRootId(element.id);
    // 第一个关注的根节点，不显示置顶
    item.contextValue = await getIssueNodeContextValue(element.id, isFirstLevelNode ? (focusIndex === 0 ? 'focusedNodeFirst' : 'focusedNode') : 'issueNode');
    item.iconPath = await getIssueNodeIconPath(realId);

    item.command = {
      command: 'issueManager.openAndViewRelatedIssues',
      title: '打开并查看相关联问题',
      arguments: [uri.with({ query: `issueId=${encodeURIComponent(stripFocusedId(element.id))}` })],
    };

    // 生成并设置 description
    const ancestors = getAncestors(realId, this.treeData);
    const ancestorTitles = ancestors.map(a => getIssueMarkdownTitleFromCache(a.filePath));
    if (ancestorTitles.length > 0 && isFocusedRootId(element.id)) {
      item.description = `/ ${ancestorTitles.join(' / ')}`;
    }

    return item;
  }

  /**
   * 构建关注过滤树：focusList 中每个节点都独立作为顶层，完整展示其子树。
   * 为避免 VS Code TreeView id 冲突，顶层节点 id 加特殊后缀。
   */
  private buildFilteredTree(): IssueNode[] {
    if (!this.treeData || !this.focusedData) { return []; }
    const idToNode = new Map<string, IssueNode>();
    // 建立 id 到节点的映射
    const collectMap = (nodes: IssueNode[]) => {
      for (const node of nodes) {
        idToNode.set(node.id, node);
        if (node.children) { collectMap(node.children); }
      }
    };
    collectMap(this.treeData.rootNodes);

    // 每个 focusList 节点都独立收集其完整子树，顶层节点 id 加后缀
    const result: IssueNode[] = [];
    const collectDescendants = (node: IssueNode, rootId: string): IssueNode => {
      return {
        ...node,
        id: toFocusedId(node.id, rootId),
        children: node.children ? node.children.map(n => collectDescendants(n, rootId)) : [],
        resourceUri: node.resourceUri,
      };
    };
    for (const id of new Set(this.focusedData.focusList)) {
      const node = idToNode.get(id);
      if (node) {
        // 顶层节点 id 加后缀，避免与树中其他位置重复
        const topNode: IssueNode = {
          ...collectDescendants(node, id),
          id: toFocusedId(id, id),
          resourceUri: node.resourceUri,
        };
        result.push(topNode);
      }
    }
    return result;
  }

  /**
   * 获取指定元素的父节点。
   * 此方法是 TreeDataProvider 接口的一部分，用于支持 `reveal` 等操作。
   * @param element 要查找其父节点的元素。
   * @returns 父节点 `IssueNode`，如果元素是根节点或未找到，则返回 `null`。
   */
  getParent(element: IssueNode): IssueNode | null {
    if (!this.treeData || !this.focusedData) { return null; }
    const filtered = this.getFilteredTreeFromCache();
    return findParentNodeById(filtered, element.id, (child, target) => stripFocusedId(child.id) === stripFocusedId(target));
  }
  findFirstFocusedNodeById(id: string): { node: IssueNode, parentList: IssueNode[] } | null {

    function findFirstNodeById(nodes: IssueNode[], id: string): { node: IssueNode, parentList: IssueNode[] } | null {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (stripFocusedId(node.id) === stripFocusedId(id)) {
          return { node, parentList: nodes };
        }
        if (node.children && node.children.length > 0) {
          const found = findFirstNodeById(node.children, id);
          if (found) {
            return found;
          }
        }
      }
      return null;
    }

    const tree = this.getFilteredTreeFromCache();
    return findFirstNodeById(tree, id);
  }


  getFilteredTreeFromCache(): IssueNode[] {
    if (!this.filteredTreeCache) {
      this.filteredTreeCache = this.buildFilteredTree();
    }
    return this.filteredTreeCache;
  }
  setFilteredTreeCache(filteredTree: IssueNode[]): void {
    this.filteredTreeCache = filteredTree;
  }

  getChildren(element?: IssueNode): Thenable<IssueNode[]> {
    if (!this.treeData || !this.focusedData) { return Promise.resolve([]); }
    if (!element) {
      const filtered = this.buildFilteredTree();
      this.setFilteredTreeCache(filtered);
      if (filtered.length === 0) {
        // Show a placeholder message when there are no nodes
        return Promise.resolve([{ id: 'placeholder-no-focused', filePath: '', children: [], resourceUri: vscode.Uri.file(''), parent: [] }]);
      } else {
        return Promise.resolve(filtered);
      }
    }
    return Promise.resolve(element.children);
  }
}
