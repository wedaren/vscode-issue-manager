import path from 'path';
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import { getIssueDir } from '../config';


/**
 * 自动合并 .gitignore，确保 .issueManager/rss-feed-states.json 被忽略
 * 如无规则则自动添加，有则不重复添加，并弹窗通知用户
 */
export async function ensureGitignoreForRSSState(): Promise<void> {
  const issueDir = getIssueDir();
  if (!issueDir) { return; }
  const gitignoreUri = vscode.Uri.joinPath(vscode.Uri.file(issueDir), '.gitignore');
  const ignoreRule = '.issueManager/rss-feed-states.json';
  let updated = false;
  let content = '';
  try {
    const exists = await checkFileExists(gitignoreUri);
    if (exists) {
      content = (await readTextFile(gitignoreUri)) || '';
      if (!content.split(/\r?\n/).some(line => line.trim() === ignoreRule)) {
        content = content.trim() + (content.trim() ? '\n' : '') + ignoreRule + '\n';
        await vscode.workspace.fs.writeFile(gitignoreUri, Buffer.from(content, 'utf8'));
        updated = true;
      }
    } else {
      content = ignoreRule + '\n';
      await vscode.workspace.fs.writeFile(gitignoreUri, Buffer.from(content, 'utf8'));
      updated = true;
    }
  } catch (error) {
    vscode.window.showWarningMessage('自动配置 .gitignore 时发生错误，请手动检查。');
    console.error('自动配置 .gitignore 失败:', error);
  }
}


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
 * 读取文本文件内容
 */
export async function readTextFile(filePath: vscode.Uri): Promise<string | null> {
    try {
        const data = await vscode.workspace.fs.readFile(filePath);
        return new TextDecoder().decode(data);
    } catch (error) {
        console.error('读取文本文件失败:', error);
        return null;
    }
}

/**
 * 检查文件是否存在
 */
export async function checkFileExists(filePath: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(filePath);
        return true;
    } catch {
        return false;
    }
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
  const issueDir = getIssueDir();
  if (!issueDir) {
    return null;
  }
  return vscode.Uri.joinPath(vscode.Uri.file(issueDir), '.issueManager');
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
 * 获取指定订阅源的历史记录文件路径（Git友好的分离存储）
 * @param feedId 订阅源ID
 * @returns 订阅源历史记录文件的 Uri，如果目录不存在则返回 null
 */
export function getFeedHistoryFilePath(feedId: string): vscode.Uri | null {
  // 使用安全的文件名，避免特殊字符
  const safeFeedId = feedId.replace(/[^a-zA-Z0-9-_]/g, '_');
  return getIssueManagerFilePath(`rss-feed-${safeFeedId}.jsonl`);
}

/**
 * 获取 .issueManager 目录下指定文件的路径
 * @param fileName 文件名
 * @returns 文件的 Uri，如果目录不存在则返回 null
 */
function getIssueManagerFilePath(fileName: string): vscode.Uri | null {
  const issueManagerDir = getIssueManagerDir();
  if (!issueManagerDir) {
    return null;
  }
  return vscode.Uri.joinPath(issueManagerDir, fileName);
}

/**
 * 获取RSS配置文件路径
 * @returns RSS配置文件的 Uri，如果目录不存在则返回 null
 */
export function getRSSConfigFilePath(): vscode.Uri | null {
  return getIssueManagerFilePath('rss-config.yaml');
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

/**
 * 读取 YAML 文件内容
 * @param fileUri 文件路径
 * @returns 解析后的 YAML 对象，失败返回 null
 */
export async function readYAMLFile<T = any>(fileUri: vscode.Uri): Promise<T | null> {
  try {
    const fileData = await vscode.workspace.fs.readFile(fileUri);
    const content = Buffer.from(fileData).toString('utf8');
    return yaml.load(content) as T;
  } catch (error) {
    console.error(`读取 YAML 文件失败 ${fileUri.fsPath}:`, error);
    return null;
  }
}

/**
 * 写入 YAML 文件
 * @param fileUri 文件路径
 * @param data 要写入的数据
 * @returns 写入成功返回 true，失败返回 false
 */
export async function writeYAMLFile(fileUri: vscode.Uri, data: any): Promise<boolean> {
  try {
    const content = yaml.dump(data, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
      sortKeys: false
    });
    const uint8Array = Buffer.from(content, 'utf8');
    await vscode.workspace.fs.writeFile(fileUri, uint8Array);
    return true;
  } catch (error) {
    console.error(`写入 YAML 文件失败 ${fileUri.fsPath}:`, error);
    return false;
  }
}

/**
 * 读取 JSONL 文件内容（JSON Lines格式）
 * @param fileUri 文件路径
 * @returns 解析后的对象数组，失败返回 null
 */
