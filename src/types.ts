/**
 * 共享类型定义文件
 * 
 * 包含在多个模块间共享的类型定义和类型守卫函数
 */

import { ParaCategory } from './data/paraManager';
import { IssueTreeNode } from './data/treeManager';

/**
 * PARA 视图节点类型
 * 
 * 用于 PARA 视图中的树节点表示,支持两种类型:
 * - category: 分类节点 (Projects/Areas/Resources/Archives)
 * - issue: 问题节点
 */
export type ParaViewNode = 
  | { type: 'category'; category: ParaCategory }
  | { 
      type: 'issue'; 
      id: string; 
      category: ParaCategory; 
      treeNode: IssueTreeNode; 
      isTopLevel?: boolean; // 可选属性,用于标识是否为顶层问题
      indexInCategory?: number; // 可选: 在所属分类中的 1-based 序号，仅用于渲染
    };

/**
 * 类型守卫函数:检查是否为 PARA 分类节点
 * @param item 要检查的对象
 * @returns 如果是分类节点则返回 true
 */
export function isParaCategoryNode(item: unknown): item is { type: 'category'; category: ParaCategory } {
  return (
    !!item && 
    typeof item === 'object' && 
    'type' in item && 
    item.type === 'category' &&
    'category' in item &&
    typeof item.category === 'string'
  );
}

/**
 * 类型守卫函数:检查是否为 PARA 问题节点
 * @param item 要检查的对象
 * @returns 如果是问题节点则返回 true
 */
export function isParaIssueNode(item: unknown): item is { 
  type: 'issue'; 
  id: string; 
  category: ParaCategory; 
  treeNode: IssueTreeNode;
  isTopLevel?: boolean;
  indexInCategory?: number;
} {
  return (
    !!item && 
    typeof item === 'object' && 
    'type' in item && 
    item.type === 'issue' &&
    'id' in item &&
    typeof item.id === 'string' &&
    'category' in item &&
    typeof item.category === 'string' &&
    'treeNode' in item &&
    !!item.treeNode &&
    typeof item.treeNode === 'object'
  );
}

/**
 * 类型守卫函数:检查是否为任意类型的 ParaViewNode
 * @param item 要检查的对象
 * @returns 如果是 ParaViewNode 则返回 true
 */
export function isParaViewNode(item: unknown): item is ParaViewNode {
  return isParaCategoryNode(item) || isParaIssueNode(item);
}
