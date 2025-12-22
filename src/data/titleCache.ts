import * as vscode from 'vscode';
import * as path from 'path';
import { getTitle } from '../utils/markdown';
import { getIssueDir } from '../config';
import { Logger } from '../core/utils/Logger';


type CacheEntry = { title: string; mtime: number };

/**
 * 标题缓存类：实现旁路缓存（Cache-Aside）逻辑。
 * - `get(uri)`：读取缓存，若失效则从磁盘读取并更新缓存。
 * - `invalidate(uri)`：使指定文件的缓存失效。
 * - `clear()`：清空全部缓存。
 */
export class TitleCache {
  private cache = new Map<string, CacheEntry>();

  async get(uriOrPath: vscode.Uri | string): Promise<string> {
    let uri: vscode.Uri;

    if (typeof uriOrPath === 'string') {
      // 如果是绝对路径则直接使用，否则当作相对于 issueDir 的相对路径
      if (path.isAbsolute(uriOrPath)) {
        uri = vscode.Uri.file(uriOrPath);
      } else {
        const issueDir = getIssueDir();
        if (!issueDir) {
          throw new Error('issueDir is not configured');
        }
        uri = vscode.Uri.file(path.join(issueDir, uriOrPath));
      }
    } else {
      uri = uriOrPath;
    }

    const key = uri.toString();

    try {
      const stat = await vscode.workspace.fs.stat(uri);
      const mtime = stat.mtime;

      const cached = this.cache.get(key);
      if (cached && cached.mtime === mtime) {
        return cached.title;
      }

      const title = await getTitle(uri);
      this.cache.set(key, { title, mtime });
      Logger.getInstance().debug('[TitleCache] set', { uri: key, size: this.cache.size });
      return title;
    } catch (err) {
      // 若无法 stat（例如文件被删除或 IO 错误），回退到直接读取标题
      return await getTitle(uri);
    }
  }

  invalidate(uriOrPath: vscode.Uri | string): void {
    let uri: vscode.Uri;

    if (typeof uriOrPath === 'string') {
      if (path.isAbsolute(uriOrPath)) {
        uri = vscode.Uri.file(uriOrPath);
      } else {
        const issueDir = getIssueDir();
        if (!issueDir) {
          return; // 无法解析相对路径，直接返回
        }
        uri = vscode.Uri.file(path.join(issueDir, uriOrPath));
      }
    } else {
      uri = uriOrPath;
    }

    const key = uri.toString();
    this.cache.delete(key);
    Logger.getInstance().debug('[TitleCache] invalidate', { uri: key, size: this.cache.size });
  }

  clear(): void {
    this.cache.clear();
    Logger.getInstance().debug('[TitleCache] clear', { size: this.cache.size });
  }

  /** 返回当前缓存条目数 */
  size(): number {
    return this.cache.size;
  }
}

export const titleCache = new TitleCache();
