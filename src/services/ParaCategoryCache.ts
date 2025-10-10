import * as vscode from 'vscode';
import * as path from 'path';
import { readParaCategoryMap } from '../data/paraManager';
import { stripFocusedId } from '../data/treeManager';
import { getIssueDir } from '../config';

/**
 * PARA 分类缓存服务
 * 
 * 负责缓存和管理 PARA 分类数据，避免在视图渲染时重复读取文件。
 * 
 * 特性：
 * - 单例模式，全局共享一份缓存
 * - 监听 para.json 文件变化，自动刷新缓存
 * - 提供同步查找方法，自动处理 focused id
 * - 通知订阅者缓存更新
 */
export class ParaCategoryCache {
  private static instance: ParaCategoryCache | null = null;
  
  private categoryMap: Record<string, string> | null = null;
  private fileWatcher: vscode.FileSystemWatcher | null = null;
  private _onDidChangeCache = new vscode.EventEmitter<void>();
  
  /**
   * 缓存更新事件，订阅者可以监听此事件来刷新视图
   */
  public readonly onDidChangeCache = this._onDidChangeCache.event;

  private constructor(private context: vscode.ExtensionContext) {
    this.initialize();
  }

  /**
   * 获取单例实例
   */
  public static getInstance(context: vscode.ExtensionContext): ParaCategoryCache {
    if (!ParaCategoryCache.instance) {
      ParaCategoryCache.instance = new ParaCategoryCache(context);
    }
    return ParaCategoryCache.instance;
  }

  /**
   * 初始化缓存和文件监听器
   */
  private async initialize(): Promise<void> {
    // 初始加载
    await this.refresh();

    // 监听 para.json 文件变化
    this.setupFileWatcher();

    // 监听配置变化（issueDir 改变时重新设置文件监听器）
    this.context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('issueManager.issueDir')) {
          this.setupFileWatcher();
          this.refresh();
        }
      })
    );
  }

  /**
   * 设置文件监听器
   */
  private setupFileWatcher(): void {
    // 清理旧的监听器
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
      this.fileWatcher = null;
    }

    const issueDir = getIssueDir();
    if (!issueDir) {
      return;
    }

    const paraJsonPath = path.join(issueDir, '.issueManager', 'para.json');
    const pattern = new vscode.RelativePattern(path.dirname(paraJsonPath), 'para.json');
    
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);
    
    // 监听文件变化
    this.fileWatcher.onDidChange(() => this.refresh());
    this.fileWatcher.onDidCreate(() => this.refresh());
    this.fileWatcher.onDidDelete(() => this.refresh());

    this.context.subscriptions.push(this.fileWatcher);
  }

  /**
   * 刷新缓存
   */
  public async refresh(): Promise<void> {
    try {
      this.categoryMap = await readParaCategoryMap();
      this._onDidChangeCache.fire();
    } catch (error) {
      console.error('刷新 PARA 分类缓存失败:', error);
      this.categoryMap = {};
    }
  }

  /**
   * 同步查找节点的 PARA 分类
   * 
   * @param nodeId 节点 ID（支持带 focused 后缀的 ID）
   * @returns PARA 分类字符串，如果不在任何分类中则返回 undefined
   */
  public getCategorySync(nodeId: string): string | undefined {
    if (!this.categoryMap) {
      return undefined;
    }

    // 自动处理 focused id，提取真实 id
    const realId = stripFocusedId(nodeId);
    return this.categoryMap[realId];
  }

  /**
   * 构造包含 PARA 元数据的 contextValue。
   *
   * 规则：
   * - 始终保留基础 contextValue，兼容现有相等匹配。
   * - 如果节点已关联 PARA 分类，则附加 `paraAssigned:<category>` 标记。
   * - 如果节点未关联且允许添加到 PARA，则附加 `paraAssignable` 标记。
   *
   * @param nodeId 节点 ID
   * @param baseContextValue 基础 contextValue（如 'issueNode', 'focusedNode'）
   * @returns 包含 PARA 元数据的 contextValue 字符串
   */
  public getContextValueWithParaMetadata(nodeId: string, baseContextValue: string): string {
    const paraCategory = this.getCategorySync(nodeId);
    const segments: string[] = [baseContextValue];

    if (paraCategory) {
      segments.push(`paraAssigned:${paraCategory}`);
    } else if (baseContextValue !== 'focusedNodeFirst') {
      segments.push('paraAssignable');
    }

    const res = segments.join('|')
    return res;
  }

  /**
   * 清理资源
   */
  public dispose(): void {
    this._onDidChangeCache.dispose();
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
    }
    ParaCategoryCache.instance = null;
  }
}
