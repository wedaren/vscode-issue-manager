import * as path from 'path';
import * as vscode from 'vscode';
import { getIssueDir } from '../config';

/**
 * 规范化路径（统一分隔符、去除冗余部分）
 */
export function normalizePath(filePath: string): string {
  return path.normalize(filePath).replace(/\\/g, '/');
}

/**
 * 判断路径是否在笔记根目录内
 */
export function isPathInNoteRoot(filePath: string): boolean {
  const issueDir = getIssueDir();
  if (!issueDir) {
    return false;
  }
  
  const normalizedPath = normalizePath(path.resolve(filePath));
  const normalizedRoot = normalizePath(path.resolve(issueDir));
  
  return normalizedPath.startsWith(normalizedRoot + '/') || normalizedPath === normalizedRoot;
}

/**
 * 获取相对于笔记根目录的路径
 */
export function getRelativeToNoteRoot(filePath: string): string | undefined {
  const issueDir = getIssueDir();
  if (!issueDir) {
    return undefined;
  }
  
  const normalizedPath = normalizePath(path.resolve(filePath));
  const normalizedRoot = normalizePath(path.resolve(issueDir));
  
  if (normalizedPath.startsWith(normalizedRoot + '/')) {
    return normalizedPath.substring(normalizedRoot.length + 1);
  } else if (normalizedPath === normalizedRoot) {
    return '';
  }
  
  return undefined;
}

/**
 * 从相对路径获取绝对路径
 */
export function resolveFromNoteRoot(relativePath: string): string | undefined {
  const issueDir = getIssueDir();
  if (!issueDir) {
    return undefined;
  }
  
  return normalizePath(path.join(issueDir, relativePath));
}

/**
 * 简单的前缀匹配
 * @param pattern 模式（可以是路径前缀）
 * @param filePath 要匹配的文件路径
 */
export function matchPrefix(pattern: string, filePath: string): boolean {
  const normalizedPattern = normalizePath(pattern);
  const normalizedPath = normalizePath(filePath);
  
  return normalizedPath.startsWith(normalizedPattern);
}

/**
 * 简单的 glob 匹配（支持 * 和 **）
 * @param pattern glob 模式
 * @param filePath 要匹配的文件路径
 */
export function matchGlob(pattern: string, filePath: string): boolean {
  const normalizedPattern = normalizePath(pattern);
  const normalizedPath = normalizePath(filePath);
  
  // 将 glob 模式转换为正则表达式
  let regexPattern = normalizedPattern
    .replace(/\./g, '\\.') // 转义点号
    .replace(/\*\*/g, '<<DOUBLESTAR>>') // 临时替换 **
    .replace(/\*/g, '[^/]*') // * 匹配除 / 外的任意字符
    .replace(/<<DOUBLESTAR>>/g, '.*'); // ** 匹配任意字符包括 /
  
  // 确保模式匹配整个路径
  regexPattern = '^' + regexPattern + '$';
  
  const regex = new RegExp(regexPattern);
  return regex.test(normalizedPath);
}

/**
 * 匹配路径（支持前缀和 glob）
 */
export function matchPattern(pattern: string, filePath: string): boolean {
  // 如果包含 * 则使用 glob 匹配，否则使用前缀匹配
  if (pattern.includes('*')) {
    return matchGlob(pattern, filePath);
  } else {
    return matchPrefix(pattern, filePath);
  }
}

/**
 * 验证路径安全性
 * @param filePath 要验证的路径
 * @param requireInNoteRoot 是否要求在笔记根目录内
 */
export async function validatePath(
  filePath: string,
  requireInNoteRoot: boolean = true
): Promise<{ valid: boolean; message?: string }> {
  // 检查是否为绝对路径
  if (!path.isAbsolute(filePath)) {
    return { valid: false, message: '路径必须是绝对路径' };
  }
  
  // 如果要求在笔记根目录内
  if (requireInNoteRoot) {
    if (!isPathInNoteRoot(filePath)) {
      return { valid: false, message: '路径必须在笔记根目录内' };
    }
  }
  
  // 检查路径是否存在
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
    return { valid: true };
  } catch {
    // 路径不存在也是有效的（可能是即将创建的文件）
    return { valid: true };
  }
}

/**
 * 获取工作区根路径
 */
export function getWorkspaceRoot(): string | undefined {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return undefined;
  }
  return workspaceFolders[0].uri.fsPath;
}
