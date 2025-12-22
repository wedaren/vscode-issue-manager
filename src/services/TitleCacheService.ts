import * as path from 'path';
import * as vscode from 'vscode';
import { readTitleCacheJson, writeTitleCacheJson, readTree } from '../data/treeManager';
import { getIssueDir, getTitleCacheRebuildIntervalHours } from '../config';
import { ensureIssueManagerDir, getRelativePathToIssueDir } from '../utils/fileUtils';
import { Logger } from '../core/utils/Logger';
import { getMarkdownIssues } from '../data/markdownIssues';

/**
 * 标题缓存服务：从 titleCache.json 读取并缓存 { [relativeFilePath]: title }
 * - 提供预加载与批量获取标题的方法
 * - 如果缓存未命中，避免触发 I/O，回退为文件名（不含扩展名）
 */
export class TitleCacheService {
  private static instance: TitleCacheService | null = null;
  private cache: Record<string, string> = {};
  private loaded = false;
  // 可选的内存缓存：nodeId -> relativeFilePath
  private nodeIdToFilePath: Map<string, string> = new Map();
  private readonly logger: Logger;  

  private constructor() {
    this.logger = Logger.getInstance();
  }


  static getInstance(): TitleCacheService {
    if (!TitleCacheService.instance) {
      TitleCacheService.instance = new TitleCacheService();
    }
    return TitleCacheService.instance;
  }

  /** 预加载缓存（幂等） */
  async preload(): Promise<void> {
    if (this.loaded) { return; }
    try {
      // 如果缓存文件过期（超过 24 小时未更新），则重建 titleCache
      await this.rebuildIfStale();

      // 加载（可能是重建后的）titleCache.json
      this.cache = await readTitleCacheJson();
      // 同步构建 nodeId 缓存，避免后续多次读取 tree.json
      await this.buildNodeIdCache();
      this.loaded = true;
    } catch (e) {  
      // 读取失败时保持空缓存，避免影响主流程
      this.logger.error('预加载标题缓存失败:', e);  
      this.loaded = true;
    }
  }

  /** 清空与重载缓存 */
  async reload(): Promise<void> {
    this.loaded = false;
    await this.preload();
  }

  /**
   * 获取相对路径的标题（仅命中缓存，不触发 I/O）。未命中返回 undefined。
   */
  async get(relativeFilePath: string): Promise<string | undefined> {
    await this.preload();
    return this.cache[relativeFilePath];
  }

  /**
   * 批量获取标题，未命中缓存则回退为文件名（不含扩展名），避免 I/O。
   */
  async getMany(relativeFilePaths: string[]): Promise<string[]> {
    await this.preload();
    return relativeFilePaths.map(p => this.cache[p] ?? path.basename(p, '.md'));
  }

  /**
   * 当 titleCache.json 不存在或 mtime 超过 24 小时，则全量遍历 issueDir 下的 Markdown 文件重建缓存。
   * 非致命：任何错误都会被吞掉并在控制台记录，避免影响主流程启动。
   */
  private async rebuildIfStale(): Promise<void> {
    try {
      const issueDir = getIssueDir();
      if (!issueDir) { return; }

      const cacheUri = vscode.Uri.file(path.join(issueDir, '.issueManager', 'titleCache.json'));
      let needRebuild = false;

      try {
        const stat = await vscode.workspace.fs.stat(cacheUri);
        const mtime = typeof stat.mtime === 'number' ? stat.mtime : Date.now();
        const ageMs = Date.now() - mtime;
        const hours = getTitleCacheRebuildIntervalHours();
        if (hours > 0) {
          const intervalMs = hours * 60 * 60 * 1000;
          if (ageMs > intervalMs) {
            needRebuild = true;
          }
        }
      } catch {
        // 文件不存在，需重建
        needRebuild = true;
      }

      if (!needRebuild) { return; }

      await this.buildAndWriteCache();
    } catch (err) {
      this.logger.warn('[TitleCacheService] 重建标题缓存失败，继续使用现有缓存：', err);
    }
  }

  /**
   * 强制重建 titleCache.json，并将结果加载入内存缓存。
   * 可用于命令触发的手动重建场景。
   */
  public async forceRebuild(): Promise<void> {
    try {
      const issueDir = getIssueDir();
      if (!issueDir) { return; }
      await this.buildAndWriteCache();
      // 写入完成后，加载到内存
      this.cache = await readTitleCacheJson();
      await this.buildNodeIdCache();
      this.loaded = true;
    } catch (err) {
      this.logger.warn('[TitleCacheService] 强制重建标题缓存失败：', err);
    }
  }

  /**
   * 获取 nodeId 对应的相对文件路径（如果存在）。
   * 优先使用内存缓存；未命中时会尝试读取 tree.json 并回填缓存。
   */
  public async getFilePathByNodeId(nodeId: string): Promise<string | undefined> {
    if (!nodeId) { return undefined; }
    if (!this.loaded) { await this.preload(); }

    const cached = this.nodeIdToFilePath.get(nodeId);
    if (cached) { return cached; }

    // 回退到读取 tree.json 并回填缓存
    try {
      const tree = await readTree();
      if (!tree) { return undefined; }

      const walk = (nodes: any[]): string | undefined => {
        for (const node of nodes) {
          if (node.id === nodeId && node.filePath) {
            return node.filePath;
          }
          if (node.children && node.children.length > 0) {
            const found = walk(node.children);
            if (found) { return found; }
          }
        }
        return undefined;
      };

      const fp = walk(tree.rootNodes || []);
      if (fp) { this.nodeIdToFilePath.set(nodeId, fp); }
      return fp;
    } catch (err) {
      this.logger.error('[TitleCacheService] 通过 nodeId 查找 filePath 失败：', err);
      return undefined;
    }
  }

  /**
   * 构建 nodeId -> filePath 的内存缓存
   */
  private async buildNodeIdCache(): Promise<void> {
    try {
      const tree = await readTree();
      if (!tree) { this.nodeIdToFilePath.clear(); return; }

      const map = new Map<string, string>();
      const walk = (nodes: any[]) => {
        for (const node of nodes) {
          if (node && node.id && node.filePath) {
            map.set(node.id, node.filePath);
          }
          if (node.children && node.children.length > 0) {
            walk(node.children);
          }
        }
      };
      walk(tree.rootNodes || []);
      this.nodeIdToFilePath = map;
    } catch (err) {
      this.logger.warn('[TitleCacheService] 构建 nodeId 缓存失败：', err);
      this.nodeIdToFilePath.clear();
    }
  }

  /**
   * 扫描所有 Markdown 并构建 {relativePath: title}，然后写回 titleCache.json。
   * 内部方法：包含并发控制与错误吞吐。
   */
  private async buildAndWriteCache(): Promise<void> {
    const issues = await getMarkdownIssues();  
    const obj = issues.reduce((acc, issue) => {  
      const relPath = getRelativePathToIssueDir(issue.uri.fsPath);  
      if (relPath) {  
        acc[relPath] = issue.title;  
      }  
      return acc;  
    }, {} as Record<string, string>);  

    // 确保目录存在并写回  
    await ensureIssueManagerDir();  
    await writeTitleCacheJson(obj);  
  }
}
