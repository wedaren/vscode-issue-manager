import * as vscode from 'vscode';
import { getIssueDir } from '../config';
import { debounce } from '../utils/debounce';
import { getUri, isIssueMarkdownFile } from '../utils/fileUtils';
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
 * 文件访问统计数据文件结构
 */
interface FileAccessData {
  version: string;
  accessStats: { [filePath: string]: FileAccessStats };
}

const ACCESS_STATS_VERSION = '1.0.0';
const ACCESS_STATS_FILE = 'file-access-stats.json';

/**
 * 获取文件访问统计数据文件的绝对路径
 */
async function getAccessStatsPath(): Promise<string | null> {
  const issueDir = getIssueDir();
  if (!issueDir) {
    return null;
  }
  
  // 确保 .issueManager 目录存在
  const dataDir = path.join(issueDir, '.issueManager');
  const dataDirUri = getUri(dataDir);
  
  try {
    await vscode.workspace.fs.stat(dataDirUri);
  } catch {
    // 如果 stat 失败，假定目录不存在并尝试创建它
    try {
      await vscode.workspace.fs.createDirectory(dataDirUri);
    } catch (e) {
      console.error('创建 .issueManager 目录失败:', e);
      vscode.window.showErrorMessage('无法初始化文件跟踪服务，请检查问题目录的写入权限。');
      return null;
    }
  }
  
  return path.join(dataDir, ACCESS_STATS_FILE);
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
  private debouncedSaveStats = debounce(() => {
    this.saveStats().catch(error => {
      console.error('防抖保存文件访问统计数据失败:', error);
    });
  }, 2000);

  private constructor(context: vscode.ExtensionContext) {
    this.context = context;
    // 使用IIFE处理异步初始化，避免阻塞构造函数，同时保证执行顺序和错误捕获
    (async () => {
      try {
        await this.migrateFromWorkspaceState(); // 迁移旧数据
        await this.loadStats(); // 加载统计数据
      } catch (error) {
        console.error('FileAccessTracker 初始化失败:', error);
        // 考虑向用户显示一个错误消息
        vscode.window.showErrorMessage('文件访问跟踪服务初始化失败。');
      }
    })();
    this.setupEventListeners();
  }

  /**
   * 从旧的 workspaceState 迁移数据到新的文件存储
   */
  private async migrateFromWorkspaceState(): Promise<void> {
    try {
      const oldData = this.context.workspaceState.get<{ [filePath: string]: FileAccessStats }>('issueManager.fileAccessStats');
      
      if (oldData && Object.keys(oldData).length > 0) {
        console.log('检测到旧的文件访问统计数据，开始迁移...');
        
        // 将旧数据复制到新结构
        this.accessStats = { ...oldData };
        
        // 保存到新的文件存储
        await this.saveStats();
        
        // 清理旧的 workspaceState 数据
        await this.context.workspaceState.update('issueManager.fileAccessStats', undefined);
        
        console.log('文件访问统计数据迁移完成');
      }
    } catch (error) {
      console.error('迁移文件访问统计数据失败:', error);
    }
  }

  /**
   * 获取单例实例
   */
  public static getInstance(context?: vscode.ExtensionContext): FileAccessTracker {
    if (!FileAccessTracker.instance && context) {
      FileAccessTracker.instance = new FileAccessTracker(context);
    } else if (!FileAccessTracker.instance) {
      throw new Error('FileAccessTracker 必须首先使用 context 进行初始化');
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
   * 从 .issueManager/file-access-stats.json 文件加载访问统计数据
   */
  private async loadStats(): Promise<void> {
    try {
      const filePath = await getAccessStatsPath();
      if (!filePath) {
        console.warn('无法获取文件访问统计数据路径，问题目录未配置');
        return;
      }
      
      const fileUri = getUri(filePath);
      const raw = await vscode.workspace.fs.readFile(fileUri);
      const data: FileAccessData = JSON.parse(raw.toString());
      
      // 基本校验
      if (data && data.accessStats && typeof data.version === 'string') {
        this.accessStats = data.accessStats;
      } else {
        console.warn('文件访问统计数据结构不合法，使用默认数据');
        this.accessStats = {};
      }
    } catch (e) {
      // 文件不存在或解析失败，使用空数据
      console.log('文件访问统计数据文件不存在或解析失败，使用默认数据');
      this.accessStats = {};
    }
  }

  /**
   * 保存访问统计数据到 .issueManager/file-access-stats.json 文件
   */
  private async saveStats(): Promise<void> {
    try {
      const filePath = await getAccessStatsPath();
      if (!filePath) {
        console.error('无法保存文件访问统计数据，问题目录未配置');
        return;
      }
      
      const data: FileAccessData = {
        version: ACCESS_STATS_VERSION,
        accessStats: this.accessStats
      };
      
      const content = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
      await vscode.workspace.fs.writeFile(getUri(filePath), content);
    } catch (error) {
      console.error('保存文件访问统计数据失败:', error);
    }
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
    if (!editor?.document) {
      return false;
    }

    return isIssueMarkdownFile(editor.document.uri);
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
      console.warn('清理文件访问统计信息失败:', error);
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
      await this.saveStats();
    }
  }

  /**
   * 重置所有统计数据（用于测试或重新开始）
   */
  public async resetStats(): Promise<void> {
    this.accessStats = {};
    await this.saveStats();
  }

  /**
   * 销毁服务，清理资源
   */
  public dispose(): void {
    // 在销毁前立即保存未保存的数据
    this.saveStats().catch(error => {
      console.error('销毁时保存文件访问统计数据失败:', error);
    });
    
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
    FileAccessTracker.instance = null;
  }
}
