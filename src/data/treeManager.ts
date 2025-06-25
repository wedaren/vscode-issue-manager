import * as vscode from 'vscode';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getIssueDir } from '../config';

/**
 * 获取文件相对于 issueDir 的路径。
 * @param filePath 文件的绝对路径。
 * @returns 相对于 issueDir 的路径，如果文件不在 issueDir 内则返回 null。
 */
export function getRelativePath(filePath: string): string | null {
  const issueDir = getIssueDir();
  if (!issueDir) {
    return null;
  }
  const relativePath = path.relative(issueDir, filePath);
  // 如果文件不在目录下，relativePath 会以 '..' 开头
  return relativePath.startsWith('..') ? null : relativePath;
}

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
 * 遍历树并对每个节点执行回调。
 * @param nodes 节点数组。
 * @param callback 回调函数。
 */
function walkTree(nodes: TreeNode[], callback: (node: TreeNode) => void) {
  for (const node of nodes) {
    callback(node);
    if (node.children) {
      walkTree(node.children, callback);
    }
  }
}

/**
 * 查找树中所有引用的文件路径。
 * @param tree The tree data.
 * @returns A set of relative file paths.
 */
export function getAssociatedFiles(tree: TreeData): Set<string> {
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

/**
 * 向树中添加一个新节点。
 * @param tree The tree data to modify.
 * @param filePath The relative path of the file to add.
 * @param parentId The id of the parent node. If null, adds to root.
 * @param index The index to insert at. If undefined, adds to the end.
 * @returns The newly created node or null if parent not found.
 */
export function addNode(tree: TreeData, filePath: string, parentId: string | null, index?: number): TreeNode | null {
    const newNode: TreeNode = {
        id: uuidv4(),
        filePath,
        children: [],
        expanded: true,
    };

    if (parentId === null) {
        // Add to root
        if (index === undefined) {
            tree.rootNodes.unshift(newNode);
        } else {
            tree.rootNodes.splice(index, 0, newNode);
        }
        return newNode;
    }

    const { node: parent } = findNodeById(tree.rootNodes, parentId) || {};
    if (parent) {
        if (index === undefined) {
            parent.children.unshift(newNode);
        } else {
            parent.children.splice(index, 0, newNode);
        }
        return newNode;
    }

    return null;
}

/**
 * 从树中移除一个节点。
 * @param tree The tree data to modify.
 * @param nodeId The id of the node to remove.
 * @returns An object containing the removed node and a success flag.
 */
export function removeNode(tree: TreeData, nodeId: string): { removedNode: TreeNode | null, success: boolean } {
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
export function findNodeById(nodes: TreeNode[], id: string): { node: TreeNode, parentList: TreeNode[] } | null {
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
