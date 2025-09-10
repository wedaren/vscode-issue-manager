import * as vscode from 'vscode';
import { getIssueDir } from '../config';
import { debounce } from '../utils/debounce';
import * as path from 'path';
/**
 * 文件访问统计数据接口
 */
export interface FileAccessStats {
  /** 最后查看时间戳 */
  lastViewTime: number;
  /** 查看次数 */
  viewCount: number;
  /** 首次查看时间戳 */
  firstViewTime: number;
  /** 累计阅读时间（毫秒） */
  totalReadTime?: number;
}

/**
 * 文件访问跟踪服务
 * 负责跟踪和统计用户对问题目录下 Markdown 文件的访问行为
 */
export class FileAccessTracker implements vscode.Disposable {
  private static instance: FileAccessTracker | null = null;
  private accessStats: { [filePath: string]: FileAccessStats } = {};
  private context: vscode.ExtensionContext;
  private disposables: vscode.Disposable[] = [];

  /** 防抖保存函数，2秒延迟避免频繁I/O操作 */
  private debouncedSaveStats = debounce(() => this.saveStats(), 2000);

  private constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.loadStats();
    this.setupEventListeners();
  }

  /**
   * 获取单例实例
   */
  public static getInstance(context?: vscode.ExtensionContext): FileAccessTracker {
    if (!FileAccessTracker.instance && context) {
      FileAccessTracker.instance = new FileAccessTracker(context);
    } else if (!FileAccessTracker.instance) {
      throw new Error('FileAccessTracker must be initialized with context first');
    }
    return FileAccessTracker.instance;
  }

  /**
   * 初始化跟踪服务
   */
  public static initialize(context: vscode.ExtensionContext): FileAccessTracker {
    const tracker = FileAccessTracker.getInstance(context);
    context.subscriptions.push(tracker);
    return tracker;
  }

  /**
   * 从扩展状态加载访问统计数据
   */
  private loadStats(): void {
    this.accessStats = this.context.workspaceState.get('issueManager.fileAccessStats', {});
  }

  /**
   * 保存访问统计数据到扩展状态
   */
  private saveStats(): void {
    this.context.workspaceState.update('issueManager.fileAccessStats', this.accessStats);
  }

  /**
   * 设置事件监听器
   */
  private setupEventListeners(): void {
    // 监听文档激活事件
    const activeEditorListener = vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (this.isIssueMarkdownFile(editor)) {
        this.recordFileAccess(editor!.document.fileName);
      }
    });
    this.disposables.push(activeEditorListener);

    // TODO: 将来可以添加更多监听器
    // - 监听文档关闭事件计算阅读时间
    // - 监听文档滚动事件跟踪阅读进度
    // - 监听键盘活动检测活跃阅读
  }

  /**
   * 检查编辑器是否为问题目录下的 Markdown 文件
   */
  private isIssueMarkdownFile(editor: vscode.TextEditor | undefined): boolean {
    if (!editor || !editor.document) {
      return false;
    }

    const document = editor.document;
    const issueDir = getIssueDir();

    return !!(
      issueDir &&
      document.uri.scheme === 'file' &&
      document.fileName.endsWith('.md') &&
      document.fileName.startsWith(issueDir)
    );
  }

  /**
   * 记录文件访问
   */
  public recordFileAccess(filePath: string): void {
    const now = Date.now();
    const existing = this.accessStats[filePath];

    if (existing) {
      // 更新现有记录
      existing.lastViewTime = now;
      existing.viewCount += 1;
    } else {
      // 创建新记录
      this.accessStats[filePath] = {
        lastViewTime: now,
        viewCount: 1,
        firstViewTime: now
      };
    }

    // 使用防抖保存避免频繁I/O操作
    this.debouncedSaveStats();
  }

  /**
   * 获取文件的访问统计
   */
  public getFileAccessStats(filePath: string): FileAccessStats | undefined {
    return this.accessStats[filePath];
  }

  /**
   * 获取文件的最后查看时间
   */
  public getLastViewTime(filePath: string): Date | undefined {
    const stats = this.accessStats[filePath];
    return stats ? new Date(stats.lastViewTime) : undefined;
  }

  /**
   * 获取文件的查看次数
   */
  public getViewCount(filePath: string): number {
    const stats = this.accessStats[filePath];
    return stats ? stats.viewCount : 0;
  }

  /**
   * 获取所有文件的访问统计（用于调试或导出）
   */
  public getAllAccessStats(): { [filePath: string]: FileAccessStats } {
    return { ...this.accessStats };
  }

  /**
   * 清理过期或不存在的文件统计（可选的维护功能）
   */
  public async cleanupStats(): Promise<void> {
    const issueDir = getIssueDir();
    if (!issueDir) {
      return;
    }

    const validFiles = new Set<string>();
    try {
      const dirUri = vscode.Uri.file(issueDir);
      for (const [name, type] of await vscode.workspace.fs.readDirectory(dirUri)) {
        if (type === vscode.FileType.File && name.endsWith('.md')) {
          validFiles.add(path.join(issueDir, name));
        }
      }
    } catch (error) {
      console.warn('Failed to cleanup file access stats:', error);
      return;
    }

    // 移除不存在文件的统计
    let hasChanges = false;
    for (const filePath of Object.keys(this.accessStats)) {
      if (!validFiles.has(filePath)) {
        delete this.accessStats[filePath];
        hasChanges = true;
      }
    }

    if (hasChanges) {
      this.saveStats();
    }
  }

  /**
   * 重置所有统计数据（用于测试或重新开始）
   */
  public resetStats(): void {
    this.accessStats = {};
    this.saveStats();
  }

  /**
   * 销毁服务，清理资源
   */
  public dispose(): void {
    // 在销毁前立即保存未保存的数据
    this.saveStats();
    
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
    FileAccessTracker.instance = null;
  }
}
