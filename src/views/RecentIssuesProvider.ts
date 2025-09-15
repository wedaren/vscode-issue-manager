import * as vscode from 'vscode';
import * as path from 'path';
import { getIssueDir, getRecentIssuesDefaultMode, type ViewMode } from '../config';
import { getTitle } from '../utils/markdown';
import { getCtimeOrNow, getMtimeOrNow } from '../utils/fileUtils';
import { FileAccessTracker } from '../services/FileAccessTracker';


/**
 * 分组的类型，决定了其子节点的展示方式。
 * - `direct`: 直接展示文件。
 * - `by-day`: 子节点按天分组。
 * - `by-week`: 子节点按周分组。
 * - `day`: 日期分组，直接展示文件。
 * - `week`: 周分组，子节点按天分组。
 */
type GroupType = 'direct' | 'by-day' | 'by-week' | 'day' | 'week';

interface FileStat {
  file: string;
  filePath: string;
  mtime: Date;
  ctime: Date;
  viewTime?: Date;
}

class GroupTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly files: FileStat[],
    public readonly type: GroupType,
    public readonly expanded: boolean = false // 新增参数，控制展开状态
  ) {
    super(label, expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
    this.description = `(${files.length})`;
    this.contextValue = `group-${type}`;
  }
}

/**
 * “最近问题”视图的数据提供者。
 * 支持“列表”和“分组”两种展示模式。
 */
export class RecentIssuesProvider implements vscode.TreeDataProvider<vscode.TreeItem> {

  private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  private viewMode: ViewMode; // 默认值由配置项决定
  private sortOrder: 'mtime' | 'ctime' | 'viewTime' = 'ctime'; // 默认为创建时间
  private fileStatsCache: FileStat[] | null = null;
  private fileAccessTracker: FileAccessTracker;

