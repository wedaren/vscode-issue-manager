/**
 * focusedManager.ts
 * 负责管理 .issueManager/focused.json 的读写、初始化和校验。
 *
 * 关注问题数据结构示例：
 * {
 *   "version": "1.0.0",
 *   "focusList": ["node-uuid-1", "node-uuid-2"]
 * }
 */
import * as path from 'path';
import * as vscode from 'vscode';
import { getUri } from '../utils/fileUtils';
import { getIssueDir } from '../config';

const FOCUSED_VERSION = '1.0.0';
const FOCUSED_FILE = 'focused.json';

export interface FocusedData {
  version: string;
  focusList: string[];
}


/**
 * 获取 focused.json 文件的绝对路径。
 * @returns 如果 issueDir 未配置，则返回 null。
 */
const getFocusedDataPath = async (): Promise<string | null> => {
  const issueDir = getIssueDir();
  if (!issueDir) {
    return null;
  }
  // 确保 .issueManager 目录存在
  const dataDir = path.join(issueDir, '.issueManager');
  const dataDirUri = getUri(dataDir);
  try {
    await vscode.workspace.fs.stat(dataDirUri);
  } catch {
    // 如果 stat 失败，假定目录不存在并尝试创建它
    try {
      await vscode.workspace.fs.createDirectory(dataDirUri);
    } catch (e) {
      vscode.window.showErrorMessage(`创建 .issueManager 目录失败: ${e}`);
      return null;
    }
  }
  return path.join(dataDir, FOCUSED_FILE);
};

/**
 * 异步读取 focused.json 文件，若不存在则返回默认结构
 */
export async function readFocused(): Promise<FocusedData> {
  try {
    const filePath = await getFocusedDataPath();
    if (!filePath) {
      throw new Error('Issue directory is not configured.');
    }
    const fileUri = getUri(filePath);
    const raw = await vscode.workspace.fs.readFile(fileUri);
    const data = JSON.parse(raw.toString());
    // 基本校验
    if (data && Array.isArray(data.focusList) && typeof data.version === 'string') {
      return { version: data.version, focusList: data.focusList };
    }
    // 结构不合法，返回空结构
      throw new Error('Invalid focused data structure');
  } catch (e) {
    // 文件不存在或解析失败，返回空结构
    return { version: FOCUSED_VERSION, focusList: [] };
  }
}

/**
 * 写入 focused.json 文件。
 * @param data FocusedData 对象。
 */
export const writeFocused = async (data: FocusedData): Promise<void> => {
  const focusedPath = await getFocusedDataPath();
  if (!focusedPath) {
    vscode.window.showErrorMessage('无法写入关注数据，问题目录未配置。');
    return;
  }
  const content = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
  try {
    await vscode.workspace.fs.writeFile(vscode.Uri.file(focusedPath), content);
  } catch (error) {
    vscode.window.showErrorMessage(`写入 focused.json 失败: ${error}`);
  }
};


/**
 * 添加关注节点
 */
export async function addFocus(nodeId: string): Promise<void> {
  const data = await readFocused();
  if (!data.focusList.includes(nodeId)) {
    data.focusList.unshift(nodeId);
    await writeFocused(data);
  }
}

/**
 * 移除关注节点
 */
export async function removeFocus(nodeId: string): Promise<void> {
  const data = await readFocused();
  const idx = data.focusList.indexOf(nodeId);
  if (idx !== -1) {
    data.focusList.splice(idx, 1);
    await writeFocused( data);
  }
}

/**
 * 置顶关注节点
 */
export async function pinFocus(nodeId: string): Promise<void> {
  const data = await readFocused();
  const index = data.focusList.indexOf(nodeId);
  // 只有当节点存在且不为第一个时才需要移动
  if (index > 0) {
    const [item] = data.focusList.splice(index, 1);
    data.focusList.unshift(item);
    await writeFocused(data);
  }
}
