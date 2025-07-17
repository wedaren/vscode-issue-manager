import * as vscode from 'vscode';
import { IssueTreeNode } from '../data/treeManager';

/**
 * 关联节点接口，表示关联视图中的节点数据结构
 */
export interface AssociationNode {
  /** 唯一标识符 */
  id: string;
  
  /** 节点类型：路径节点、问题节点或加载状态节点 */
  type: 'path' | 'issue' | 'loading' | 'empty' | 'error';
  
  /** 显示标签 */
  label: string;
  
  /** 问题文件路径（仅问题节点） */
  filePath?: string;
  
  /** 资源URI（仅问题节点） */
  resourceUri?: vscode.Uri;
  
  /** 在问题总览中的节点ID（用于定位） */
  treeNodeId?: string;
  
  /** 子节点 */
  children: AssociationNode[];
  
  /** 路径索引（用于排序） */
  pathIndex?: number;
}

/**
 * 关联路径接口，表示从根到目标问题的完整路径
 */
export interface AssociationPath {
  /** 从根到目标问题的完整路径 */
  path: IssueTreeNode[];
  
  /** 目标节点在问题总览中的ID */
  targetNodeId: string;
}

/**
 * 关联查找结果接口
 */
export interface AssociationResult {
  /** 目标文件URI */
  targetFileUri: vscode.Uri;
  
  /** 关联路径数组 */
  paths: AssociationPath[];
  
  /** 是否找到关联 */
  hasAssociations: boolean;
}

/**
 * 关联错误类型
 */
export enum AssociationErrorType {
  /** 文件不在问题目录内 */
  FILE_NOT_IN_ISSUE_DIR = 'FILE_NOT_IN_ISSUE_DIR',
  
  /** 文件未在问题总览中关联 */
  FILE_NOT_ASSOCIATED = 'FILE_NOT_ASSOCIATED',
  
  /** 问题目录未配置 */
  ISSUE_DIR_NOT_CONFIGURED = 'ISSUE_DIR_NOT_CONFIGURED',
  
  /** 数据加载失败 */
  DATA_LOAD_FAILED = 'DATA_LOAD_FAILED'
}

/**
 * 关联错误接口
 */
export interface AssociationError {
  type: AssociationErrorType;
  message: string;
  details?: string;
}

/**
 * 缓存的关联数据接口
 */
export interface CachedAssociationData {
  /** 关联节点数据 */
  nodes: AssociationNode[];
  
  /** 缓存创建时间 */
  timestamp: number;
  
  /** 数据哈希值，用于检测数据变化 */
  dataHash: string;
  
  /** 文件最后修改时间 */
  fileModTime?: number;
  
  /** 访问次数（用于LRU） */
  accessCount: number;
}