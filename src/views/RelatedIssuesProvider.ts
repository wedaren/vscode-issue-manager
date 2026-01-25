/**
 * 关联问题视图数据提供者 RelatedIssuesProvider
 * 只读视图，动态展示某问题在知识库中的所有引用及上下文
 */
import * as vscode from 'vscode';
import { readTree, TreeData, IssueNode, getIssueNodeContextValue, onIssueTreeUpdate, getIssueNodeIconPath } from '../data/issueTreeManager';
import { findNotesLinkedToFile, findNotesLinkedToWorkspace, getIssueMarkdownContextValues, getIssueMarkdown } from '../data/IssueMarkdowns';

export class RelatedIssuesProvider implements vscode.TreeDataProvider<RelatedIssueNode>, vscode.Disposable {
    private _onDidChangeTreeData = new vscode.EventEmitter<RelatedIssueNode | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private treeData: TreeData | null = null;
    private contextUri: vscode.Uri | undefined;
    
    private disposables: vscode.Disposable[] = [];
    
    constructor(private context: vscode.ExtensionContext) {
        onIssueTreeUpdate(this.refresh, this, this.disposables);
        this.contextUri = vscode.window.activeTextEditor?.document.uri;
    }

    /** 设置上下文 URI 并刷新视图 */  
    setContextUri(uri: vscode.Uri | undefined): void {  
        this.contextUri = uri;  
        this.refresh();  
    }  

    /** 刷新视图 */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /** 获取根节点 */
    async getChildren(element?: RelatedIssueNode): Promise<RelatedIssueNode[]> {
        const ctx = this.contextUri;
        if (!ctx) {
            return [];
        }
        if (!element) {
            // 查找所有引用该文件的节点（包括 tree.json 中的引用与 frontmatter 中的关联）
            const treeRefs = await this.findAllReferences(ctx);
            const fmNotes = await findNotesLinkedToFile(ctx);
            const fmNodes: RelatedIssueNode[] = [];
            for (const note of fmNotes) {
                const md = await getIssueMarkdown(note.uri);
                const label = md ? md.title : '不合法 issueMarkdown';
                fmNodes.push({
                    label,
                    type: 'markdown',
                    icon: new vscode.ThemeIcon('markdown'),
                    filePath: note.uri.fsPath,
                    children: [],
                    parent: [],
                    resourceUri: note.uri,
                    id: note.uri.toString() + ':fm',
                    contextValue: getIssueMarkdownContextValues(),
                } as RelatedIssueNode);
            }

            // 检查当前上下文所属的 workspace（若有），并查找与 workspace 关联的 issue
            const workspaceNodes: RelatedIssueNode[] = [];
            const wsNotes = await findNotesLinkedToWorkspace(ctx);
            for (const note of wsNotes) {
                const md = await getIssueMarkdown(note.uri);
                const label = md ? md.title : '不合法 issueMarkdown';
                workspaceNodes.push({
                    label,
                    type: 'workspace',
                    filePath: note.uri.fsPath,
                    icon: new vscode.ThemeIcon('file-directory'),
                    children: [],
                    parent: [],
                    resourceUri: note.uri,
                    id: note.uri.toString() + ':ws',
                    contextValue: getIssueMarkdownContextValues(),
                } as RelatedIssueNode);
            }

            return [...treeRefs, ...fmNodes, ...workspaceNodes];
        }
        // 返回子节点
        return element.children || [];
    }

    /** 查找所有引用该文件的节点 */
    private async findAllReferences(resourceUri: vscode.Uri): Promise<RelatedIssueNode[]> {
        this.treeData = await readTree();
        const nodes: RelatedIssueNode[] = [];
        const traverse = async (node: IssueNode) => {
            if (node.resourceUri?.fsPath === resourceUri.fsPath) {
                // 构建引用上下文树（使用节点自身的 parent 字段）
                nodes.push(await this.buildReferenceNode(node));
            }
            if (node.children) {
                for (const child of node.children) {
                    await traverse(child);
                }
            }
        };
        if (this.treeData) {
            for (const root of this.treeData.rootNodes || []) {
                await traverse(root);
            }
        }
        return nodes;
    }

