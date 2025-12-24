import * as vscode from "vscode";
import * as path from "path";
import { getFrontmatter, FrontmatterData } from "../utils/markdown";
import { getIssueDir } from "../config";
import { Logger } from "../core/utils/Logger";

type CacheEntry = { data: FrontmatterData | null; mtime: number };

/**
 * Frontmatter 缓存：旁路缓存（Cache-Aside）实现。
 * 按 URI 缓存 `FrontmatterData | null`，并基于 `fs.stat().mtime` 验证有效性。
 */
export class FrontmatterCache {
  private cache = new Map<string, CacheEntry>();
  private _onDidUpdate = new vscode.EventEmitter<void>();
  private _debounceMs = 200;
  private _debounceTimer?: ReturnType<typeof setTimeout>;

  private scheduleOnDidUpdate(): void {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
    this._debounceTimer = setTimeout(() => {
      try {
        this._onDidUpdate.fire();
      } catch (e) {
        Logger.getInstance().warn(
          "onDidUpdate event listener threw an error",
          e
        );
      }
      this._debounceTimer = undefined;
    }, this._debounceMs);
  }

  private _resolveUri(uriOrPath: vscode.Uri | string): vscode.Uri | undefined {
    if (uriOrPath instanceof vscode.Uri) {
      return uriOrPath;
    }

    if (path.isAbsolute(uriOrPath)) {
      return vscode.Uri.file(uriOrPath);
    }

    const issueDir = getIssueDir();
    if (!issueDir) {
      Logger.getInstance().warn(
        "[FrontmatterCache] issueDir is not configured, cannot resolve relative path",
        { path: uriOrPath }
      );
      return undefined;
    }
    return vscode.Uri.file(path.join(issueDir, uriOrPath));
  }

  /** 当缓存条目被写入或更新时触发（防抖触发） */
  public readonly onDidUpdate: vscode.Event<void> = this._onDidUpdate.event;

  /** 获取指定文件的 frontmatter（缓存旁路） */
  public async get(
    uriOrPath: vscode.Uri | string
  ): Promise<FrontmatterData | null> {
    const uri = this._resolveUri(uriOrPath);
    if (!uri) {
      return null;
    }

    const key = uri.toString();

    try {
      const stat = await vscode.workspace.fs.stat(uri);
      const mtime = stat.mtime;

      const cached = this.cache.get(key);
      if (cached && cached.mtime === mtime) {
        return cached.data;
      }

      const data = await getFrontmatter(uri);
      this.cache.set(key, { data, mtime });
      this.scheduleOnDidUpdate();
      Logger.getInstance().debug("[FrontmatterCache] set", {
        uri: key,
        size: this.cache.size,
      });
      return data;
    } catch (err) {
      this.cache.delete(key);
      Logger.getInstance().debug(
        "[FrontmatterCache] stat failed, entry removed",
        { uri: key, size: this.cache.size }
      );
      return null;
    }
  }

  public invalidate(uriOrPath: vscode.Uri | string): void {
    const uri = this._resolveUri(uriOrPath);
    if (!uri) {
      return;
    }
    const key = uri.toString();
    this.cache.delete(key);
    Logger.getInstance().debug("[FrontmatterCache] invalidate", {
      uri: key,
      size: this.cache.size,
    });
  }

  public clear(): void {
    this.cache.clear();
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = undefined;
    }
    Logger.getInstance().debug("[FrontmatterCache] clear", {
      size: this.cache.size,
    });
  }

  get size(): number {
    return this.cache.size;
  }
}

export const frontmatterCache = new FrontmatterCache();
