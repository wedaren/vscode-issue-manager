import * as vscode from 'vscode';
import * as path from 'path';
import { getIssueDir, getRecentIssuesDefaultMode, type ViewMode } from '../config';
import { getIssueMarkdownTitleFromCache } from '../data/IssueMarkdowns';
import {
  getRecentIssuesStats,
  groupIssuesByTime,
  groupByDay,
  groupByWeek,
  DEFAULT_EXPANDED_GROUPS,
  type RecentIssueStats,
  type IssueGroup,
  type SubgroupStrategy,
  type SortOrder,
} from '../data/recentIssuesManager';

/**
 * 分组树节点
 */
class GroupTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly files: RecentIssueStats[],
    public readonly subgroupStrategy: SubgroupStrategy,
    public readonly expanded: boolean = false
  ) {
    super(label, expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
    this.description = `(${files.length})`;
    this.contextValue = subgroupStrategy ? `group-${subgroupStrategy}` : 'group-direct';
  }
}

/**
 * "最近问题"视图的数据提供者
 * 支持"列表"和"分组"两种展示模式
 */
export class RecentIssuesProvider implements vscode.TreeDataProvider<vscode.TreeItem> {

  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private viewMode: ViewMode;
  private sortOrder: SortOrder = 'ctime';
  private itemCache = new Map<string, vscode.TreeItem>();

