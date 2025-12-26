import * as vscode from "vscode";
import { getIssueMarkdownFrontmatter } from "./IssueMarkdowns";

/**
 * 兼容层：保留 `frontmatterCache` API（最小实现），内部委派到 `IssueMarkdowns.getIssueMarkdownFrontmatter`
 * 方便逐步迁移并避免因删除文件导致引用断裂。
 */
export class FrontmatterCache {
  private _emitter = new vscode.EventEmitter<void>();

  public readonly onDidUpdate: vscode.Event<void> = this._emitter.event;

  public async get(uriOrPath: vscode.Uri | string) {
    return getIssueMarkdownFrontmatter(uriOrPath);
  }

  public invalidate(_: vscode.Uri | string): void {
    // noop -- 缓存由 IssueMarkdowns 内部维护
  }

  public clear(): void {
    // noop
  }

  get size(): number {
    return 0;
  }
}

export const frontmatterCache = new FrontmatterCache();