export async function readJSONLFile<T = any>(fileUri: vscode.Uri): Promise<T[] | null> {
  try {
    const fileData = await vscode.workspace.fs.readFile(fileUri);
    const content = Buffer.from(fileData).toString('utf8');
    
    if (!content.trim()) {
      return []; // 空文件返回空数组
    }
    
    const lines = content.trim().split('\n');
    const results: T[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line) {
        try {
          results.push(JSON.parse(line) as T);
        } catch (parseError) {
          console.warn(`JSONL文件第${i + 1}行解析失败:`, parseError);
          // 继续处理其他行，不因为一行错误而放弃整个文件
        }
      }
    }
    
    return results;
  } catch (error) {
    console.error(`读取 JSONL 文件失败 ${fileUri.fsPath}:`, error);
    return null;
  }
}

/**
 * 写入 JSONL 文件（JSON Lines格式）
 * @param fileUri 文件路径
 * @param data 要写入的数据数组
 * @returns 写入成功返回 true，失败返回 false
 */
export async function writeJSONLFile<T = any>(fileUri: vscode.Uri, data: T[]): Promise<boolean> {
  try {
    const lines = data.map(item => JSON.stringify(item));
    const content = lines.join('\n') + (lines.length > 0 ? '\n' : '');
    const uint8Array = Buffer.from(content, 'utf8');
    await vscode.workspace.fs.writeFile(fileUri, uint8Array);
    return true;
  } catch (error) {
    console.error(`写入 JSONL 文件失败 ${fileUri.fsPath}:`, error);
    return false;
  }
}

/**
 * 追加单条记录到 JSONL 文件
 * @param fileUri 文件路径
 * @param data 要追加的数据
 * @returns 追加成功返回 true，失败返回 false
 */
export async function appendToJSONLFile<T = any>(fileUri: vscode.Uri, data: T): Promise<boolean> {
  try {
    const line = JSON.stringify(data) + '\n';
    const uint8Array = Buffer.from(line, 'utf8');
    
    // 检查文件是否存在
    try {
      await vscode.workspace.fs.stat(fileUri);
      // 文件存在，追加内容
      const existingData = await vscode.workspace.fs.readFile(fileUri);
      const combinedData = Buffer.concat([existingData, uint8Array]);
      await vscode.workspace.fs.writeFile(fileUri, combinedData);
    } catch (statError) {
      // 文件不存在，创建新文件
      await vscode.workspace.fs.writeFile(fileUri, uint8Array);
    }
    
    return true;
  } catch (error) {
    console.error(`追加到 JSONL 文件失败 ${fileUri.fsPath}:`, error);
    return false;
  }
}

/**  
 * 读取 JSONL 文件的最后N条记录。  
 * 注意：此实现会一次性读取整个文件到内存，不适合处理超大文件。  
 * @param fileUri 文件路径  
 * @param maxRecords 最多读取的记录数  
 * @returns 解析后的对象数组，失败返回 null  
 */  
export async function readLastJSONLRecords<T = any>(fileUri: vscode.Uri, maxRecords: number): Promise<T[] | null> {
  try {
    const fileData = await vscode.workspace.fs.readFile(fileUri);
    const content = Buffer.from(fileData).toString('utf8');
    
    if (!content.trim()) {
      return []; // 空文件返回空数组
    }
    
    const lines = content.trim().split('\n');
    const startIndex = Math.max(0, lines.length - maxRecords);
    const targetLines = lines.slice(startIndex);
    
    const results: T[] = [];
    for (let i = 0; i < targetLines.length; i++) {
      const line = targetLines[i].trim();
      if (line) {
        try {
          results.push(JSON.parse(line) as T);
        } catch (parseError) {
          console.warn(`JSONL文件解析失败:`, parseError);
        }
      }
    }
    
    return results;
  } catch (error) {
    console.error(`读取 JSONL 文件最后记录失败 ${fileUri.fsPath}:`, error);
    return null;
  }
}
/**
 * 获取 RSS 订阅源状态文件路径（如 lastUpdated）
 */
export function getRSSFeedStatesFilePath(): vscode.Uri | null {
  return getIssueManagerFilePath('rss-feed-states.json');
}

/**
 * 获取文件相对于问题目录的路径
 * @param filePath 文件的绝对路径
 * @returns 相对于问题目录的路径，如果文件不在问题目录内则返回 null
 */
export function getRelativePathToIssueDir(filePath: string): string | null {
  const issueDir = getIssueDir();
  if (!issueDir) {
    return null;
  }
  
  const relativePath = path.relative(issueDir, filePath);
  // 如果 relativePath 不以 '..' 开头，并且不是绝对路径，则说明文件在 issueDir 目录内
  return !relativePath.startsWith('..') && !path.isAbsolute(relativePath) ? relativePath : null;
}

/**
 * 检查文件是否为问题目录下的 Markdown 文件
 * @param fileUri 文件的 URI
 * @returns 如果是问题目录下的 Markdown 文件返回 true，否则返回 false
 */
export function isIssueMarkdownFile(fileUri: vscode.Uri): boolean {
  if (fileUri.scheme !== 'file' || !fileUri.fsPath.endsWith('.md')) {
    return false;
  }

  return getRelativePathToIssueDir(fileUri.fsPath) !== null;
}