  constructor(private context: vscode.ExtensionContext) {
    this.viewMode = getRecentIssuesDefaultMode();
    this.registerCommands();
    this.setSortContext();
    this.setViewModeContext();

    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('issueManager.issueDir')) {
        this.refresh();
      }
    });
  }

  /**
   * 注册所有命令
   */
  private registerCommands(): void {
    this.context.subscriptions.push(
      vscode.commands.registerCommand('issueManager.setRecentIssuesViewMode.group', () => {
        this.setViewMode('grouped');
      }),
      vscode.commands.registerCommand('issueManager.setRecentIssuesViewMode.list', () => {
        this.setViewMode('list');
      }),
      vscode.commands.registerCommand('issueManager.setRecentSort.ctime', () => {
        this.setSortOrder('ctime');
      }),
      vscode.commands.registerCommand('issueManager.setRecentSort.mtime', () => {
        this.setSortOrder('mtime');
      }),
      vscode.commands.registerCommand('issueManager.openAndViewRelatedIssues', async (uri: vscode.Uri) => {
        try {
          await vscode.window.showTextDocument(uri);
        } catch (error) {
          console.error(`打开并查看相关联问题失败: ${uri.fsPath}`, error);
          vscode.window.showErrorMessage('打开并查看相关联问题失败。');
        }
      })
    );
  }

  /**
   * 设置视图模式并刷新
   * @param mode 视图模式
   */
  setViewMode(mode: ViewMode): void {
    this.viewMode = mode;
    this.setViewModeContext();
    this.refresh();
  }

  /**
   * 设置排序顺序并刷新视图
   * @param order 排序方式
   */
  setSortOrder(order: SortOrder): void {
    this.sortOrder = order;
    this.setSortContext();
    this.refresh();
  }

  private setSortContext(): void {
    vscode.commands.executeCommand('setContext', 'issueManager.recentIssuesSortOrder', this.sortOrder);
  }

  private setViewModeContext(): void {
    vscode.commands.executeCommand('setContext', 'issueManager.recentIssuesViewMode', this.viewMode);
  }

  /**
   * 刷新视图
   */
  refresh(): void {
    this.itemCache.clear();
    this._onDidChangeTreeData.fire();
  }

  /**
   * 获取树中的每一个项目
   * @param element 项目元素
   */
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * 获取元素的子项目
   * @param element 项目元素，如果为 undefined，则获取根节点
   */
  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element instanceof GroupTreeItem) {
      return this.getGroupChildren(element);
    }

    // 根节点：获取所有最近问题
    const issues = await getRecentIssuesStats(this.sortOrder);
    if (!issues || issues.length === 0) { return []; }

    if (this.viewMode === 'list') {
      return Promise.all(issues.map((stat: RecentIssueStats) => this.createFileTreeItem(stat)));
    }

    // 分组模式
    const groups = groupIssuesByTime(issues, this.sortOrder);
    return groups.map((group: IssueGroup) => 
      new GroupTreeItem(
        group.label, 
        group.files, 
        group.subgroupStrategy, 
        DEFAULT_EXPANDED_GROUPS.includes(group.label)
      )
    );
  }

  /**
   * 获取分组的子节点
   */
  private async getGroupChildren(group: GroupTreeItem): Promise<vscode.TreeItem[]> {
    // 没有子分组策略，直接展示文件
    if (!group.subgroupStrategy) {
      return Promise.all(group.files.map(stat => this.createFileTreeItem(stat)));
    }

    // 按天分组
    if (group.subgroupStrategy === 'day') {
      return this.createDaySubgroups(group.files);
    }

    // 按周分组
    if (group.subgroupStrategy === 'week') {
      return this.createWeekSubgroups(group.files);
    }

    return [];
  }

  /**
   * 创建日分组
   */
  private createDaySubgroups(files: RecentIssueStats[]): GroupTreeItem[] {
    const dayGroups = groupByDay(files, this.sortOrder);
    return dayGroups.map((g: IssueGroup) => new GroupTreeItem(g.label, g.files, g.subgroupStrategy));
  }

  /**
   * 创建周分组
   */
  private createWeekSubgroups(files: RecentIssueStats[]): GroupTreeItem[] {
    const weekGroups = groupByWeek(files, this.sortOrder);
    return weekGroups.map((g: IssueGroup) => new GroupTreeItem(g.label, g.files, g.subgroupStrategy));
  }

  /**
   * 生成用于缓存的唯一 key
   * 使用 Uri 的 toString() 保证包含 scheme、path 及 query，避免歧义
   */
  private makeCacheKey(uri: vscode.Uri): string {
    const issueDir = getIssueDir();
    if (uri.scheme === 'file' && issueDir) {
      try {
        const rel = path.relative(issueDir, uri.fsPath);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          return uri.toString();
        }
        return rel;
      } catch {
        return uri.toString();
      }
    }
    return uri.toString();
  }

  /**
   * 创建最近问题的树节点，并绑定自定义点击命令
   * 点击时自动打开文件并查看相关联问题
   */
  private async createFileTreeItem(stat: RecentIssueStats): Promise<vscode.TreeItem> {
    const key = this.makeCacheKey(stat.uri);
    const cached = this.itemCache.get(key);
    if (cached) { return cached; }

    const title = getIssueMarkdownTitleFromCache(stat.uri);
    const item = new vscode.TreeItem(title, vscode.TreeItemCollapsibleState.None);
    item.resourceUri = stat.uri;
    item.command = {
      command: 'issueManager.openAndViewRelatedIssues',
      title: '打开并查看相关联问题',
      arguments: [stat.uri],
    };
    item.contextValue = stat.isIsolated ? 'isolatedIssue' : 'recentIssue';
    item.iconPath = stat.isIsolated
      ? new vscode.ThemeIcon('debug-disconnect')
      : new vscode.ThemeIcon('notebook');

    const tooltipText = `路径: \`${stat.uri.fsPath}\`\n\n修改时间: ${stat.mtime.toLocaleString()}\n\n创建时间: ${stat.ctime.toLocaleString()}`;
    item.tooltip = new vscode.MarkdownString(tooltipText);

    this.itemCache.set(key, item);
    return item;
  }

  /**
   * 根据 Uri 获取对应的 TreeItem（若尚未创建则尝试构建并缓存）
   * @param uri 文件 Uri
   */
  public async getElementByUri(uri: vscode.Uri): Promise<vscode.TreeItem | null> {
    const key = this.makeCacheKey(uri);
    const cached = this.itemCache.get(key);
    if (cached) { return cached; }

    const issues = await getRecentIssuesStats(this.sortOrder);
    const matched = issues.find((i: RecentIssueStats) => this.makeCacheKey(i.uri) === key);
    if (!matched) { return null; }

    return this.createFileTreeItem(matched);
  }

  /**
   * 返回给定元素的父元素（用于 TreeView.reveal 路径查找）
   */
  public async getParent(element: vscode.TreeItem): Promise<vscode.TreeItem | null> {
    // 在 list 模式下没有分组父元素
    if (this.viewMode === 'list') { return null; }

    const issues = await getRecentIssuesStats(this.sortOrder);
    if (!issues || issues.length === 0) { return null; }

    // 顶层分组
    const groups = groupIssuesByTime(issues, this.sortOrder);

    // 如果是分组节点，查找其父分组
    if (element instanceof GroupTreeItem) {
      return this.findParentGroup(element, groups);
    }

    // 如果是文件节点，查找其所在的分组
    const uri = element.resourceUri;
    if (!uri) { return null; }

    const key = this.makeCacheKey(uri);
    const matched = issues.find((i: RecentIssueStats) => this.makeCacheKey(i.uri) === key);
    if (!matched) { return null; }

    return this.findFileParentGroup(matched, groups);
  }

  /**
   * 查找分组节点的父分组
   */
  private findParentGroup(childGroup: GroupTreeItem, topGroups: IssueGroup[]): GroupTreeItem | null {
    // 遍历顶层分组
    for (const g of topGroups) {
      // 如果顶层分组直接包含子分组，说明子分组是它的直接子级
      if (g.subgroupStrategy === 'week') {
        const weekGroups = groupByWeek(g.files, this.sortOrder);
        for (const wg of weekGroups) {
          if (wg.label === childGroup.label) {
            // 找到了，返回顶层分组
            return new GroupTreeItem(g.label, g.files, g.subgroupStrategy, DEFAULT_EXPANDED_GROUPS.includes(g.label));
          }
          
          // 检查是否是周分组下的日分组
          if (wg.subgroupStrategy === 'day') {
            const dayGroups = groupByDay(wg.files, this.sortOrder);
            for (const dg of dayGroups) {
              if (dg.label === childGroup.label) {
                // 找到了，返回周分组
                return new GroupTreeItem(wg.label, wg.files, wg.subgroupStrategy);
              }
            }
          }
        }
      } else if (g.subgroupStrategy === 'day') {
        const dayGroups = groupByDay(g.files, this.sortOrder);
        for (const dg of dayGroups) {
          if (dg.label === childGroup.label) {
            // 找到了，返回顶层分组
            return new GroupTreeItem(g.label, g.files, g.subgroupStrategy, DEFAULT_EXPANDED_GROUPS.includes(g.label));
          }
        }
      }
    }

    // 没有找到父级，说明是顶层分组
    return null;
  }

  /**
   * 查找文件所在的直接父分组
   */
  private findFileParentGroup(file: RecentIssueStats, topGroups: IssueGroup[]): GroupTreeItem | null {
    for (const g of topGroups) {
      // 没有子分组策略，直接展示文件
      if (!g.subgroupStrategy) {
        if (g.files.some((f: RecentIssueStats) => f.filePath === file.filePath)) {
          return new GroupTreeItem(g.label, g.files, g.subgroupStrategy, DEFAULT_EXPANDED_GROUPS.includes(g.label));
        }
      } 
      // 按天分组
      else if (g.subgroupStrategy === 'day') {
        const dayGroups = groupByDay(g.files, this.sortOrder);
        for (const dg of dayGroups) {
          if (dg.files.some((f: RecentIssueStats) => f.filePath === file.filePath)) {
            return new GroupTreeItem(dg.label, dg.files, dg.subgroupStrategy);
          }
        }
      } 
      // 按周分组
      else if (g.subgroupStrategy === 'week') {
        const weekGroups = groupByWeek(g.files, this.sortOrder);
        for (const wg of weekGroups) {
          const dayGroups = groupByDay(wg.files, this.sortOrder);
          for (const dg of dayGroups) {
            if (dg.files.some((f: RecentIssueStats) => f.filePath === file.filePath)) {
              // 返回最直接的父级：日分组
              return new GroupTreeItem(dg.label, dg.files, dg.subgroupStrategy);
            }
          }
        }
      }
    }

    return null;
  }
}
