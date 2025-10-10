import * as vscode from 'vscode';
import * as path from 'path';
import { getIssueDir } from '../config';

/**
 * 一次性读取 PARA 分类映射（id => category），用于高效同步查找。
 */
export const readParaCategoryMap = async (): Promise<Record<string, string>> => {
  const data = await readPara();
  const map: Record<string, string> = {};
  for (const id of data.projects) {
    map[id] = ParaCategory.Projects;
  }
  for (const id of data.areas) {
    map[id] = ParaCategory.Areas;
  }
  for (const id of data.resources) {
    map[id] = ParaCategory.Resources;
  }
  for (const id of data.archives) {
    map[id] = ParaCategory.Archives;
  }
  return map;
};

/**
 * PARA 分类枚举
 */
export enum ParaCategory {
  Projects = 'projects',
  Areas = 'areas',
  Resources = 'resources',
  Archives = 'archives'
}

/**
 * PARA 数据结构
 */
export interface ParaData {
  version: string;
  lastModified: string;
  projects: string[]; // 问题节点的 id（不是 filePath，以支持同一文件的多个节点）
  areas: string[];
  resources: string[];
  archives: string[];
}

/**
 * 获取 para.json 文件的绝对路径
 */
const getParaDataPath = async (): Promise<string | null> => {
  const issueDir = getIssueDir();
  if (!issueDir) {
    return null;
  }

  const dataDir = path.join(issueDir, '.issueManager');
  const dataDirUri = vscode.Uri.file(dataDir);

  try {
    await vscode.workspace.fs.stat(dataDirUri);
  } catch (error) {
    vscode.window.showErrorMessage('访问 .issueManager 目录失败。');
    return null;
  }

  return path.join(dataDir, 'para.json');
};

/**
 * 默认 PARA 数据结构
 */
const defaultParaData: ParaData = {
  version: '1.0.0',
  lastModified: new Date().toISOString(),
  projects: [],
  areas: [],
  resources: [],
  archives: []
};

/**
 * 读取 para.json 文件
 */
export const readPara = async (): Promise<ParaData> => {
  const paraPath = await getParaDataPath();
  if (!paraPath) {
    return { ...defaultParaData };
  }

  try {
    const uri = vscode.Uri.file(paraPath);
    const content = await vscode.workspace.fs.readFile(uri);
    const data = JSON.parse(Buffer.from(content).toString('utf8'));
    return data;
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'FileNotFound') {
      // 文件不存在，返回默认数据
      return { ...defaultParaData };
    }
    console.error('读取 para.json 失败:', error);
    return { ...defaultParaData };
  }
};

/**
 * 写入 para.json 文件
 */
export const writePara = async (data: ParaData): Promise<void> => {
  const paraPath = await getParaDataPath();
  if (!paraPath) {
    throw new Error('无法获取 para.json 路径');
  }

  data.lastModified = new Date().toISOString();
  const content = JSON.stringify(data, null, 2);
  await vscode.workspace.fs.writeFile(vscode.Uri.file(paraPath), Buffer.from(content, 'utf8'));
};

/**
 * 添加问题到指定分类（会从其他分类中移除）
 * @param category PARA 分类
 * @param issueId 问题节点的 id（不是 filePath）
 */
export const addIssueToCategory = async (
  category: ParaCategory,
  issueId: string
): Promise<void> => {
  const data = await readPara();
  
  // 从所有分类中移除
  data.projects = data.projects.filter(p => p !== issueId);
  data.areas = data.areas.filter(p => p !== issueId);
  data.resources = data.resources.filter(p => p !== issueId);
  data.archives = data.archives.filter(p => p !== issueId);
  
  // 添加到目标分类
  if (!data[category].includes(issueId)) {
    data[category].push(issueId);
  }
  
  await writePara(data);
};

/**
 * 从指定分类移除问题
 * @param category PARA 分类
 * @param issueId 问题节点的 id（不是 filePath）
 */
export const removeIssueFromCategory = async (
  category: ParaCategory,
  issueId: string
): Promise<void> => {
  const data = await readPara();
  const index = data[category].indexOf(issueId);
  
  if (index > -1) {
    data[category].splice(index, 1);
    await writePara(data);
  }
};

/**
 * 查找问题所在的分类
 * @param issueId 问题节点的 id（不是 filePath）
 */
export const findIssueCategory = async (issueId: string): Promise<ParaCategory | null> => {
  const data = await readPara();
  
  if (data.projects.includes(issueId)) {
    return ParaCategory.Projects;
  }
  if (data.areas.includes(issueId)) {
    return ParaCategory.Areas;
  }
  if (data.resources.includes(issueId)) {
    return ParaCategory.Resources;
  }
  if (data.archives.includes(issueId)) {
    return ParaCategory.Archives;
  }
  
  return null;
};

/**
 * 获取容器的分类标签
 */
export const getCategoryLabel = (category: ParaCategory): string => {
  switch (category) {
    case ParaCategory.Projects:
      return 'P | Projects (项目)';
    case ParaCategory.Areas:
      return 'A | Areas (领域)';
    case ParaCategory.Resources:
      return 'R | Resources (资源)';
    case ParaCategory.Archives:
      return 'A | Archives (归档)';
  }
};

/**
 * 获取容器的图标
 */
export const getCategoryIcon = (category: ParaCategory): string => {
  switch (category) {
    case ParaCategory.Projects:
      return 'rocket';
    case ParaCategory.Areas:
      return 'organization';
    case ParaCategory.Resources:
      return 'book';
    case ParaCategory.Archives:
      return 'archive';
  }
};
