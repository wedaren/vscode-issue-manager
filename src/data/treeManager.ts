import * as vscode from 'vscode';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getIssueDir } from '../config';

// 定义树节点和树数据的结构
export interface TreeNode {
  id: string;
  filePath: string; // 相对于 issueDir 的路径
  expanded?: boolean;
  children: TreeNode[];
}

export interface TreeData {
  version: string;
  lastModified: string;
  rootNodes: TreeNode[];
}

/**
 * 获取 tree.json 文件的绝对路径。
 * @returns 如果 issueDir 未配置，则返回 null。
 */
const getTreeDataPath = (): string | null => {
  const issueDir = getIssueDir();
  if (!issueDir) {
    return null;
  }
  // 确保 .issueManager 目录存在
  const dataDir = path.join(issueDir, '.issueManager');
  try {
    if (!require('fs').existsSync(dataDir)) {
      require('fs').mkdirSync(dataDir, { recursive: true });
    }
  } catch (e) {
    vscode.window.showErrorMessage('创建 .issueManager 目录失败。');
    return null;
  }
  return path.join(dataDir, 'tree.json');
};

const defaultTreeData: TreeData = {
  version: '1.0.0',
  lastModified: new Date().toISOString(),
  rootNodes: [],
};

/**
 * 读取 tree.json 文件。
 * @returns 返回解析后的 TreeData 对象，如果文件不存在或损坏则返回默认结构。
 */
export const readTree = async (): Promise<TreeData> => {
  const treePath = getTreeDataPath();
  if (!treePath) {
    return { ...defaultTreeData, rootNodes: [] };
  }

  try {
    const content = await vscode.workspace.fs.readFile(vscode.Uri.file(treePath));
    // TODO: 添加更严格的数据校验逻辑
    return JSON.parse(content.toString());
  } catch (error) {
    // 如果文件不存在或解析失败，返回默认数据
    return { ...defaultTreeData, rootNodes: [] };
  }
};

/**
 * 将树状数据写入 tree.json 文件。
 * @param data 要写入的 TreeData 对象。
 */
export const writeTree = async (data: TreeData): Promise<void> => {
  const treePath = getTreeDataPath();
  if (!treePath) {
    vscode.window.showErrorMessage('无法写入树状结构，问题目录未配置。');
    return;
  }

  data.lastModified = new Date().toISOString();
  const content = Buffer.from(JSON.stringify(data, null, 2), 'utf8');

  try {
    await vscode.workspace.fs.writeFile(vscode.Uri.file(treePath), content);
  } catch (error) {
    vscode.window.showErrorMessage(`写入 tree.json 失败: ${error}`);
  }
};
