import * as vscode from 'vscode';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getIssueDir } from '../config';
import { getRelativePathToIssueDir } from '../utils/fileUtils';
import { TitleCacheService } from '../services/TitleCacheService';

/**
 * 获取文件相对于 issueDir 的路径。
 * @param filePath 文件的绝对路径。
 * @returns 相对于 issueDir 的路径，如果文件不在 issueDir 内则返回 null。
 * @deprecated 请使用 getRelativePathToIssueDir 函数替代
 */
export function getRelativePath(filePath: string): string | null {
  return getRelativePathToIssueDir(filePath);
}

// 定义树节点和树数据的结构
export interface IssueTreeNode {
  id: string;
  filePath: string; // 相对于 issueDir 的路径
  expanded?: boolean;
  children: IssueTreeNode[];
  resourceUri?: vscode.Uri; // 运行时属性，不持久化
}
export interface TreeData {
  version: string;
  lastModified: string;
  rootNodes: IssueTreeNode[];
}

interface FlatIssueTreeNode extends IssueTreeNode {
  parentPath: IssueTreeNode[];
}
/**
 * 扁平化树节点接口，包含父节点路径和标题
 */
export interface FlatTreeNode extends FlatIssueTreeNode {
  parentPath: FlatTreeNode[];
  title: string;
}

/**
 * 遍历树并对每个节点执行回调。
 * @param nodes 节点数组。
 * @param callback 回调函数。
 */
function walkTree(nodes: IssueTreeNode[], callback: (node: IssueTreeNode) => void) {
  for (const node of nodes) {
    callback(node);
    if (node.children) {
      walkTree(node.children, callback);
    }
  }
}

/**
 * 递归扁平化树节点，保留父节点路径。
 * @param nodes 要扁平化的节点数组
 * @param parentNodes 父节点路径
 * @returns 扁平化后的节点数组（不含 title），每个节点包含 parentPath 属性
 */
function flattenTree(
  nodes: IssueTreeNode[], 
  parentNodes: IssueTreeNode[] = []
): FlatIssueTreeNode[] {
  let result: FlatIssueTreeNode[] = [];
  for (const node of nodes) {
    result.push({
      ...node,
      parentPath: [...parentNodes]
    });
    
    if (node.children && node.children.length > 0) {
      result = result.concat(
        flattenTree(node.children, [...parentNodes, node])
      );
    }
  }
  return result;
}

/**
 * 获取扁平化的树结构，并自动加载所有节点的标题。
 * 这是一个便捷函数，自动读取树、扁平化并批量加载标题。
 * @returns 扁平化后的节点数组，每个节点包含 title 属性
 */
export async function getFlatTree(): Promise<FlatTreeNode[]> {
  const tree = await readTree();
  const flatNodes = flattenTree(tree.rootNodes);
  
  const allPaths = new Set<string>(flatNodes.map(node => node.filePath));
  
  // 批量获取所有标题
  const pathArray = Array.from(allPaths);
  const titles = await TitleCacheService.getInstance().getMany(pathArray);
  const titleMap = new Map(pathArray.map((p, i) => [p, titles[i]]));
  
  // 为每个节点添加标题
  return flatNodes.map(node => ({
    ...node,
    parentPath: node.parentPath.map(parentNode => ({
      ...parentNode,
      title: titleMap.get(parentNode.filePath) || path.basename(parentNode.filePath, '.md')
    }) as FlatTreeNode),
    title: titleMap.get(node.filePath) || path.basename(node.filePath, '.md')
  }));
}

/**
 * 查找树中所有引用的文件路径。
 * @returns A set of relative file paths.
 */
export async function getAssociatedFiles(): Promise<Set<string>> {
  const tree = await readTree();
  const associatedFiles = new Set<string>();
  walkTree(tree.rootNodes, (node) => {
    associatedFiles.add(node.filePath);
  });
  return associatedFiles;
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
  const issueDir = getIssueDir();

  if (!treePath || !issueDir) {
    return { ...defaultTreeData, rootNodes: [] };
  }

  let treeData: TreeData;
  try {
    const content = await vscode.workspace.fs.readFile(vscode.Uri.file(treePath));
    // TODO: 添加更严格的数据校验逻辑
    treeData = JSON.parse(content.toString());
  } catch (error) {
    // 记录错误有助于调试，特别是对于文件损坏或格式错误的情况  
    console.error(`Failed to read or parse tree data from ${treePath}:`, error);  
    // 如果文件不存在或解析失败，返回默认数据
    treeData = { ...defaultTreeData, rootNodes: [] };
  }

  // 运行时动态添加 resourceUri
  walkTree(treeData.rootNodes, (node) => {
    // 确保 filePath 存在再创建 Uri
    if (node.filePath) {
      node.resourceUri = vscode.Uri.joinPath(vscode.Uri.file(issueDir), node.filePath);
    }
  });

  return treeData;
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

  // 使用 replacer 函数在序列化时忽略 resourceUri 属性
  const replacer = (key: string, value: unknown) => {
    if (key === 'resourceUri') {
      return undefined; // 忽略此属性
    }
    return value;
  };

  const content = Buffer.from(JSON.stringify(data, replacer, 2), 'utf8');

  try {
    await vscode.workspace.fs.writeFile(vscode.Uri.file(treePath), content);
  } catch (error) {
    vscode.window.showErrorMessage(`写入 tree.json 失败: ${error}`);
  }
};

