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
import { getIssueDir, getFocusedMaxItems } from '../config';
import { FocusedData } from './treeManager';
import { getCategoryIcon, ParaCategory } from './paraManager';

const FOCUSED_VERSION = '1.0.0';
const FOCUSED_FILE = 'focused.json';



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
 * 如果节点已存在于关注列表，则将其移动到最前面。
 * 如果节点不存在，则添加到最前面。
 * 处理顺序：使用 reverse() 使得输入数组中靠后的元素在结果列表中更靠前。
 * 添加后会自动限制列表长度，超过配置的最大数量时移除最旧的项目。
 */
export async function addFocus(nodeIds: string[]): Promise<void> {
  const data = await readFocused();
  let hasChanges = false;

  // 使用 reverse() 简化逆序插入，保证批量添加后顺序与输入一致（新关注的排在最前）
  for (const nodeId of [...nodeIds].reverse()) {
    const existingIndex = data.focusList.indexOf(nodeId);  

    if (existingIndex === -1) {  
      // 新节点，添加到最前面  
      data.focusList.unshift(nodeId);  
      hasChanges = true;  
    } else if (existingIndex > 0) {  
      // 已存在但不在首位，移动到最前面  
      data.focusList.splice(existingIndex, 1);  
      data.focusList.unshift(nodeId);  
      hasChanges = true;  
    }  
    // 如果 existingIndex === 0 (已在首位)，则不执行任何操作
  }

  // 限制列表长度，移除超出配置的最大数量的项目
  const maxItems = getFocusedMaxItems();
  if (data.focusList.length > maxItems) {
    data.focusList.splice(maxItems);
    hasChanges = true;
  }

  // 只有在有变更时才写入文件，避免无效 I/O
  if (hasChanges) {
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
    await writeFocused(data);
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

/**
 * 裁剪关注列表到配置的最大数量
 * 当用户修改 maxItems 配置时调用，确保列表符合新的限制
 * @returns 返回被移除的节点数量，如果没有超限则返回 0
 */
export async function trimFocusedToMaxItems(): Promise<number> {
  const data = await readFocused();
  const maxItems = getFocusedMaxItems();
  
  if (data.focusList.length > maxItems) {
    const removedCount = data.focusList.length - maxItems;
    data.focusList.splice(maxItems);
    await writeFocused(data);
    return removedCount;
  }
  
  return 0;
}

/**
 * 根据关注索引返回对应的图标
 * @param focusIndex 关注列表中的索引
 */
export function getIssueNodeIconPath(focusIndex: number | undefined, paraCategory?: ParaCategory): vscode.ThemeIcon | undefined {
  // 根据关注索引返回对应的图标，使用 switch 语句提升可读性和维护性
  switch (focusIndex) {
    case 0:
      return new vscode.ThemeIcon('star-full');
    case 1:
    case 2:
      return new vscode.ThemeIcon('star-half');
    case 3:
    case 4:
    case 5:
      return new vscode.ThemeIcon('star-empty');
  }
  if (paraCategory) {
    return new vscode.ThemeIcon(getCategoryIcon(paraCategory));
  }

  if (focusIndex && focusIndex !== -1) {
    return new vscode.ThemeIcon('sparkle');
  }

  return undefined;
}
