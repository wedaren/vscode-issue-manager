/**
 * 解析文件名中的时间戳，兼容 YYYYMMDD-HHmmss 和 YYYYMMDD-HHmmss-SSS
 * @param fileName 文件名字符串
 * @returns {Date|null} 解析成功返回 Date，否则返回 null
 */
export function parseFileNameTimestamp(fileName: string): Date | null {
  const timeRegex = /(\d{8}-\d{6})(?:-(\d{3}))?/;
  const match = fileName.match(timeRegex);
  if (match) {
    const base = match[1];
    const ms = match[2] || '000';
    // YYYYMMDD-HHmmss
    const year = parseInt(base.slice(0, 4));
    const month = parseInt(base.slice(4, 6)) - 1;
    const day = parseInt(base.slice(6, 8));
    const hour = parseInt(base.slice(9, 11));
    const min = parseInt(base.slice(11, 13));
    const sec = parseInt(base.slice(13, 15));
    const msInt = parseInt(ms);
    return new Date(year, month, day, hour, min, sec, msInt);
  }
  return null;
}
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
