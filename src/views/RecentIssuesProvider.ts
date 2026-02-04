import * as vscode from 'vscode';
import * as path from 'path';
import { getIssueDir, getRecentIssuesDefaultMode, type ViewMode } from '../config';
import { getIssueMarkdownContextValues, getIssueMarkdownTitleFromCache } from '../data/IssueMarkdowns';
import { formatCompactDateTime, formatRelativeTime } from '../utils/dateUtils';
import { getIssueNodeContextValue, getIssueNodeIconPath, getIssueNodesByUri, getSingleIssueNodeByUri, type IssueNode } from '../data/issueTreeManager';
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
import { getIssueIdFromUri } from '../utils/uriUtils';

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
 * IssueMarkdown 树节点（用于“最近问题”视图）
 * - children 为该 IssueMarkdown 对应的 IssueNode（同一文件可对应多个节点）
 */
class IssueMarkdownTreeItem extends vscode.TreeItem {
  constructor(
    public readonly stat: RecentIssueStats,
    public readonly label: string,
    collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
    this.resourceUri = stat.uri;
  }
}

/**
 * IssueNode 树节点（用于展示 IssueMarkdown 的节点映射）
 */
class IssueNodeTreeItem extends vscode.TreeItem {
  constructor(
    public readonly node: IssueNode,
    public readonly label: string,
    collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
    this.id = node.id;
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
  private dataCache: { issues: RecentIssueStats[], groups: IssueGroup[] } | null = null;

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
      vscode.commands.registerCommand('issueManager.setRecentSort.vtime', () => {
        this.setSortOrder('vtime');
      }),
      vscode.commands.registerCommand('issueManager.openAndViewRelatedIssues', async (uri: vscode.Uri) => {
        let issueId = getIssueIdFromUri(uri);
        if (!issueId) {
          const node = await getSingleIssueNodeByUri(uri);
          issueId = node?.id;
          if (issueId) {
            uri = uri.with({ query: `issueId=${encodeURIComponent(issueId)}` });
          }
        }

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
    this.dataCache = null;
    this._onDidChangeTreeData.fire();
  }

  /**
   * 获取或加载数据（带缓存）
   */
  private async getOrLoadData(): Promise<{ issues: RecentIssueStats[], groups: IssueGroup[] }> {
    if (this.dataCache) {
      return this.dataCache;
    }
    const issues = await getRecentIssuesStats(this.sortOrder);
    const groups = groupIssuesByTime(issues, this.sortOrder);
    this.dataCache = { issues, groups };
    return this.dataCache;
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

    if (element instanceof IssueMarkdownTreeItem) {
      return this.getIssueMarkdownChildren(element);
    }

    if (element instanceof IssueNodeTreeItem) {
      return [];
    }

    // 根节点：获取所有最近问题
    const { issues, groups } = await this.getOrLoadData();
    if (!issues || issues.length === 0) { return []; }

    if (this.viewMode === 'list') {
      return Promise.all(issues.map((stat: RecentIssueStats) => this.createFileTreeItem(stat)));
    }

    // 分组模式
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

    // 非孤立 issueMarkdown：若仅对应一个 IssueNode，则直接展示该 IssueNode（不展示中间层）
    if (!stat.isIsolated) {
      const nodes = await getIssueNodesByUri(stat.uri);
      if (nodes.length === 1) {
        const item = await this.createIssueNodeTreeItem(nodes[0], stat);
        // 同时用 uriKey 缓存，便于 getElementByUri / reveal 走同一对象
        this.itemCache.set(key, item);
        return item;
      }
    }

    // 非孤立 issueMarkdown：允许展开，children 为对应的 IssueNode
    const collapsibleState = stat.isIsolated
      ? vscode.TreeItemCollapsibleState.None
      : vscode.TreeItemCollapsibleState.Collapsed;

    const item = new IssueMarkdownTreeItem(stat, title, collapsibleState);
    item.resourceUri = stat.uri;
    item.command = {
      command: 'issueManager.openAndViewRelatedIssues',
      title: '打开并查看相关联问题',
      arguments: [stat.uri],
    };
    item.contextValue = stat.isIsolated ? 'isolatedIssue' : getIssueMarkdownContextValues();
    item.iconPath = stat.isIsolated
      ? new vscode.ThemeIcon('debug-disconnect')
      : new vscode.ThemeIcon('notebook');

    const timestamp = this.getSortTimestamp(stat);
    item.description = this.formatTimestampDescription(timestamp);

    item.tooltip = this.createTooltipMarkdown(stat, stat.uri);
    
    this.itemCache.set(key, item);
    return item;
  }

  /**
   * 创建 tooltip 的 Markdown（IssueMarkdown 与 IssueNode 共用）
   */
  private createTooltipMarkdown(stat: RecentIssueStats, uri: vscode.Uri, node?: IssueNode): vscode.MarkdownString {
    const timestamp = this.getSortTimestamp(stat);
    const tooltipLines: string[] = [
      `路径: \`${uri.fsPath}\``,
      `\n排序时间(${this.sortOrder}): ${formatRelativeTime(timestamp)} · ${formatCompactDateTime(timestamp)} (${timestamp.toLocaleString()})`,
      `\n修改时间: ${formatRelativeTime(stat.mtime)} · ${formatCompactDateTime(stat.mtime)} (${stat.mtime.toLocaleString()})`,
      `\n创建时间: ${formatRelativeTime(stat.ctime)} · ${formatCompactDateTime(stat.ctime)} (${stat.ctime.toLocaleString()})`,
    ];

    if (stat.vtime) {
      tooltipLines.push(
        `\n查看时间: ${formatRelativeTime(stat.vtime)} · ${formatCompactDateTime(stat.vtime)} (${stat.vtime.toLocaleString()})`
      );
    }

    if (node?.parent?.length) {
      const parentTitles = node.parent
        .map(p => getIssueMarkdownTitleFromCache(p.filePath))
        .filter((t): t is string => !!t);
      if (parentTitles.length > 0) {
        tooltipLines.push(`\n\n层级: ${parentTitles.join(' / ')}`);
      }
    }

    return new vscode.MarkdownString(tooltipLines.join('\n'));
  }

  /**
   * IssueMarkdown 的 children：对应的 IssueNode 列表
   */
  private async getIssueMarkdownChildren(element: IssueMarkdownTreeItem): Promise<vscode.TreeItem[]> {
    // “孤立问题”没有对应节点
    if (element.stat.isIsolated) {
      return [];
    }

    const nodes = await getIssueNodesByUri(element.stat.uri);
    if (!nodes || nodes.length === 0) {
      return [];
    }

    // 保持稳定顺序：按祖先链长度 + id
    const sorted = [...nodes].sort((a, b) => {
      const al = a.parent?.length ?? 0;
      const bl = b.parent?.length ?? 0;
      if (al !== bl) { return al - bl; }
      return a.id.localeCompare(b.id);
    });

    return Promise.all(sorted.map(n => this.createIssueNodeTreeItem(n, element.stat)));
  }

  /**
   * 创建 IssueNode 的 TreeItem（用于展示并触发对应操作菜单）
   */
  private async createIssueNodeTreeItem(node: IssueNode, stat: RecentIssueStats): Promise<vscode.TreeItem> {
    const key = `issueNode:${node.id}`;
    const cached = this.itemCache.get(key);
    if (cached) { return cached; }

    const issueDir = getIssueDir();
    if (!issueDir) {
      // 理论上不应发生：RecentIssuesProvider 已依赖 issueDir
      return new vscode.TreeItem('未配置 issueDir', vscode.TreeItemCollapsibleState.None);
    }

    const title = getIssueMarkdownTitleFromCache(node.filePath) || '';
    // 在“最近问题”视图中，IssueNode 作为叶子节点展示（不展开子节点）
    const item = new IssueNodeTreeItem(node, title, vscode.TreeItemCollapsibleState.None);

    const uri = vscode.Uri.file(path.join(issueDir, node.filePath));
    item.resourceUri = uri;
    item.contextValue = await getIssueNodeContextValue(node.id, 'issueNode');
    item.iconPath = await getIssueNodeIconPath(node.id);
    item.command = {
      command: 'issueManager.openAndViewRelatedIssues',
      title: '打开并查看相关联问题',
      arguments: [uri.with({ query: `issueId=${encodeURIComponent(node.id)}` })],
    };

    // description 统一展示时间信息
    const timestamp = this.getSortTimestamp(stat);
    item.description = this.formatTimestampDescription(timestamp);

    // 将父节点层级信息放入 tooltip（作为 detail 信息）
    item.tooltip = this.createTooltipMarkdown(stat, uri, node);

    this.itemCache.set(key, item);
    return item;
  }

  /**
   * 根据当前 sortOrder 选择用于展示/排序的时间戳
   */
  private getSortTimestamp(stat: RecentIssueStats): Date {
    if (this.sortOrder === 'ctime') {
      return stat.ctime;
    }
    if (this.sortOrder === 'vtime') {
      return stat.vtime ?? stat.mtime;
    }
    return stat.mtime;
  }

  /**
   * description 展示的时间文本
   */
  private formatTimestampDescription(timestamp: Date): string {
    if (this.viewMode === 'list') {
      const relative = formatRelativeTime(timestamp);
      const compact = formatCompactDateTime(timestamp);
      return `${relative} · ${compact}`;
    }
    return timestamp.toLocaleTimeString();
  }

  /**
   * 根据 Uri 获取对应的 TreeItem（若尚未创建则尝试构建并缓存）
   * @param uri 文件 Uri
   */
  public async getElementByUri(uri: vscode.Uri): Promise<vscode.TreeItem | null> {
    const key = this.makeCacheKey(uri);
    const cached = this.itemCache.get(key);
    if (cached) { return cached; }

    const { issues } = await this.getOrLoadData();
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

    const { issues, groups } = await this.getOrLoadData();
    if (!issues || issues.length === 0) { return null; }

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
