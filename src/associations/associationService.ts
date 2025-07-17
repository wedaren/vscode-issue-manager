import * as vscode from 'vscode';
import { readTree, TreeData, IssueTreeNode, getRelativePath } from '../data/treeManager';
import { getIssueDir } from '../config';
import { 
  AssociationResult, 
  AssociationError, 
  AssociationErrorType 
} from './types';

/**
 * 关联服务类，负责查找文件与问题总览中节点的关联关系
 */
export class AssociationService {
  private treeData: TreeData | null = null;

  /**
   * 加载问题总览数据
   */
  async loadTreeData(): Promise<void> {
    this.treeData = await readTree();
  }

  // 添加简单的内部缓存，避免重复计算相同的路径
  private pathCache: Map<string, IssueTreeNode[]> = new Map();
  private nodeCache: Map<string, IssueTreeNode[]> = new Map();
  
  /**
   * 查找指定文件的关联关系
   * @param fileUri 文件URI
   * @returns 关联结果或错误信息
   */
  async findAssociations(fileUri: vscode.Uri): Promise<AssociationResult | AssociationError> {
    const issueDir = getIssueDir();
    if (!issueDir) {
      return {
        type: AssociationErrorType.ISSUE_DIR_NOT_CONFIGURED,
        message: '问题目录未配置'
      };
    }

    // 确保数据已加载
    if (!this.treeData) {
      await this.loadTreeData();
    }

    if (!this.treeData) {
      return {
        type: AssociationErrorType.DATA_LOAD_FAILED,
        message: '无法加载问题总览数据'
      };
    }

    // 获取文件相对路径
    const relativePath = getRelativePath(fileUri.fsPath);
    if (!relativePath) {
      return {
        type: AssociationErrorType.FILE_NOT_IN_ISSUE_DIR,
        message: '文件不在问题目录内',
        details: `文件路径: ${fileUri.fsPath}, 问题目录: ${issueDir}`
      };
    }

    // 使用缓存查找匹配节点
    let matchingNodes: IssueTreeNode[];
    const nodeCacheKey = `file:${relativePath}`;
    
    if (this.nodeCache.has(nodeCacheKey)) {
      matchingNodes = this.nodeCache.get(nodeCacheKey)!;
    } else {
      // 查找所有匹配的节点
      matchingNodes = this.findNodesByFilePath(this.treeData.rootNodes, relativePath);
      // 缓存结果
      this.nodeCache.set(nodeCacheKey, matchingNodes);
    }
    
    if (matchingNodes.length === 0) {
      return {
        type: AssociationErrorType.FILE_NOT_ASSOCIATED,
        message: '文件未在问题总览中关联'
      };
    }

    // 优化：并行构建路径以提高性能
    const pathPromises = matchingNodes.map(async node => {
      const cacheKey = `path:${node.id}`;
      let nodePath: IssueTreeNode[];
      
      // 检查缓存
      if (this.pathCache.has(cacheKey)) {
        nodePath = this.pathCache.get(cacheKey)!;
      } else {
        nodePath = this.buildPathToNode(node.id);
        // 缓存结果
        this.pathCache.set(cacheKey, nodePath);
      }
      
      return {
        path: nodePath,
        targetNodeId: node.id
      };
    });
    
    // 等待所有路径构建完成
    const paths = await Promise.all(pathPromises);

    return {
      targetFileUri: fileUri,
      paths,
      hasAssociations: true
    };
  }

  /**
   * 根据文件路径查找所有匹配的节点
   * @param nodes 节点数组
   * @param filePath 文件相对路径
   * @returns 匹配的节点数组
   */
  private findNodesByFilePath(nodes: IssueTreeNode[], filePath: string): IssueTreeNode[] {
    // 优化：使用迭代而非递归，避免大型树结构中的堆栈溢出风险
    const matches: IssueTreeNode[] = [];
    
    // 如果路径为空，直接返回空数组
    if (!filePath) {
      return matches;
    }
    
    // 使用队列进行广度优先搜索，比递归更高效
    const queue: IssueTreeNode[] = [...nodes];
    
    while (queue.length > 0) {
      const node = queue.shift();
      
      if (!node) {
        continue;
      }
      
      // 检查当前节点是否匹配
      if (node.filePath === filePath) {
        matches.push(node);
      }
      
      // 将子节点添加到队列
      if (node.children && node.children.length > 0) {
        queue.push(...node.children);
      }
    }
    
    return matches;
  }

  /**
   * 构建从根节点到指定节点的完整路径
   * @param nodeId 目标节点ID
   * @returns 路径节点数组
   */
  private buildPathToNode(nodeId: string): IssueTreeNode[] {
    if (!this.treeData) {
      return [];
    }

    // 优化：使用Map缓存节点的父节点关系，避免重复遍历
    const parentMap = new Map<string, { node: IssueTreeNode, parent: IssueTreeNode | null }>();
    
    // 构建父节点映射
    const buildParentMap = (nodes: IssueTreeNode[], parent: IssueTreeNode | null) => {
      for (const node of nodes) {
        parentMap.set(node.id, { node, parent });
        
        if (node.children && node.children.length > 0) {
          buildParentMap(node.children, node);
        }
      }
    };
    
    buildParentMap(this.treeData.rootNodes, null);
    
    // 从目标节点向上构建路径
    const path: IssueTreeNode[] = [];
    let current = parentMap.get(nodeId);
    
    if (!current) {
      return path; // 节点不存在
    }
    
    // 将当前节点添加到路径
    path.unshift(current.node);
    
    // 向上遍历父节点
    while (current && current.parent) {
      current = parentMap.get(current.parent.id);
      if (current) {
        path.unshift(current.node);
      }
    }
    
    return path;
  }

  /**
   * 刷新数据
   */
  async refresh(): Promise<void> {
    // 清除缓存
    this.pathCache.clear();
    this.nodeCache.clear();
    
    // 重新加载树数据
    await this.loadTreeData();
  }
}