/**
 * 向树中添加一个新节点。
 * @param tree The tree data to modify.
 * @param filePath The relative path of the file to add.
 * @param parentId The id of the parent node. If null, adds to root.
 * @returns The newly created node or null if parent not found.
 */
export function addNode(tree: TreeData, filePaths: string[], parentId: string | null): IssueTreeNode[] | null {
  const issueDir = getIssueDir();
  if (!issueDir) {
    return null;
  }

  const newNodes: IssueTreeNode[] = filePaths.map(filePath => ({
    id: uuidv4(),
    filePath,
    children: [],
    expanded: true,
    resourceUri: vscode.Uri.joinPath(vscode.Uri.file(issueDir), filePath),
  }));

  if (parentId === null) {
    tree.rootNodes.unshift(...newNodes);
    return newNodes;
  }

  const { node: parent } = findNodeById(tree.rootNodes, parentId) || {};
  if (parent) {
    parent.children.unshift(...newNodes);
    return newNodes;
  }

  return null;
}

/**
 * 从树中移除一个节点。
 * @param tree The tree data to modify.
 * @param nodeId The id of the node to remove.
 * @returns An object containing the removed node and a success flag.
 */
export function removeNode(tree: TreeData, nodeId: string): { removedNode: IssueTreeNode | null, success: boolean } {
  const found = findNodeById(tree.rootNodes, nodeId);
  if (!found) {
    return { removedNode: null, success: false };
  }

  const { node, parentList } = found;
  const index = parentList.findIndex(n => n.id === nodeId);
  if (index > -1) {
    parentList.splice(index, 1);
    return { removedNode: node, success: true };
  }

  return { removedNode: null, success: false };
}


/**
 * 移动一个节点到新的位置。
 * @param tree The tree data to modify.
 * @param sourceId The id of the node to move.
 * @param targetParentId The id of the new parent. If null, moves to root.
 * @param targetIndex The index to move to in the new parent's children array.
 */
export function moveNode(tree: TreeData, sourceId: string, targetParentId: string | null, targetIndex: number) {
  const { removedNode } = removeNode(tree, sourceId);

  if (!removedNode) {
    return; // Source node not found
  }

  if (targetParentId === null) {
    // Move to root
    tree.rootNodes.splice(targetIndex, 0, removedNode);
  } else {
    const { node: targetParent } = findNodeById(tree.rootNodes, targetParentId) || {};
    if (targetParent) {
      targetParent.children.splice(targetIndex, 0, removedNode);
    } else {
      // If target parent doesn't exist, add it back to the root to avoid data loss.
      tree.rootNodes.push(removedNode);
    }
  }
}


/**
 * 递归地在树中根据 ID 查找节点。
 * @param nodes The list of nodes to search in.
 * @param id The id of the node to find.
 * @returns An object containing the found node and its parent list, or null if not found.
 */
