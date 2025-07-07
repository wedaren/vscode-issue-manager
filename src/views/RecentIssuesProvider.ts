import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getIssueDir } from '../config';
import { getTitle } from '../utils/markdown';

type ViewMode = 'list' | 'group';

interface FileStat {
  file: string;
  filePath: string;
  mtime: Date;
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

  constructor(private context: vscode.ExtensionContext) {

    this.context.subscriptions.push(vscode.commands.registerCommand('issueManager.toggleRecentIssuesViewMode', () => {
        this.toggleViewMode();
    }));


    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('issueManager.issueDir')) {
        this.refresh();
      }
    });
  }

  /**
   * 切换视图模式（列表/分组）并刷新视图
   */
  toggleViewMode(): void {
    this.viewMode = this.viewMode === 'list' ? 'group' : 'list';
    this.refresh();
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
        const currentWeekNumber = this.getWeekNumber(now);

        for (const file of element.files) {
          const fileWeekNumber = this.getWeekNumber(file.mtime);
          let weekLabel = ``;
          if (fileWeekNumber === currentWeekNumber) {
            weekLabel = '本周';
          } else if (fileWeekNumber === currentWeekNumber - 1) {
            weekLabel = '上周';
          } else {
            const [start, end] = this.getWeekDateRange(file.mtime.getFullYear(), fileWeekNumber);
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

    const files = await fs.promises.readdir(issueDir);
    const mdFiles = files.filter(file => file.endsWith('.md'));

    const fileStats: FileStat[] = await Promise.all(
      mdFiles.map(async (file) => {
        const filePath = path.join(issueDir, file);
        const stats = await fs.promises.stat(filePath);
        return { file, filePath, mtime: stats.mtime };
      })
    );

    fileStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    if (this.viewMode === 'list') {
      return Promise.all(fileStats.map(fileStat => this.createFileTreeItem(fileStat)));
    }

    // Group mode
    const groups = this.groupFiles(fileStats);
    return groups.map(group => new GroupTreeItem(group.label, group.files, 'top'));
  }

  private async createDaySubgroups(files: FileStat[]): Promise<GroupTreeItem[]> {
    const filesByDay = new Map<string, FileStat[]>();
    for (const file of files) {
      const dayKey = this.formatDateWithWeekday(file.mtime);
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
    item.tooltip = new vscode.MarkdownString(`路径: \`${uri.fsPath}\`\\n\\n修改时间: ${fileStat.mtime.toLocaleString()}`);
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
        const fileDate = new Date(file.mtime.getFullYear(), file.mtime.getMonth(), file.mtime.getDate());
        if (fileDate.getTime() === today.getTime()) {
            groups['今天'].push(file);
        } else if (fileDate.getTime() === yesterday.getTime()) {
            groups['昨天'].push(file);
        } else if (file.mtime >= oneWeekAgo) {
            groups['最近一周'].push(file);
        } else if (file.mtime >= oneMonthAgo) {
            groups['最近一月'].push(file);
        } else {
            groups['更早'].push(file);
        }
    }

    return Object.entries(groups)
        .map(([label, files]) => ({ label, files }))
        .filter(group => group.files.length > 0);
  }
}
