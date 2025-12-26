import * as vscode from "vscode";
import * as path from "path";
import * as yaml from "js-yaml";
import { getIssueDir } from "../config";
import { Logger } from "../core/utils/Logger";
import { readTree, findNodeById } from "./issueTreeManager";
/**
 * 从 Markdown 文件内容中提取第一个一级标题。
 * @param content 文件内容。
 * @returns 第一个一级标题的文本，如果找不到则返回 undefined。
 */
export function extractTitleFromContent(content: string): string | undefined {
  const match = content.match(/^#\s+(.*)/m);
  return match ? match[1].trim() : undefined;
}

/**
 * Frontmatter 数据结构
 */
export interface FrontmatterData {
  root_file?: string;
  parent_file?: string | null;
  children_files?: string[];
  [key: string]: unknown; // 支持其他字段
}

function isValidObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseFrontmatter(content: string): FrontmatterData | null {
  if (!content.startsWith("---")) {
    return null;
  }
  const lines = content.split(/\r?\n/);
  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      endIndex = i;
      break;
    }
  }
  if (endIndex === -1) {
    return null;
  }
  const yamlContent = lines.slice(1, endIndex).join("\n");
  try {
    const parsed = yaml.load(yamlContent);
    if (isValidObject(parsed)) {
      return parsed as FrontmatterData;
    }
    return null;
  } catch (error) {
    Logger.getInstance().warn("解析 frontmatter 失败", error);
    return null;
  }
}

// `getFrontmatter` 已被内联到 `getIssueMarkdownFrontmatter`，不再导出。

/**
 * 获取问题目录中所有 Markdown 文件;
 * @returns 问题目录中所有 Markdown 文件
 */
async function getAllIssueMarkdownFiles(): Promise<vscode.Uri[]> {
  const issueDir = getIssueDir();
  if (!issueDir) {
    return [];
  }

  const files = await vscode.workspace.findFiles(
    new vscode.RelativePattern(issueDir, "**/*.md"),
    "**/.issueManager/**"
  );
  return files;
}

export type IssueMarkdown = {
  title: string;
  uri: vscode.Uri;
};

/**
 * 获取问题目录中所有 Markdown 文件的标题和 URI。
 * @returns 包含标题和 URI 的对象数组。
 */
export async function getAllIssueMarkdowns(): Promise<IssueMarkdown[]> {
  const files = await getAllIssueMarkdownFiles();
  const issues: IssueMarkdown[] = [];

  for (const file of files) {
    const title = await getIssueMarkdownTitle(file);
    issues.push({ title, uri: file });
  }

  return issues;
}

type CacheEntry = { data: FrontmatterData | null; mtime: number };

const _frontmatterCache = new Map<string, CacheEntry>();

function _resolveUri(uriOrPath: vscode.Uri | string): vscode.Uri | undefined {
  if (uriOrPath instanceof vscode.Uri) {
    return uriOrPath;
  }
  if (path.isAbsolute(uriOrPath)) {
    return vscode.Uri.file(uriOrPath);
  }
  const issueDir = getIssueDir();
  if (!issueDir) {
    Logger.getInstance().warn(
      "[IssueMarkdowns] issueDir is not configured, cannot resolve relative path",
      { path: uriOrPath }
    );
    return undefined;
  }
  return vscode.Uri.file(path.join(issueDir, uriOrPath));
}

/** 获取 Markdown 文件的 frontmatter（带简单 mtime 缓存） */
export async function getIssueMarkdownFrontmatter(
  uriOrPath: vscode.Uri | string
): Promise<FrontmatterData | null> {
  const uri = _resolveUri(uriOrPath);
  if (!uri) {
    return null;
  }
  const key = uri.toString();
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    const mtime = stat.mtime;
    const cached = _frontmatterCache.get(key);
    if (cached && cached.mtime === mtime) {
      return cached.data;
    }
    const contentBytes = await vscode.workspace.fs.readFile(uri);
    const content = Buffer.from(contentBytes).toString("utf-8");
    const data = parseFrontmatter(content);
    _frontmatterCache.set(key, { data, mtime });
    return data;
  } catch (err) {
    _frontmatterCache.delete(key);
    return null;
  }
}

const titleCache = new Map<string, { title: string; mtime: number }>();
export function getIssueMarkdownTitleFromCache(
      uriOrPath: vscode.Uri | string
){
    const uri = _resolveUri(uriOrPath);
    if (!uri) {
      return uriOrPath.toString();
    }
    const key = uri.toString();
    const cached = titleCache.get(key);
    getIssueMarkdownTitle(uri); // 预热标题缓存
    return cached?.title ?? uri.fsPath;
}
/**
 * 从 frontmatter 的 `issue_title` 优先取标题，其次解析 H1，再回退到文件名
 */
export async function getIssueMarkdownTitle(
  uriOrPath: vscode.Uri | string
): Promise<string> {
  const uri = _resolveUri(uriOrPath);
  if (!uri) {
    return path.basename(
      typeof uriOrPath === "string" ? uriOrPath : uriOrPath.fsPath,
      ".md"
    );
  }

  let title: string | undefined;
  const key = uri.toString();
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    const mtime = stat.mtime;
    const cached = titleCache.get(key);
    if (cached && cached.mtime === mtime) {
      return cached.title;
    }

    // 1) 优先从 frontmatter 中读取 issue_title

    const fm = await getIssueMarkdownFrontmatter(uri);
    if (fm) {
      const fmAny = fm as Record<string, unknown>;
      const fromFm =
        typeof fmAny.issue_title === "string" && fmAny.issue_title.trim();
      if (fromFm) {
        title = String(fromFm);
      }
    }
    if (!title) {
      // 2) 回退到 H1 标题（需要读取文件内容）

      const contentBytes = await vscode.workspace.fs.readFile(uri);
      const content = Buffer.from(contentBytes).toString("utf-8");
      const titleFromContent = extractTitleFromContent(content);
      if (titleFromContent) {
        title = titleFromContent;
      }
    }

    title = title ?? path.basename(uri.fsPath, ".md");
  } catch (error) {
    Logger.getInstance().error(`读取文件时出错 ${uri.fsPath}:`, error);
  }
  title = title ?? uri.fsPath;
  if (title !== titleCache.get(key)?.title) {
    titleCache.set(key, { title, mtime: Date.now() });
    scheduleOnDidUpdate();
    Logger.getInstance().debug("[IssueMarkdowns] get and update title", {
      [key]: title,
    });
  }
  return title;
}
const onTitleUpdateEmitter = new vscode.EventEmitter<void>();
let _debounceTimer: ReturnType<typeof setTimeout> | undefined;
const DebounceDelayMillis = 200;

function scheduleOnDidUpdate(): void {
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
  }
  _debounceTimer = setTimeout(() => {
    try {
      onTitleUpdateEmitter.fire();
    } catch {}
    _debounceTimer = undefined;
  }, DebounceDelayMillis);
}

export const onTitleUpdate = onTitleUpdateEmitter.event;
