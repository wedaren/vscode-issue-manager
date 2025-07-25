/**
 * 解析文件名中的时间戳，兼容 YYYYMMDD-HHmmss 和 YYYYMMDD-HHmmss-SSS
 * @param fileName 文件名字符串
 * @returns {Date|null} 解析成功返回 Date，否则返回 null
 */
function parseFileNameTimestamp(fileName: string): Date | null {
  // 使用具名捕获组的正则表达式，提升可读性和健壮性
  const timeRegex = /(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-(\d{3}))?/;
  const match = fileName.match(timeRegex);
  if (match) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1; // Date 构造函数中的月份是从 0 开始的
    const day = parseInt(match[3], 10);
    const hour = parseInt(match[4], 10);
    const min = parseInt(match[5], 10);
    const sec = parseInt(match[6], 10);
    const ms = match[7] ? parseInt(match[7], 10) : 0;
    return new Date(year, month, day, hour, min, sec, ms);
  }
  return null;
}
import path from 'path';
import * as vscode from 'vscode';

/**
 * 生成基于时间戳的文件名
 * 格式：YYYYMMDD-HHmmss-SSS.md，兼具可读性和唯一性。
 */
export function generateFileName(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
    
    return `${year}${month}${day}-${hours}${minutes}${seconds}-${milliseconds}.md`;
}

/**
 * 将字符串路径转换为 vscode.Uri 对象。
 * @param fsPath 文件系统路径
 * @returns vscode.Uri 对象
 */
export function getUri(fsPath: string): vscode.Uri {
  return vscode.Uri.file(fsPath);
}


export async function getCtime(fileUri: vscode.Uri): Promise<Date> {
  const filename = path.basename(fileUri.path);
  const creationTime = parseFileNameTimestamp(filename);
  if (creationTime) {
    return creationTime;
  }
  const stat = await vscode.workspace.fs.stat(fileUri);
  if (stat.ctime) {
    return new Date(stat.ctime);
  }
  return new Date(); // 如果无法获取创建时间，返回当前时间
}

export async function getMtime(fileUri: vscode.Uri): Promise<Date> {
  const stat = await vscode.workspace.fs.stat(fileUri);
  if (stat.mtime) {
    return new Date(stat.mtime);
  }
  return new Date(); // 如果无法获取修改时间，返回当前时间
}