export function findNodeById(nodes: IssueTreeNode[], id: string): { node: IssueTreeNode, parentList: IssueTreeNode[] } | null {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.id === id) {
      return { node, parentList: nodes };
    }
    if (node.children && node.children.length > 0) {
      const found = findNodeById(node.children, id);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

/**
 * 在完整树数据中查找节点并直接返回节点引用。
 * @param tree 树数据
 * @param nodeId 节点 ID
 * @returns 匹配的节点，若未找到则返回 null
 */
export function getTreeNodeById(tree: TreeData, nodeId: string): IssueTreeNode | null {
  const result = findNodeById(tree.rootNodes, nodeId);
  return result ? result.node : null;
}

/**
 * 在树中查找目标节点的直接父节点。
 * @param roots 根节点集合。
 * @param targetId 目标节点 ID。
 * @param comparator 可选的自定义匹配逻辑，默认按 ID 全等。
 */
export function findParentNodeById<T extends { id: string; children?: T[] }>(
  roots: T[],
  targetId: string,
  comparator: (child: T, target: string) => boolean = (child, target) => child.id === target
): T | null {
  const queue: T[] = [...roots]; // 使用队列进行广度优先搜索  

  while (queue.length > 0) {  
    const node = queue.shift()!; // 从队列头部取出一个节点  

    if (node.children) {  
      // 检查当前节点的子节点是否是目标  
      for (const child of node.children) {  
        if (comparator(child, targetId)) {  
          return node; // 如果是，当前节点就是父节点  
        }  
        // 将子节点加入队列，以便后续遍历  
        queue.push(child);  
      }  
    }  
  }  

  return null; // 遍历完整棵树都未找到  
}

/**
 * 检查一个节点是否是另一个节点的祖先。
 * @param tree The tree data.
 * @param potentialAncestorId The ID of the potential ancestor node.
 * @param nodeId The ID of the node to check.
 * @returns True if the first node is an ancestor of the second, false otherwise.
 */
export function isAncestor(tree: TreeData, potentialAncestorId: string, nodeId: string): boolean {
  const { node: startNode } = findNodeById(tree.rootNodes, potentialAncestorId) || {};
  if (!startNode) {
    return false;
  }

  let found = false;
  walkTree(startNode.children, (node) => {
    if (node.id === nodeId) {
      found = true;
    }
  });
  return found;
}

/**
 * 查找并返回给定节点的所有祖先。
 * @param nodeId 要查找其祖先的节点的 ID。
 * @param tree 完整的树数据。
 * @returns 一个包含所有祖先节点的数组，从根节点到直接父节点排序。
 */
export function getAncestors(nodeId: string, tree: TreeData): IssueTreeNode[] {
  const ancestors: IssueTreeNode[] = [];

  // 查找从根到一个节点的路径
  const findPath = (nodes: IssueTreeNode[], path: IssueTreeNode[]): boolean => {
    for (const node of nodes) {
      const currentPath = [...path, node];
      if (node.id === nodeId) {
        // 找到了节点，路径（不包括节点自身）就是其祖先
        ancestors.push(...currentPath.slice(0, -1));
        return true;
      }
      if (node.children && findPath(node.children, currentPath)) {
        return true;
      }
    }
    return false;
  };

  findPath(tree.rootNodes, []);
  return ancestors;
}

// ========== focused.json 相关 ========== //

export interface FocusedData {
  version: string;
  focusList: string[]; // 节点 id 列表
}

const FOCUSED_FILE = 'focused.json';

/**
 * 获取 focused.json 文件的绝对路径。
 * @returns 如果 issueDir 未配置，则返回 null。
 */
const getFocusedDataPath = (): string | null => {
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
  return path.join(dataDir, FOCUSED_FILE);
};

const defaultFocusedData: FocusedData = {
  version: '1.0.0',
  focusList: [],
};

/**
 * 读取 focused.json 文件。
 * @returns FocusedData 对象，若不存在或损坏则返回默认结构。
 */
export const readFocused = async (): Promise<FocusedData> => {
  const focusedPath = getFocusedDataPath();
  if (!focusedPath) {
    return { ...defaultFocusedData };
  }
  try {
    const content = await vscode.workspace.fs.readFile(vscode.Uri.file(focusedPath));
    const data = JSON.parse(content.toString());
    // 简单校验
    if (!Array.isArray(data.focusList)) { throw new Error('focusList 必须为数组'); }
    return {
      version: typeof data.version === 'string' ? data.version : '1.0.0',
      focusList: data.focusList.filter((id: any) => typeof id === 'string'),
    };
  } catch (error) {
    // 文件不存在或解析失败，返回默认
    return { ...defaultFocusedData };
  }
};



// =====================
// FocusedRoot 工具函数
// =====================


/**
 * 判断给定的 id 是否为“聚焦”状态。
 * 
 * 如果 id 字符串中包含 '::'，则认为该 id 处于聚焦状态。
 *
 * @param id - 要检查的字符串 id。
 * @returns 如果 id 包含 '::'，返回 true；否则返回 false。
 */
export function isFocusedId(id: string): boolean {
  return id.includes('::');
}

/**
 * 将给定的 `id` 和 `focusedRootID` 组合成一个聚焦ID字符串。
 *
 * @param id - 要组合的节点ID。
 * @param focusedRootID - 当前聚焦的根节点ID。
 * @returns 由 `id` 和 `focusedRootID` 通过 "::" 连接组成的字符串。
 */
export function toFocusedId(id: string, focusedRootID: string): string {
  return id + "::" + focusedRootID;
}

/**
 * 从给定的字符串 ID 中移除聚焦部分，仅返回冒号前的部分。
 *
 * @param id - 包含聚焦部分的字符串 ID，格式通常为 "主ID::聚焦ID"。
 * @returns 移除聚焦部分后的主 ID 字符串。
 */
export function stripFocusedId(id: string): string {
  return id.split("::")[0];
}

export function isFocusedRootId(id: string): boolean {
  // 判断 id 是否包含 '::'，如果包含则认为是聚焦根节点
  const [nodeID, rootID] = id.split("::");
  return nodeID === rootID;
}
// 新增：递归查找并更新节点 expanded 字段的工具函数
/**
 * 递归查找并更新指定节点的 expanded 字段。
 * @param nodes 节点数组
 * @param id 目标节点 id
 * @param expanded 展开状态
 * @returns 是否找到并更新
 */
export function updateNodeExpanded(nodes: IssueTreeNode[], id: string, expanded: boolean): boolean {
  for (const node of nodes) {
    if (node.id === id) {
      node.expanded = expanded;
      return true;
    }
    if (node.children && updateNodeExpanded(node.children, id, expanded)) {
      return true;
    }
  }
  return false;
}

// ========== QuickPick 数据相关 ========== //

export interface QuickPickPersistedData {
  version: string;
  searchHistory: string[];
  queryResultCache: [string, vscode.QuickPickItem[]][];
}

const QUICKPICK_FILE = 'quickPickData.json';

/**
 * 获取 quickPickData.json 文件的绝对路径。
 * @returns 如果 issueDir 未配置，则返回 null。
 */
const getQuickPickDataPath = (): string | null => {
  const issueDir = getIssueDir();
  if (!issueDir) {
    return null;
  }
  const dataDir = path.join(issueDir, '.issueManager');
  try {
    if (!require('fs').existsSync(dataDir)) {
      require('fs').mkdirSync(dataDir, { recursive: true });
    }
  } catch (e) {
    vscode.window.showErrorMessage('创建 .issueManager 目录失败。');
    return null;
  }
  return path.join(dataDir, QUICKPICK_FILE);
};

const defaultQuickPickData: QuickPickPersistedData = {
  version: '1.0.0',
  searchHistory: [],
  queryResultCache: [],
};

/**
 * 读取 quickPickData.json 文件。
 * @returns QuickPickPersistedData 对象，若不存在或损坏则返回默认结构。
 */
export const readQuickPickData = async (): Promise<QuickPickPersistedData> => {
  const quickPickPath = getQuickPickDataPath();
  if (!quickPickPath) {
    return { ...defaultQuickPickData };
  }
  try {
    const content = await vscode.workspace.fs.readFile(vscode.Uri.file(quickPickPath));
    const data = JSON.parse(content.toString());
    if (!Array.isArray(data.searchHistory)) { 
      console.error('searchHistory 必须为数组');
      return { ...defaultQuickPickData };
    }
    if (!Array.isArray(data.queryResultCache)) {
      console.error('queryResultCache 必须为数组');
      return { ...defaultQuickPickData };
     }
    return {
      version: typeof data.version === 'string' ? data.version : '1.0.0',
      searchHistory: data.searchHistory.filter((item: any) => typeof item === 'string'),
      queryResultCache: data.queryResultCache,
    };
  } catch (error) {
    console.error(`Failed to read or parse QuickPick data from ${quickPickPath}:`, error);
    return { ...defaultQuickPickData };
  }
};

/**
 * 将 QuickPick 数据写入 quickPickData.json 文件。
 * @param data 要写入的 QuickPickPersistedData 对象。
 */
export const writeQuickPickData = async (data: QuickPickPersistedData): Promise<void> => {
  const quickPickPath = getQuickPickDataPath();
  if (!quickPickPath) {
    vscode.window.showErrorMessage('无法写入 QuickPick 数据，问题目录未配置。');
    return;
  }

  const content = Buffer.from(JSON.stringify(data, null, 2), 'utf8');

  try {
    await vscode.workspace.fs.writeFile(vscode.Uri.file(quickPickPath), content);
  } catch (error) {
    vscode.window.showErrorMessage(`写入 quickPickData.json 失败: ${error}`);
  }
};

/**
 * 读取 titleCache.json 文件，返回 { [filePath]: title }
 */
export const readTitleCacheJson = async (): Promise<Record<string, string>> => {
  const issueDir = getIssueDir();
  if (!issueDir) {
    return {};
  }
  const cachePath = path.join(issueDir, '.issueManager', 'titleCache.json');
  try {
    const content = await vscode.workspace.fs.readFile(vscode.Uri.file(cachePath));
    return JSON.parse(content.toString());
  } catch (e) {
    // 错误日志，便于调试缓存文件损坏等问题
    console.error(`读取或解析 titleCache.json 失败:`, e);
    return {};
  }
};

/**
 * 写入 titleCache.json 文件
 * @param data 标题映射 { [relativePath]: title }
 */
export const writeTitleCacheJson = async (data: Record<string, string>): Promise<void> => {
  const issueDir = getIssueDir();
  if (!issueDir) {
    return;
  }
  const cachePath = path.join(issueDir, '.issueManager', 'titleCache.json');
  try {
    const uint8Array = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
    await vscode.workspace.fs.writeFile(vscode.Uri.file(cachePath), uint8Array);
  } catch (e) {
    console.error(`写入 titleCache.json 失败:`, e);
  }
};
