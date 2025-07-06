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
