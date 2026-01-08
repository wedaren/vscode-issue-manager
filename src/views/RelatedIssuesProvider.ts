/**
 * 关联问题视图数据提供者 RelatedIssuesProvider
 * 只读视图，动态展示某问题在知识库中的所有引用及上下文
 */
import * as vscode from 'vscode';
import { readTree, TreeData, IssueTreeNode, getIssueNodeContextValue } from '../data/issueTreeManager';
import { getIssueMarkdownTitle, findNotesLinkedToFile } from '../data/IssueMarkdowns';

export class RelatedIssuesProvider implements vscode.TreeDataProvider<RelatedIssueNode>, vscode.Disposable {
    private _onDidChangeTreeData = new vscode.EventEmitter<RelatedIssueNode | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private contextUri: vscode.Uri | undefined;
    private treeData: TreeData | null = null;
    private disposables: vscode.Disposable[] = [];
    
    constructor(private context: vscode.ExtensionContext) {
    }

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
        if (!element) {
            // 查找所有引用该文件的节点（包括 tree.json 中的引用与 frontmatter 中的关联）
            const treeRefs = await this.findAllReferences(this.contextUri);
            const fmNotes = await findNotesLinkedToFile(this.contextUri);
            const fmNodes: RelatedIssueNode[] = [];
            for (const note of fmNotes) {
                const label = await getIssueMarkdownTitle(note.uri);
                fmNodes.push({
                    label,
                    type: 'external',
                    filePath: note.uri.fsPath,
                    children: [],
                    resourceUri: note.uri,
                    id: note.uri.toString() + ':fm',
                    contextValue: await getIssueNodeContextValue(note.uri.toString(), 'issueNode'),
                } as RelatedIssueNode);
            }
            return [...treeRefs, ...fmNodes];
        }
        // 返回子节点
        return element.children || [];
    }

    /** 查找所有引用该文件的节点 */
    private async findAllReferences(resourceUri: vscode.Uri): Promise<RelatedIssueNode[]> {
        this.treeData = await readTree();
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
        // 辅助方法：获取节点标题（缓存优先，未命中回退为文件名）
        const getNodeTitle = async (n: IssueTreeNode) => {
            return getIssueMarkdownTitle(n.filePath);
        };

        const parentNode: RelatedIssueNode | undefined = parentIssueNode ? {
            label: await getNodeTitle(parentIssueNode),
            type: 'parent',
            filePath: parentIssueNode.filePath,
            children: [],
            tooltip: (await Promise.all(parentNodes.map(n => getIssueMarkdownTitle(n.filePath)))).join(' / '),
            resourceUri: parentIssueNode.resourceUri,
            id: parentIssueNode.id,
            contextValue: await getIssueNodeContextValue(parentIssueNode.id, 'issueNode'),
        } : undefined;

        // 当前问题
        const currentNode: RelatedIssueNode = {
            label: await getNodeTitle(node),
            type: 'current',
            filePath: node.filePath,
            resourceUri: node.resourceUri,
            id: node.id,
            contextValue: await getIssueNodeContextValue(node.id, 'issueNode'),
            children: node.children ? await Promise.all(node.children.map(async (child: IssueTreeNode) => ({
                label: await getNodeTitle(child),
                type: 'child',
                filePath: child.filePath,
                children: [],
                resourceUri: child.resourceUri,
                id: child.id,
                contextValue: await getIssueNodeContextValue(child.id, 'issueNode'),
            }))) : [],
        };

        // 已移除同级节点 siblings 相关逻辑，提升代码可读性与维护性

        if (parentNode) {
            const result: RelatedIssueNode = {
            label: parentNode.label,
            type: 'parent',
            filePath: parentNode.filePath,
            tooltip: parentNode.tooltip,
            id: parentNode.id,
            resourceUri: parentNode.resourceUri,
            contextValue: parentNode.contextValue,
            children: [
                currentNode,
                // ...siblings
            ],
            };
            return result;
        } else {
            currentNode.type = 'current';
            return currentNode;
        }
    }

    /** 渲染 TreeItem */
    async getTreeItem(element: RelatedIssueNode): Promise<vscode.TreeItem> {
        const item = new vscode.TreeItem(element.label, element.children && element.children.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
        item.tooltip = element.tooltip;
        item.iconPath = element.type === 'current' ? new vscode.ThemeIcon('eye') : (element.type === 'external' ? new vscode.ThemeIcon('link-external') : undefined);
        item.description = element.type === 'parent' ? element.tooltip : '';
        
        // 使用缓存的 contextValue 或计算新的 contextValue
        item.contextValue = element.contextValue ?? await getIssueNodeContextValue(element.id, 'issueNode');
        item.id = element.id;
        item.resourceUri = element.resourceUri;
        
        item.command = element.resourceUri ? {
            command: 'issueManager.openAndRevealIssue',
            title: '打开并定位问题',
            arguments: [element, 'overview']
        } : undefined;
        return item;
    }

    /** 释放资源 */
    public dispose(): void {
        // 释放事件发射器
        this._onDidChangeTreeData.dispose();
        // 释放所有订阅的事件监听器
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}

/**
 * 相关联问题节点类型
 */
export interface RelatedIssueNode extends IssueTreeNode{
    label: string;
    type: 'parent' | 'current' | 'sibling' | 'child' | 'external';
    tooltip?: string;
    icon?: string;
    children: RelatedIssueNode[];
    contextValue?: string; // 缓存的上下文值，用于优化性能
}
