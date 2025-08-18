import path from 'path';
import * as vscode from 'vscode';


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


export async function getCtimeOrNow(fileUri: vscode.Uri): Promise<Date> {
  const filename = path.basename(fileUri.fsPath);
  const creationTime = parseFileNameTimestamp(filename);
  if (creationTime) {
    return creationTime;
  }
  try {
    const stat = await vscode.workspace.fs.stat(fileUri);
    return new Date(stat.ctime);
  } catch (error) {
    console.error(`获取文件 ${fileUri.fsPath} 的创建时间失败:`, error);
    return new Date(); // 如果无法获取创建时间，返回当前时间
  }
}

export async function getMtimeOrNow(fileUri: vscode.Uri): Promise<Date> {
  try {
    const stat = await vscode.workspace.fs.stat(fileUri);
    return new Date(stat.mtime);
  } catch (error) {
    console.error(`获取文件 ${fileUri.fsPath} 的修改时间失败:`, error);
    return new Date(); // 如果无法获取修改时间，返回当前时间
  }
}

/**
 * 获取工作区的 .issueManager 目录路径
 * @returns .issueManager 目录的 Uri，如果没有工作区则返回 null
 */
export function getIssueManagerDir(): vscode.Uri | null {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return null;
  }
  return vscode.Uri.joinPath(workspaceFolder.uri, '.issueManager');
}

/**
 * 确保 .issueManager 目录存在，如果不存在则创建
 * @returns 创建成功返回目录 Uri，失败返回 null
 */
export async function ensureIssueManagerDir(): Promise<vscode.Uri | null> {
  const issueManagerDir = getIssueManagerDir();
  if (!issueManagerDir) {
    console.error('没有找到工作区，无法创建 .issueManager 目录');
    return null;
  }

  try {
    // 检查目录是否存在
    await vscode.workspace.fs.stat(issueManagerDir);
    return issueManagerDir;
  } catch (error) {
    // 目录不存在，创建它
    try {
      await vscode.workspace.fs.createDirectory(issueManagerDir);
      console.log(`创建 .issueManager 目录: ${issueManagerDir.fsPath}`);
      return issueManagerDir;
    } catch (createError) {
      console.error(`创建 .issueManager 目录失败:`, createError);
      return null;
    }
  }
}

/**
 * 获取 RSS 历史记录文件的路径
 * @returns RSS历史记录文件的 Uri，如果目录不存在则返回 null
 */
export function getRSSHistoryFilePath(): vscode.Uri | null {
  const issueManagerDir = getIssueManagerDir();
  if (!issueManagerDir) {
    return null;
  }
  return vscode.Uri.joinPath(issueManagerDir, 'rss-history.json');
}

/**
 * 读取 JSON 文件内容
 * @param fileUri 文件路径
 * @returns 解析后的 JSON 对象，失败返回 null
 */
export async function readJSONFile<T = any>(fileUri: vscode.Uri): Promise<T | null> {
  try {
    const fileData = await vscode.workspace.fs.readFile(fileUri);
    const content = Buffer.from(fileData).toString('utf8');
    return JSON.parse(content) as T;
  } catch (error) {
    console.error(`读取 JSON 文件失败 ${fileUri.fsPath}:`, error);
    return null;
  }
}

/**
 * 写入 JSON 文件
 * @param fileUri 文件路径
 * @param data 要写入的数据
 * @returns 写入成功返回 true，失败返回 false
 */
export async function writeJSONFile(fileUri: vscode.Uri, data: any): Promise<boolean> {
  try {
    const content = JSON.stringify(data, null, 2);
    const uint8Array = Buffer.from(content, 'utf8');
    await vscode.workspace.fs.writeFile(fileUri, uint8Array);
    return true;
  } catch (error) {
    console.error(`写入 JSON 文件失败 ${fileUri.fsPath}:`, error);
    return false;
  }
}
