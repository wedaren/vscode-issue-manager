import * as vscode from "vscode";
import * as path from "path";
import { extractTitleFromContent } from "../utils/markdown";
import { getIssueDir } from "../config";
import { Logger } from "../core/utils/Logger";
import { readTree, findNodeById } from "./issueTreeManager";
import { frontmatterCache } from "./frontmatterCache";

type CacheEntry = { title: string; mtime: number };

/**
 * 标题缓存类：实现旁路缓存（Cache-Aside）逻辑。
 * - `get(uri)`：读取缓存，若失效则从磁盘读取并更新缓存。
 * - `invalidate(uri)`：使指定文件的缓存失效。
 * - `clear()`：清空全部缓存。
 */
export class TitleCache {
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
      } catch {}
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
        "[TitleCache] issueDir is not configured, cannot resolve relative path",
        { path: uriOrPath }
      );
      return undefined;
    }
    return vscode.Uri.file(path.join(issueDir, uriOrPath));
  }
  /** 当缓存条目被写入或更新时触发（仅 set/update） */
  public readonly onDidUpdate: vscode.Event<void> = this._onDidUpdate.event;

  async getByIssueId(issueId: string): Promise<string> {
    // TODO 优化
    const tree = await readTree();
    const { node } = findNodeById(tree.rootNodes, issueId) || {}; // 确保 tree 已加载
    if (node?.filePath) {
      return this.get(node.filePath);
    } else {
      return `[Unknown Issue: ${issueId}]`;
    }
  }

  /**
   * 异步地获取给定 Markdown 文件的标题。
   * 优先从 frontmatter 的 `issue_title` 字段读取，其次使用第一个一级标题 (`# `)，最后回退到文件名（不含扩展名）。
   * @param fileUri 文件的 URI。
   * @returns 解析出的标题。
   */
   async getTitle(fileUri: vscode.Uri): Promise<string> {
    try {
      // 1) 优先从 frontmatter 中读取 issue_title
      const fm = await frontmatterCache.get(fileUri);
      if (fm) {
        const fmAny = fm as Record<string, unknown>;
        const fromFm =
          typeof fmAny.issue_title === "string" && fmAny.issue_title.trim();
        if (fromFm) {
          return String(fromFm);
        }
      }

      // 2) 回退到 H1 标题（需要读取文件内容）
      const contentBytes = await vscode.workspace.fs.readFile(fileUri);
      const content = Buffer.from(contentBytes).toString("utf-8");
      const titleFromContent = extractTitleFromContent(content);
      if (titleFromContent) {
        return titleFromContent;
      }
    } catch (error) {
      console.error(`读取文件时出错 ${fileUri.fsPath}:`, error);
    }
    // 3) 使用文件名作为后备
    return path.basename(fileUri.fsPath, ".md");
  }

  async get(uriOrPath: vscode.Uri | string): Promise<string> {
    const uri = this._resolveUri(uriOrPath);
    if (!uri) {
      return path.basename(
        typeof uriOrPath === "string" ? uriOrPath : uriOrPath.fsPath,
        ".md"
      );
    }

    const key = uri.toString();

    try {
      const stat = await vscode.workspace.fs.stat(uri);
      const mtime = stat.mtime;

      const cached = this.cache.get(key);
      if (cached && cached.mtime === mtime) {
        return cached.title;
      }

      const title = await this.getTitle(uri);
      if (title === cached?.title) {
        // 标题未变更，仅更新 mtime
        this.cache.set(key, { title, mtime });
        return title;
      }
      this.cache.set(key, { title, mtime });
      // 通知监听者：条目已写入/更新（防抖触发）
      this.scheduleOnDidUpdate();
      Logger.getInstance().debug("[TitleCache] set", {
        uri: key,
        size: this.cache.size,
      });
      return title;
    } catch (err) {
      // 若无法 stat（例如文件被删除或 IO 错误），回退到直接读取标题
      return await this.getTitle(uri);
    }
  }

  invalidate(uriOrPath: vscode.Uri | string): void {
    const uri = this._resolveUri(uriOrPath);
    if (!uri) {
      return;
    }

    const key = uri.toString();
    this.cache.delete(key);
    Logger.getInstance().debug("[TitleCache] invalidate", {
      uri: key,
      size: this.cache.size,
    });
  }

  clear(): void {
    this.cache.clear();
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = undefined;
    }
    Logger.getInstance().debug("[TitleCache] clear", { size: this.cache.size });
  }

  /** 返回当前缓存条目数 */
  get size(): number {
    return this.cache.size;
  }
}

export const titleCache = new TitleCache();
