import { IssueNode } from '../data/issueTreeManager';

/**
 * 类型守卫：判断对象是否为 IssueNode
 * 目的：避免在多个文件中重复实现相同的检查逻辑
 */
export function isIssueTreeNode(item: unknown): item is IssueNode {
    return !!item && typeof item === 'object' && 'id' in item && 'filePath' in item;
}

export default isIssueTreeNode;
