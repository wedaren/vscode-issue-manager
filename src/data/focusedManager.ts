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
import * as fs from 'fs';
import * as path from 'path';

const FOCUSED_FILE_NAME = 'focused.json';
const FOCUSED_VERSION = '1.0.0';

export interface FocusedData {
  version: string;
  focusList: string[];
}

/**
 * 获取 focused.json 的完整路径
 */
export function getFocusedFilePath(issueDir: string): string {
  return path.join(issueDir, '.issueManager', FOCUSED_FILE_NAME);
}

/**
 * 读取 focused.json 文件，若不存在则返回默认结构
 */
export function readFocused(issueDir: string): FocusedData {
  const filePath = getFocusedFilePath(issueDir);
  if (!fs.existsSync(filePath)) {
    return { version: FOCUSED_VERSION, focusList: [] };
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    // 基本校验
    if (data && Array.isArray(data.focusList) && typeof data.version === 'string') {
      return { version: data.version, focusList: data.focusList };
    }
    // 结构不合法，返回空结构
    return { version: FOCUSED_VERSION, focusList: [] };
  } catch (e) {
    // 解析失败，返回空结构
    return { version: FOCUSED_VERSION, focusList: [] };
  }
}

/**
 * 写入 focused.json 文件，自动创建目录
 */
export function writeFocused(issueDir: string, data: FocusedData): void {
  const dir = path.join(issueDir, '.issueManager');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = getFocusedFilePath(issueDir);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * 添加关注节点
 */
export function addFocus(issueDir: string, nodeId: string): void {
  const data = readFocused(issueDir);
  if (!data.focusList.includes(nodeId)) {
    data.focusList.unshift(nodeId);
    writeFocused(issueDir, data);
  }
}

/**
 * 移除关注节点
 */
export function removeFocus(issueDir: string, nodeId: string): void {
  const data = readFocused(issueDir);
  const idx = data.focusList.indexOf(nodeId);
  if (idx !== -1) {
    data.focusList.splice(idx, 1);
    writeFocused(issueDir, data);
  }
}
