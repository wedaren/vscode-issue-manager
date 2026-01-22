import * as vscode from 'vscode';
import * as path from 'path';
import { getIssueDir } from '../config';
import { Logger } from '../core/utils/Logger';

export type IssueMarkdownCacheEntry = {
  mtime: number;
  ctime: number;
  frontmatter?: Record<string, unknown> | null;
  title?: string;
};

const CACHE_DIR_NAME = '.issueManager';
const CACHE_FILE_NAME = 'issueMarkdownCache.json';
const SAVE_DEBOUNCE_MS = 1000;

let _saveTimer: ReturnType<typeof setTimeout> | undefined;

function getCacheFilePath(): string | undefined {
  const issueDir = getIssueDir();
  if (!issueDir) return undefined;
  return path.join(issueDir, CACHE_DIR_NAME, CACHE_FILE_NAME);
}

function getCacheFileUri(): vscode.Uri | undefined {
  const p = getCacheFilePath();
  return p ? vscode.Uri.file(p) : undefined;
}

export async function ensureDirExists(): Promise<void> {
  const issueDir = getIssueDir();
  if (!issueDir) return;
  const dirUri = vscode.Uri.file(path.join(issueDir, CACHE_DIR_NAME));
  try {
    await vscode.workspace.fs.stat(dirUri);
  } catch {
    try {
      await vscode.workspace.fs.createDirectory(dirUri);
    } catch (e) {
      Logger.getInstance().warn('无法创建缓存目录', e);
    }
  }
}

async function writeToDisk(obj: Record<string, IssueMarkdownCacheEntry>): Promise<void> {
  const fileUri = getCacheFileUri();
  if (!fileUri) return;
  try {
    await ensureDirExists();
    const buffer = Buffer.from(JSON.stringify(obj), 'utf8');
    await vscode.workspace.fs.writeFile(fileUri, buffer);
  } catch (e) {
    Logger.getInstance().warn('保存 issue markdown 缓存失败', e);
  }
}

export function save(entries: Record<string, IssueMarkdownCacheEntry>): void {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    void writeToDisk(entries);
    _saveTimer = undefined;
  }, SAVE_DEBOUNCE_MS);
}

export async function load(): Promise<Record<string, IssueMarkdownCacheEntry> | undefined> {
  const fileUri = getCacheFileUri();
  if (!fileUri) return undefined;
  try {
    const bytes = await vscode.workspace.fs.readFile(fileUri);
    const text = Buffer.from(bytes).toString('utf8');
    const obj = JSON.parse(text) as Record<string, IssueMarkdownCacheEntry>;
    return obj;
  } catch (e) {
    return undefined;
  }
}

export async function clear(): Promise<void> {
  const fileUri = getCacheFileUri();
  if (!fileUri) return;
  try {
    await vscode.workspace.fs.delete(fileUri);
  } catch {
    // ignore
  }
}