    /** 构建单个引用节点的上下文树 */
    private async buildReferenceNode(node: IssueNode): Promise<RelatedIssueNode> {
        // 使用节点的 parent 字段构建上下文（parent 为祖先链：从根到直接父节点）
        const parentAncestors = node.parent || [];
        const parentIssueNode = parentAncestors.length > 0 ? parentAncestors[parentAncestors.length - 1] : undefined;
        // 辅助方法：获取节点标题（缓存优先，未命中回退为文件名）
        const getNodeTitle = async (n: IssueNode) => {
            const md = await getIssueMarkdown(n.filePath);
            return md ? md.title : '不合法 issueMarkdown';
        };

        // tooltip 使用祖先链（不包含直接父节点）的标题
        const ancestorList = parentAncestors.length > 1 ? parentAncestors.slice(0, -1) : [];

        const parentNode: RelatedIssueNode | undefined = parentIssueNode ? {
            label: await getNodeTitle(parentIssueNode),
            type: 'parent',
            filePath: parentIssueNode.filePath,
            parent: parentIssueNode.parent,
            children: [],
            tooltip: (await Promise.all(ancestorList.map(async n => {
                const md = await getIssueMarkdown(n.filePath);
                return md ? md.title : '不合法 issueMarkdown';
            }))).join(' / '),
            resourceUri: parentIssueNode.resourceUri,
            id: parentIssueNode.id,
            contextValue: await getIssueNodeContextValue(parentIssueNode.id, 'issueNode'),
        } : undefined;

        // 当前问题
        const currentNode: RelatedIssueNode = {
            label: await getNodeTitle(node),
            type: 'current',
            icon: new vscode.ThemeIcon('eye', new vscode.ThemeColor('charts.blue')),
            filePath: node.filePath,
            resourceUri: node.resourceUri,
            id: node.id,
            parent: node.parent,
            contextValue: await getIssueNodeContextValue(node.id, 'issueNode'),
            children: node.children ? await Promise.all(node.children.map(async (child: IssueNode) => ({
                ...child,
                label: await getNodeTitle(child),
                type: 'child',
                children: [],
                contextValue: await getIssueNodeContextValue(child.id, 'issueNode'),
            }))) : [],
        };

        if (parentNode) {
            const result: RelatedIssueNode = {
                label: parentNode.label,
                type: 'parent',
                filePath: parentNode.filePath,
                tooltip: parentNode.tooltip,
                parent: parentNode.parent,
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
            currentNode.icon = new vscode.ThemeIcon('eye', new vscode.ThemeColor('charts.blue'));
            return currentNode;
        }
    }

    /** 渲染 TreeItem */
    async getTreeItem(element: RelatedIssueNode): Promise<vscode.TreeItem> {
        const item = new vscode.TreeItem(element.label, element.children && element.children.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
        item.tooltip = element.tooltip;
        item.iconPath = element.icon || await getIssueNodeIconPath(element.id);
        item.description = element.type === 'parent' ? element.tooltip : '';
        
        // 使用缓存的 contextValue 或计算新的 contextValue
        item.contextValue = element.contextValue ?? await getIssueNodeContextValue(element.id, 'issueNode');
        item.id = element.id;
        item.resourceUri = element.resourceUri;
        if(element.type === 'markdown' || element.type === 'workspace'){
            item.command = {
                command: 'vscode.open',
                title: '在侧边打开关联笔记',
                arguments: [element.resourceUri, { viewColumn: vscode.ViewColumn.Beside }]
            };
        } else {
            item.command = element.resourceUri ? {
                command: 'issueManager.openAndRevealIssue',
                title: '打开并定位问题',
                arguments: [element, 'overview']
            } : undefined;
        }
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
export interface RelatedIssueNode extends IssueNode{
    label: string;
    type: 'parent' | 'current' | 'sibling' | 'child' | 'markdown' | 'workspace' | 'git-branch';
    tooltip?: string;
    icon?: vscode.ThemeIcon;
    children: RelatedIssueNode[];
    contextValue?: string;
}
