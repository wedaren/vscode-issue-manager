/**
 * 关联问题视图数据提供者 RelatedIssuesProvider
 * 只读视图，动态展示某问题在知识库中的所有引用及上下文
 */
import * as vscode from 'vscode';
import { readTree, TreeData, IssueTreeNode } from '../data/treeManager';
import { getTitle } from '../utils/markdown';
import { getUri } from '../utils/fileUtils';

export class RelatedIssuesProvider implements vscode.TreeDataProvider<RelatedIssueNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<RelatedIssueNode | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private contextUri: vscode.Uri | undefined;
    private treeData: TreeData | null = null;

    /** 切换当前分析的问题 */
    updateContext(resourceUri?: vscode.Uri) {
        if (resourceUri) {
            this.contextUri = resourceUri;
            this.refresh();
        }
    }

    /** 刷新视图 */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /** 获取根节点 */
    async getChildren(element?: RelatedIssueNode): Promise<RelatedIssueNode[]> {
        if (!this.contextUri) {
            return [];
        }
        if (!this.treeData) {
            this.treeData = await readTree();
        }
        if (!element) {
            // 查找所有引用该文件的节点
            return this.findAllReferences(this.contextUri);
        }
        // 返回子节点
        return element.children || [];
    }

    /** 查找所有引用该文件的节点 */
    private async findAllReferences(resourceUri: vscode.Uri): Promise<RelatedIssueNode[]> {
        const nodes: RelatedIssueNode[] = [];
        const traverse = async (node: IssueTreeNode, parentNodes: IssueTreeNode[] = []) => {
            if (node.resourceUri?.fsPath === resourceUri.fsPath) {
                // 构建引用上下文树
                nodes.push(await this.buildReferenceNode(node, parentNodes));
            }
            if (node.children) {
                for (const child of node.children) {
                    await traverse(child, [...parentNodes, node]);
                }
            }
        };
        if (this.treeData) {
            for (const root of this.treeData.rootNodes || []) {
                await traverse(root, []);
            }
        }
        return nodes;
    }

    /** 构建单个引用节点的上下文树 */
    private async buildReferenceNode(node: IssueTreeNode, parentNodes: IssueTreeNode[]): Promise<RelatedIssueNode> {
        // 父路径（祖先链）
        const parentIssueNode = parentNodes.pop();
        const parentTitles = await Promise.all(parentNodes.map(n => n.resourceUri ? getTitle(n.resourceUri) : (n.filePath || '')));
        // 辅助方法：获取节点标题
        const getNodeTitle = async (n: IssueTreeNode) => {
            return getTitle(n.resourceUri || getUri(n.filePath));
        };

        const parentNode: RelatedIssueNode | undefined = parentIssueNode ? {
            label: await getNodeTitle(parentIssueNode),
            type: 'parent',
            tooltip: (await Promise.all(parentNodes.map(getNodeTitle))).join(' / '),
            resourceUri: parentIssueNode.resourceUri,
        } : undefined;

        // 当前问题
        const currentNode: RelatedIssueNode = {
            label: await getNodeTitle(node),
            type: 'current',
            resourceUri: node.resourceUri,
            children: [],
        };

        // 同级节点
        let siblings: RelatedIssueNode[] = [];
        if (parentIssueNode) {
            const siblingPromises = (parentIssueNode.children || [])
            .filter((s: IssueTreeNode) => s.id !== node.id)
            .map(async (s: IssueTreeNode) => ({
                label: await getNodeTitle(s),
                type: 'sibling' as const,
                resourceUri: s.resourceUri,
                children: [],
            }));
            siblings = await Promise.all(siblingPromises);
        }

        // 子节点
        const childPromises = (node.children || []).map(async (c: IssueTreeNode) => ({
            label: await getNodeTitle(c),
            type: 'child' as const,
            resourceUri: c.resourceUri,
            children: [],
        }));
        const children: RelatedIssueNode[] = await Promise.all(childPromises);

        if (parentNode) {
            const result: RelatedIssueNode = {
            label: parentNode.label,
            type: 'parent',
            tooltip: parentNode.tooltip,
            resourceUri: parentNode.resourceUri,
            children: [
                currentNode,
                ...siblings,
                ...(children.length > 0 ? children : []),
            ],
            };
            return result;
        } else {
            currentNode.type = 'current';
            currentNode.children = children;
            return currentNode;
        }
    }

    /** 渲染 TreeItem */
    getTreeItem(element: RelatedIssueNode): vscode.TreeItem {
        const item = new vscode.TreeItem(element.label, element.children && element.children.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
        item.tooltip = element.tooltip;
        item.iconPath = element.type === 'current' ? new vscode.ThemeIcon('eye') : undefined;
        item.description = element.type === 'parent' ? element.tooltip : '';
        item.command = element.resourceUri ? {
            command: 'vscode.open',
            title: '打开问题',
            arguments: [element.resourceUri]
        } : undefined;
        return item;
    }
}

/**
 * 关联问题节点类型
 */
export interface RelatedIssueNode {
    label: string;
    type: 'parent' | 'current' | 'sibling' | 'child';
    tooltip?: string;
    icon?: string;
    resourceUri?: vscode.Uri;
    children?: RelatedIssueNode[];
}
