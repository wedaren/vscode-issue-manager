import * as vscode from 'vscode';
import * as path from 'path';
import { getIssueDir } from '../config';
import { getTitle } from '../utils/markdown';

type ViewMode = 'list' | 'group';

interface FileStat {
  file: string;
  filePath: string;
  mtime: Date;
  ctime: Date;
}

class GroupTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly files: FileStat[],
    public readonly type: 'day' | 'week' | 'month' | 'top'
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
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

  private viewMode: ViewMode = 'list'; // 默认为列表模式
  private sortOrder: 'mtime' | 'ctime' = 'ctime'; // 默认为创建时间

  constructor(private context: vscode.ExtensionContext) {

    this.context.subscriptions.push(vscode.commands.registerCommand('issueManager.setRecentIssuesViewMode.group', () => {
      this.setViewMode('group');
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

    this.setSortContext();
    this.setViewModeContext();

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
  setSortOrder(order: 'mtime' | 'ctime'): void {
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
    this._onDidChangeTreeData.fire();
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
      // Day groups directly show files
      if (element.type === 'day') {
        return Promise.all(element.files.map(fileStat => this.createFileTreeItem(fileStat)));
      }

      // Top-level groups that don't have subgroups
      if (element.label === '今天' || element.label === '昨天' || element.label === '更早') {
        return Promise.all(element.files.map(fileStat => this.createFileTreeItem(fileStat)));
      }

      // 'Recent Week' group gets subdivided by day
      if (element.label === '最近一周') {
        return this.createDaySubgroups(element.files);
      }

      // 'Recent Month' group gets subdivided by week
      if (element.label === '最近一月') {
        const filesByWeek = new Map<string, FileStat[]>();
        const now = new Date();
        
        const startOfThisWeek = this.getStartOfWeek(now);
        const startOfLastWeek = this.getStartOfWeek(new Date(now.setDate(now.getDate() - 7)));

        for (const file of element.files) {
          const fileDate = this.sortOrder === 'mtime' ? file.mtime : file.ctime;
          let weekLabel = ``;

          if (fileDate >= startOfThisWeek) {
            weekLabel = '本周';
          } else if (fileDate >= startOfLastWeek) {
            weekLabel = '上周';
          } else {
            const fileWeekNumber = this.getWeekNumber(fileDate);
            const [start, end] = this.getWeekDateRange(fileDate.getFullYear(), fileWeekNumber);
            weekLabel = `第 ${fileWeekNumber} 周 (${start} - ${end})`;
          }

          if (!filesByWeek.has(weekLabel)) {
            filesByWeek.set(weekLabel, []);
          }
          filesByWeek.get(weekLabel)!.push(file);
        }

        const weekGroups = Array.from(filesByWeek.entries()).map(([label, weekFiles]) => {
          return new GroupTreeItem(label, weekFiles, 'week');
        });
        return Promise.resolve(weekGroups);
      }

      // Week groups get subdivided by day
      if (element.type === 'week') {
        return this.createDaySubgroups(element.files);
      }

      return Promise.resolve([]);
    }

    const issueDir = getIssueDir();
    if (!issueDir) {
      return [];
    }

    // 使用 VS Code 的文件系统 API 获取 .md 文件列表，兼容多平台和虚拟文件系统
    const files: string[] = [];
    const dirUri = vscode.Uri.file(issueDir);
    for (const [name, type] of await vscode.workspace.fs.readDirectory(dirUri)) {
      if (type === vscode.FileType.File && name.endsWith('.md')) {
        files.push(name);
      }
    }
    console.log(`Found ${files.length} markdown files in ${issueDir}`);
    const fileStats: FileStat[] = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(issueDir, file);
        // VS Code 推荐使用 workspace.fs.stat 以兼容虚拟文件系统
        const stats = await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
        return { file, filePath, mtime: new Date(stats.mtime), ctime: new Date(stats.ctime) };
      })
    );

    fileStats.sort((a, b) => {
      const timeA = this.sortOrder === 'mtime' ? a.mtime.getTime() : a.ctime.getTime();
      const timeB = this.sortOrder === 'mtime' ? b.mtime.getTime() : b.ctime.getTime();
      return timeB - timeA;
    });

    if (this.viewMode === 'list') {
      return Promise.all(fileStats.map(fileStat => this.createFileTreeItem(fileStat)));
    }

    // Group mode
    const groups = this.groupFiles(fileStats);
    return groups.map(group => new GroupTreeItem(group.label, group.files, 'top'));
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

  private async createDaySubgroups(files: FileStat[]): Promise<GroupTreeItem[]> {
    const filesByDay = new Map<string, FileStat[]>();
    for (const file of files) {
      const fileDate = this.sortOrder === 'mtime' ? file.mtime : file.ctime;
      const dayKey = this.formatDateWithWeekday(fileDate);
      if (!filesByDay.has(dayKey)) {
        filesByDay.set(dayKey, []);
      }
      filesByDay.get(dayKey)!.push(file);
    }

    const dayGroups = Array.from(filesByDay.entries()).map(([dayLabel, dayFiles]) => {
      return new GroupTreeItem(dayLabel, dayFiles, 'day');
    });
    return Promise.resolve(dayGroups);
  }

  private async createFileTreeItem(fileStat: FileStat): Promise<vscode.TreeItem> {
    const uri = vscode.Uri.file(fileStat.filePath);
    const title = await getTitle(uri);
    const item = new vscode.TreeItem(title, vscode.TreeItemCollapsibleState.None);
    item.resourceUri = uri;
    item.command = {
      command: 'vscode.open',
      title: 'Open File',
      arguments: [uri],
    };
    item.contextValue = 'issue'; // 用于右键菜单
    item.tooltip = new vscode.MarkdownString(`路径: \`${uri.fsPath}\` \n\n修改时间: ${fileStat.mtime.toLocaleString()}\n\n创建时间: ${fileStat.ctime.toLocaleString()}`);
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

  private groupFiles(files: FileStat[]): { label: string, files: FileStat[] }[] {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000); // 7 days including today
    const oneMonthAgo = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());

    const groups: { [key: string]: FileStat[] } = {
        '今天': [],
        '昨天': [],
        '最近一周': [],
        '最近一月': [],
        '更早': [],
    };

    for (const file of files) {
        const fileDateSource = this.sortOrder === 'mtime' ? file.mtime : file.ctime;
        const fileDate = new Date(fileDateSource.getFullYear(), fileDateSource.getMonth(), fileDateSource.getDate());
        if (fileDate.getTime() === today.getTime()) {
            groups['今天'].push(file);
        } else if (fileDate.getTime() === yesterday.getTime()) {
            groups['昨天'].push(file);
        } else if (fileDateSource >= oneWeekAgo) {
            groups['最近一周'].push(file);
        } else if (fileDateSource >= oneMonthAgo) {
            groups['最近一月'].push(file);
        } else {
            groups['更早'].push(file);
        }
    }

    return Object.entries(groups).map(([label, files]) => ({ label, files }));
  }
}
