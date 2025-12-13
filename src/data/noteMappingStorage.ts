import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import * as path from 'path';
import { getIssueDir } from '../config';

/**
 * 笔记映射规则数据结构
 */
export interface NoteMapping {
  /** 唯一标识 */
  id: string;
  /** 作用域：workspace（工作区级别）或 file（文件级别） */
  scope: 'workspace' | 'file';
  /** 匹配模式：glob 或路径前缀 */
  pattern: string;
  /** 目标笔记路径列表（相对于 issueDir） */
  targets: string[];
  /** 优先级（数值越大优先级越高） */
  priority: number;
  /** 回退行为：none | noteRoot | ask */
  fallback?: 'none' | 'noteRoot' | 'ask';
  /** 创建时间 */
  createdAt?: string;
  /** 更新时间 */
  updatedAt?: string;
}

/**
 * 映射文件数据结构
 */
interface MappingsFile {
  version: string;
  mappings: NoteMapping[];
}

const MAPPINGS_FILE_NAME = 'mappings.yaml';
const MAPPINGS_DIR = '.issueManager';
const MAPPINGS_VERSION = '1.0';

// 用于保护并发写入的锁
let writeLock: Promise<void> | null = null;

/**
 * 获取映射文件的完整路径
 */
function getMappingsFilePath(): string | undefined {
  const issueDir = getIssueDir();
  if (!issueDir) {
    return undefined;
  }
  return path.join(issueDir, MAPPINGS_DIR, MAPPINGS_FILE_NAME);
}

/**
 * 确保映射文件所在目录存在
 */
async function ensureMappingsDir(): Promise<string | undefined> {
  const issueDir = getIssueDir();
  if (!issueDir) {
    return undefined;
  }
  
  const mappingsDir = path.join(issueDir, MAPPINGS_DIR);
  const mappingsDirUri = vscode.Uri.file(mappingsDir);
  
  try {
    await vscode.workspace.fs.stat(mappingsDirUri);
  } catch {
    // 目录不存在，创建它
    await vscode.workspace.fs.createDirectory(mappingsDirUri);
  }
  
  return mappingsDir;
}

/**
 * 读取映射文件
 */
export async function readMappings(): Promise<NoteMapping[]> {
  const filePath = getMappingsFilePath();
  if (!filePath) {
    return [];
  }
  
  const fileUri = vscode.Uri.file(filePath);
  
  try {
    const content = await vscode.workspace.fs.readFile(fileUri);
    const text = Buffer.from(content).toString('utf8');
    const data = yaml.load(text) as MappingsFile;
    
    if (!data || !Array.isArray(data.mappings)) {
      return [];
    }
    
    return data.mappings;
  } catch (error: any) {
    // 文件不存在或解析失败
    if (error.code === 'FileNotFound' || error.name === 'FileNotFound') {
      return [];
    }
    console.error('读取映射文件失败:', error);
    return [];
  }
}

/**
 * 写入映射文件（带并发保护和原子写入）
 */
export async function writeMappings(mappings: NoteMapping[]): Promise<void> {
  // 等待之前的写入操作完成
  if (writeLock) {
    await writeLock;
  }
  
  // 创建新的写入锁
  writeLock = (async () => {
    try {
      await ensureMappingsDir();
      const filePath = getMappingsFilePath();
      if (!filePath) {
        throw new Error('无法确定映射文件路径');
      }
      
      // 准备数据
      const data: MappingsFile = {
        version: MAPPINGS_VERSION,
        mappings: mappings.map(m => ({
          ...m,
          updatedAt: new Date().toISOString()
        }))
      };
      
      // 转换为 YAML
      const yamlContent = yaml.dump(data, {
        indent: 2,
        lineWidth: -1,
        noRefs: true
      });
      
      // 写入临时文件
      const tempFilePath = filePath + '.tmp';
      const tempFileUri = vscode.Uri.file(tempFilePath);
      const fileUri = vscode.Uri.file(filePath);
      
      await vscode.workspace.fs.writeFile(
        tempFileUri,
        Buffer.from(yamlContent, 'utf8')
      );
      
      // 原子性地重命名临时文件
      await vscode.workspace.fs.rename(tempFileUri, fileUri, { overwrite: true });
      
    } finally {
      // 清除锁
      writeLock = null;
    }
  })();
  
  await writeLock;
}

/**
 * 生成唯一 ID
 */
export function generateMappingId(): string {
  return `mapping-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * 确保 .gitignore 包含映射文件
 */
export async function ensureGitignoreForMappings(): Promise<void> {
  const issueDir = getIssueDir();
  if (!issueDir) {
    return;
  }
  
  const gitignoreUri = vscode.Uri.file(path.join(issueDir, '.gitignore'));
  const ignoreRule = `.issueManager/${MAPPINGS_FILE_NAME}`;
  
  try {
    let content = '';
    try {
      const data = await vscode.workspace.fs.readFile(gitignoreUri);
      content = Buffer.from(data).toString('utf8');
    } catch {
      // 文件不存在
    }
    
    const lines = content.split(/\r?\n/);
    const hasRule = lines.some(line => line.trim() === ignoreRule);
    
    if (!hasRule) {
      const newContent = content.trim() + (content.trim() ? '\n' : '') + ignoreRule + '\n';
      await vscode.workspace.fs.writeFile(gitignoreUri, Buffer.from(newContent, 'utf8'));
    }
  } catch (error) {
    console.error('自动配置 .gitignore 失败:', error);
  }
}