  constructor(private context: vscode.ExtensionContext) {
    // 初始化时根据配置项设置默认模式
    this.viewMode = getRecentIssuesDefaultMode();

    // 获取文件访问跟踪服务实例
    this.fileAccessTracker = FileAccessTracker.getInstance();

    this.context.subscriptions.push(vscode.commands.registerCommand('issueManager.setRecentIssuesViewMode.group', () => {
      this.setViewMode('grouped');
    }));

    this.context.subscriptions.push(vscode.commands.registerCommand('issueManager.setRecentIssuesViewMode.list', () => {
      this.setViewMode('list');
    }));

    this.context.subscriptions.push(vscode.commands.registerCommand('issueManager.setRecentSort.ctime', () => {
      this.setSortOrder('ctime');
    }));

    this.context.subscriptions.push(vscode.commands.registerCommand('issueManager.setRecentSort.mtime', () => {
      this.setSortOrder('mtime');
    }));

    this.context.subscriptions.push(vscode.commands.registerCommand('issueManager.setRecentSort.viewTime', () => {
      this.setSortOrder('viewTime');
    }));

    this.setSortContext();
    this.setViewModeContext();

    this.context.subscriptions.push(vscode.commands.registerCommand('issueManager.openAndViewRelatedIssues', async (uri: vscode.Uri) => {
      try {
        await vscode.window.showTextDocument(uri);
        await vscode.commands.executeCommand('issueManager.viewRelatedIssues', uri);
      } catch (error) {
        console.error(`打开并查看相关联问题失败: ${uri.fsPath}`, error);
        vscode.window.showErrorMessage('打开并查看相关联问题失败。');
      }
    }));

    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('issueManager.issueDir')) {
        this.refresh();
      }
    });
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
  setSortOrder(order: 'mtime' | 'ctime' | 'viewTime'): void {
    this.sortOrder = order;
    this.setSortContext();
    this.refresh();
  }

  private setSortContext() {
    vscode.commands.executeCommand('setContext', 'issueManager.recentIssuesSortOrder', this.sortOrder);
  }

  private setViewModeContext() {
    vscode.commands.executeCommand('setContext', 'issueManager.recentIssuesViewMode', this.viewMode);
  }

  /**
   * 刷新视图。
   */
  refresh(): void {
    this.fileStatsCache = null; // 清空缓存
    this._onDidChangeTreeData.fire();
  }

  /**
   * 获取文件的查看时间
   * @param filePath 文件路径
   * @returns 查看时间，如果没有记录则返回undefined
   */
  getViewTime(filePath: string): Date | undefined {
    return this.fileAccessTracker.getLastViewTime(filePath);
  }

  /**
   * 获取树中的每一个项目。
   * @param element 项目元素
   */
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * 获取元素的子项目。
   * @param element 项目元素，如果为 undefined，则获取根节点。
   */
  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element instanceof GroupTreeItem) {
      switch (element.type) {
        // 这些类型的分组直接展示其下的文件
        case 'direct':
        case 'day':
          return Promise.all(element.files.map(fileStat => this.createFileTreeItem(fileStat)));

        // 这些类型的分组需要进一步按“天”进行子分组
        case 'by-day':
        case 'week':
          return this.createDaySubgroups(element.files);

        // 这种类型的分组需要进一步按“周”进行子分组
        case 'by-week':
          return this.createWeekSubgroups(element.files);

        default:
          return Promise.resolve([]);
      }
    }

    const fileStats = await this.getFileStats();
    if (!fileStats) {
      return [];
    }

    if (this.viewMode === 'list') {
      return Promise.all(fileStats.map(fileStat => this.createFileTreeItem(fileStat)));
    }

    // Group mode
    const groups = this.groupFiles(fileStats);
    // 仅“今天”、“昨天”、“最近一周”分组默认展开，其他分组保持折叠
    const DEFAULT_EXPANDED_LABELS = ['今天', '昨天', '最近一周'];
    return groups.map(group => new GroupTreeItem(group.label, group.files, group.type, DEFAULT_EXPANDED_LABELS.includes(group.label)));
  }
  /**
   * 从缓存或文件系统获取文件统计信息。
   * @returns FileStat 数组或 null
   */
  private async getFileStats(): Promise<FileStat[] | null> {
    if (this.fileStatsCache) {
      return this.fileStatsCache;
    }

    const issueDir = getIssueDir();
    if (!issueDir) {
      return null;
    }

    // 使用 VS Code 的文件系统 API 获取 .md 文件列表，兼容多平台和虚拟文件系统
    const files: string[] = [];
    const dirUri = vscode.Uri.file(issueDir);
    try {
      for (const [name, type] of await vscode.workspace.fs.readDirectory(dirUri)) {
        if (type === vscode.FileType.File && name.endsWith('.md')) {
          files.push(name);
        }
      }
    } catch (error) {
      console.error(`Error reading issue directory ${issueDir}:`, error);
      vscode.window.showErrorMessage(`无法读取问题目录: ${issueDir}`);
      return null;
    }

    console.log(`Found ${files.length} markdown files in ${issueDir}`);
    const fileStats: FileStat[] = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(issueDir, file);
        const ctime = await getCtimeOrNow(vscode.Uri.file(filePath));
        const mtime = await getMtimeOrNow(vscode.Uri.file(filePath));
        const viewTime = this.getViewTime(filePath);
        return { file, filePath, mtime, ctime, viewTime };
      })
    );

    fileStats.sort((a, b) => {
      if (this.sortOrder === 'viewTime') {
        const aHasView = !!a.viewTime;
        const bHasView = !!b.viewTime;
        if (aHasView !== bHasView) {
          // 有查看记录的排在前面 (降序)
          return aHasView ? -1 : 1;
        }
      }

      const timeA = this.getSortTimestamp(a);
      const timeB = this.getSortTimestamp(b);

      return timeB - timeA; // 降序排序
    });

    this.fileStatsCache = fileStats;
    return this.fileStatsCache;
  }

  /**
   * 获取用于排序的时间戳
   * @param file 文件统计信息
   * @returns 时间戳（毫秒）
   */
  private getSortTimestamp(file: FileStat): number {
    switch (this.sortOrder) {
      case 'mtime':
        return file.mtime.getTime();
      case 'ctime':
        return file.ctime.getTime();
      case 'viewTime':
        // 对于 viewTime 排序，无记录时使用 mtime 作为后备
        return (file.viewTime || file.mtime).getTime();
      default:
        return file.ctime.getTime();
    }
  }

  /**
   * 根据当前排序方式获取文件的日期
   * @param file 文件统计信息
   * @returns 用于分组的日期
   */
  private getFileDateForGrouping(file: FileStat): Date {
    switch (this.sortOrder) {
      case 'mtime':
        return file.mtime;
      case 'ctime':
        return file.ctime;
      case 'viewTime':
        // 对于 viewTime 分组，无记录时使用 mtime 作为后备
        return file.viewTime || file.mtime;
      default:
        return file.ctime;
    }
  }

  /**
   * 将一组文件按“周”进行分组。
   * @param files 要分组的文件列表。
   * @returns GroupTreeItem 数组。
   */
  private createWeekSubgroups(files: FileStat[]): GroupTreeItem[] {
    const now = new Date();
    const startOfWeek = this.getStartOfWeek(new Date());
    const startOfLastWeek = new Date(startOfWeek.getTime() - 7 * 24 * 60 * 60 * 1000);

    const weekGroupDefinitions: { label: string, type: GroupType, test: (fileDate: Date) => boolean, files: FileStat[] }[] = [
      { label: '本周', type: 'by-day', test: (fileDate) => this.normalizeDate(fileDate) >= startOfWeek, files: [] },
      { label: '上周', type: 'by-day', test: (fileDate) => this.normalizeDate(fileDate) >= startOfLastWeek && this.normalizeDate(fileDate) < startOfWeek, files: [] },
    ];

    const otherWeeks: { [week: string]: FileStat[] } = {};

    for (const file of files) {
      const fileDate = this.getFileDateForGrouping(file);
      
      let matched = false;
      for (const group of weekGroupDefinitions) {
        if (group.test(fileDate)) {
          group.files.push(file);
          matched = true;
          break; // 文件只属于第一个匹配的分组
        }
      }
      if (!matched) {
        const fileWeekNumber = this.getWeekNumber(fileDate);
        const [start, end] = this.getWeekDateRange(fileDate.getFullYear(), fileWeekNumber);
        const weekLabel = `第 ${fileWeekNumber} 周 (${start} - ${end})`;

        if (!otherWeeks[weekLabel]) {
          otherWeeks[weekLabel] = [];
        }
        otherWeeks[weekLabel].push(file);
      }
    }

    // 合并所有分组
    const allGroups = [
      ...weekGroupDefinitions.filter(g => g.files.length > 0).map(g => new GroupTreeItem(g.label, g.files, 'week')),
      ...Object.entries(otherWeeks).map(([label, weekFiles]) => new GroupTreeItem(label, weekFiles, 'week'))
    ];

    return allGroups;
  }

  /**
   * 获取给定日期所在周的开始日期（周一）。
   * @param date The date.
   * @returns The first day of the week (Monday).
   */
  private getStartOfWeek(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // 将周日(0)视为一周的最后一天
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private createDaySubgroups(files: FileStat[]): GroupTreeItem[] {
    const filesByDay = new Map<string, FileStat[]>();
    for (const file of files) {
      const fileDate = this.getFileDateForGrouping(file);
      
      const dayKey = this.formatDateWithWeekday(fileDate);
      if (!filesByDay.has(dayKey)) {
        filesByDay.set(dayKey, []);
      }
      filesByDay.get(dayKey)!.push(file);
    }

    const dayGroups = Array.from(filesByDay.entries()).map(([dayLabel, dayFiles]) => {
      return new GroupTreeItem(dayLabel, dayFiles, 'day');
    });
    return dayGroups;
  }

  /**
   * 创建最近问题的树节点，并绑定自定义点击命令。
   * 点击时自动打开文件并查看相关联问题。
   */
  private async createFileTreeItem(fileStat: FileStat): Promise<vscode.TreeItem> {
    const uri = vscode.Uri.file(fileStat.filePath);
    const title = await getTitle(uri);
    const item = new vscode.TreeItem(title, vscode.TreeItemCollapsibleState.None);
    item.resourceUri = uri;
    item.command = {
      command: 'issueManager.openAndViewRelatedIssues',
      title: '打开并查看相关联问题',
      arguments: [uri],
    };
    item.contextValue = 'recentIssue'; // 用于右键菜单
    
    // 构建工具提示，包含访问统计信息
    let tooltipText = `路径: \`${uri.fsPath}\` \n\n修改时间: ${fileStat.mtime.toLocaleString()}\n\n创建时间: ${fileStat.ctime.toLocaleString()}`;
    
    const accessStats = this.fileAccessTracker.getFileAccessStats(fileStat.filePath);
    if (accessStats) {
      tooltipText += `\n\n最近查看: ${new Date(accessStats.lastViewTime).toLocaleString()}`;
      tooltipText += `\n\n查看次数: ${accessStats.viewCount}`;
      if (accessStats.firstViewTime !== accessStats.lastViewTime) {
        tooltipText += `\n\n首次查看: ${new Date(accessStats.firstViewTime).toLocaleString()}`;
      }
    }
    
    item.tooltip = new vscode.MarkdownString(tooltipText);
    
    return item;
  }

  private formatDateWithWeekday(date: Date): string {
    const options: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', weekday: 'long' };
    return new Intl.DateTimeFormat('zh-CN', options).format(date);
  }

  private getWeekNumber(d: Date): number {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return weekNo;
  }

  private getWeekDateRange(year: number, weekNumber: number): [string, string] {
    const d = new Date(year, 0, 1 + (weekNumber - 1) * 7);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
    const start = new Date(d.setDate(diff));
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const format = (dt: Date) => `${dt.getMonth() + 1}月${dt.getDate()}日`;
    return [format(start), format(end)];
  }

  /**
   * 将日期标准化为当天的零点。
   * @param date 要标准化的日期。
   * @returns 标准化后的新日期对象。
   */
  private normalizeDate(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  private groupFiles(files: FileStat[]): { label: string, files: FileStat[], type: GroupType }[] {
    const now = new Date();
    const today = this.normalizeDate(now);
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000); // 7 days including today
    const oneMonthAgo = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());

    // 使用声明式的方式定义分组规则
    const groupDefinitions: { label: string, type: GroupType, test: (fileDateSource: Date) => boolean, files: FileStat[] }[] = [
      // "是不是今天？"—— 这是"相等"比较，必须用净化后的日期
      { label: '今天', type: 'direct', test: (fileDateSource) => this.normalizeDate(fileDateSource).getTime() === today.getTime(), files: [] },
      { label: '昨天', type: 'direct', test: (fileDateSource) => this.normalizeDate(fileDateSource).getTime() === yesterday.getTime(), files: [] },
      // "是不是在某个范围？"—— 为了逻辑统一和健壮性，所有比较都应基于净化后的日期
      { label: '最近一周', type: 'by-day', test: (fileDateSource) => this.normalizeDate(fileDateSource) >= oneWeekAgo, files: [] },
      { label: '最近一月', type: 'by-week', test: (fileDateSource) => this.normalizeDate(fileDateSource) >= oneMonthAgo, files: [] },
      { label: '更早', type: 'by-week', test: () => true, files: [] }, // 默认捕获所有剩余文件
    ];

    for (const file of files) {
      const fileDateSource = this.getFileDateForGrouping(file);

      for (const group of groupDefinitions) {
        if (group.test(fileDateSource)) {
          group.files.push(file);
          break; // 每个文件只属于第一个匹配的分组
        }
      }
    }

    return groupDefinitions
      .filter(g => g.files.length > 0)
      .map(g => ({ label: g.label, files: g.files, type: g.type }));
  }
}
