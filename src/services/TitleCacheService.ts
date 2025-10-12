import * as path from 'path';
import { readTitleCacheJson } from '../data/treeManager';

/**
 * 标题缓存服务：从 titleCache.json 读取并缓存 { [relativeFilePath]: title }
 * - 提供预加载与批量获取标题的方法
 * - 如果缓存未命中，避免触发 I/O，回退为文件名（不含扩展名）
 */
export class TitleCacheService {
  private static instance: TitleCacheService | null = null;
  private cache: Record<string, string> = {};
  private loaded = false;

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
      this.cache = await readTitleCacheJson();
      this.loaded = true;
    } catch {
      // 读取失败时保持空缓存，避免影响主流程
      this.cache = {};
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
}
