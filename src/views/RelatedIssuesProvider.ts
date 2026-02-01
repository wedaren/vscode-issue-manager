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
    private pinnedNodes: Set<string> = new Set();
    // 缓存所有 pin 过的节点数据，key 是节点 id
    private pinnedNodesCache: Map<string, RelatedIssueNode> = new Map();
    
    private disposables: vscode.Disposable[] = [];
    
    constructor(private context: vscode.ExtensionContext) {
        onIssueTreeUpdate(this.refresh, this, this.disposables);
        this.contextUri = vscode.window.activeTextEditor?.document.uri;
        // Pin 状态仅在当前会话中保持，重启后清空
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
            // 即使没有上下文，也应该显示 pin 的节点
            // 确保返回的节点有完整的属性
            return Array.from(this.pinnedNodesCache.values());  
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

            // 合并当前上下文的节点
            const contextNodes = [...treeRefs, ...fmNodes, ...workspaceNodes];
            
            // 将当前上下文的节点更新到缓存中（如果它们被 pin 了）
            for (const node of contextNodes) {
                if (this.pinnedNodes.has(node.id)) {
                    this.pinnedNodesCache.set(node.id, node);
                }
            }
            
            // 从缓存中获取所有 pin 的节点
            const pinnedNodesList = Array.from(this.pinnedNodesCache.values());
            
            // 找出当前上下文中未被 pin 的节点
            const unpinnedContextNodes = contextNodes.filter(node => !this.pinnedNodes.has(node.id));
            
            // 合并：pin 的节点在前，当前上下文的未 pin 节点在后
            return [...pinnedNodesList, ...unpinnedContextNodes];
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

        const buildRelatedChildNode = async (child: IssueNode): Promise<RelatedIssueNode> => {
            const isCurrent = child.id === node.id;
            return {
                label: await getNodeTitle(child),
                type: isCurrent ? 'current' : 'child',
                icon: isCurrent ? new vscode.ThemeIcon('eye', new vscode.ThemeColor('charts.blue')) : undefined,
                filePath: child.filePath,
                resourceUri: child.resourceUri,
                id: child.id,
                parent: child.parent,
                contextValue: await getIssueNodeContextValue(child.id, 'issueNode'),
                children: [],
            };
        };

        if (parentNode) {
            const parentChildren = parentIssueNode?.children
                ? await Promise.all(parentIssueNode.children.map(buildRelatedChildNode))
                : [];
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
                    ...parentChildren,
                ],
            };
            return result;
        } else {
            const currentNode: RelatedIssueNode = {
                label: await getNodeTitle(node),
                type: 'current',
                icon: new vscode.ThemeIcon('eye', new vscode.ThemeColor('charts.blue')),
                filePath: node.filePath,
                resourceUri: node.resourceUri,
                id: node.id,
                parent: node.parent,
                contextValue: await getIssueNodeContextValue(node.id, 'issueNode'),
                children: node.children ? await Promise.all(node.children.map(buildRelatedChildNode)) : [],
            };
            return currentNode;
        }
    }

    /** 渲染 TreeItem */
    async getTreeItem(element: RelatedIssueNode): Promise<vscode.TreeItem> {
        // 确保 children 属性存在
        const children = element.children || [];
        const item = new vscode.TreeItem(
            element.label, 
            children.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None
        );
        item.tooltip = element.tooltip;
        
        // 判断是否为一级节点
        const isTopLevel = element.type === 'parent' || element.type === 'current' || 
                           element.type === 'markdown' || element.type === 'workspace';
        
        // 为一级节点设置 contextValue 和 icon
        if (isTopLevel) {
            const isPinned = this.pinnedNodes.has(element.id);
            const baseContext = element.contextValue ?? await getIssueNodeContextValue(element.id, 'issueNode');
            item.contextValue = isPinned 
                ? `${baseContext}|relatedNode|pinnedNode`
                : `${baseContext}|relatedNode`;
            
            // 如果节点被 pin，显示 pin 图标；否则使用默认图标
            if (isPinned) {
                item.iconPath = new vscode.ThemeIcon('pinned', new vscode.ThemeColor('charts.yellow'));
            } else {
                item.iconPath = element.icon || await getIssueNodeIconPath(element.id);
            }
        } else {
            item.contextValue = element.contextValue ?? await getIssueNodeContextValue(element.id, 'issueNode');
            item.iconPath = element.icon || await getIssueNodeIconPath(element.id);
        }
        
        item.description = element.type === 'parent' ? element.tooltip : '';
        // TreeItem.id 仅用于展示层去重，内部逻辑仍使用真实的 element.id
        item.id = this.buildTreeItemId(element);
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

    /**
     * 生成 TreeItem 的展示层唯一 ID。
     * 通过节点类型 + 节点 id + 祖先链组成稳定键，避免同层冲突。
     */
    private buildTreeItemId(element: RelatedIssueNode): string {
        const ancestorIds = (element.parent || []).map(parent => parent.id).join('/');
        const scope = ancestorIds.length > 0 ? `@${ancestorIds}` : '@root';
        return `ri:${element.type}:${element.id}${scope}`;
    }

    /** Pin 节点（会话级，重启后清空） */
    async pinNode(nodeId: string, nodeData: RelatedIssueNode): Promise<void> {  
        this.pinnedNodes.add(nodeId);
        // 如果提供了节点数据，确保数据完整性后缓存
        if (nodeData) {
            // 确保必需的数组属性存在
            const completeNode: RelatedIssueNode = {
                ...nodeData,
                children: nodeData.children || [],
                parent: nodeData.parent || [],
            };
            this.pinnedNodesCache.set(nodeId, completeNode);
        }
        this.refresh();
    }

    /** Unpin 节点 */
    async unpinNode(nodeId: string): Promise<void> {
        this.pinnedNodes.delete(nodeId);
        this.pinnedNodesCache.delete(nodeId);
        this.refresh();
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
