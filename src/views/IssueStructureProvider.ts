import * as vscode from 'vscode';
import * as path from 'path';
import { getIssueDir } from '../config';
import { getTitle, getFrontmatter, FrontmatterData } from '../utils/markdown';

/**
 * 问题结构节点
 */
export interface IssueStructureNode {
    id: string;
    filePath: string;
    title: string;
    children: IssueStructureNode[];
    isCurrentFile: boolean;
    hasError: boolean;
    errorMessage?: string;
}

/**
 * 缓存节点信息，包含修改时间用于失效检查
 */
interface CachedNodeInfo {
    node: IssueStructureNode;
    lastModified: number; // 文件最后修改时间戳
}

/**
 * 问题结构视图提供者
 * 基于 frontmatter 中的 root_file、parent_file、children_files 字段构建树状结构
 */
export class IssueStructureProvider implements vscode.TreeDataProvider<IssueStructureNode>, vscode.Disposable {
    private _onDidChangeTreeData: vscode.EventEmitter<IssueStructureNode | undefined | null | void> = new vscode.EventEmitter<IssueStructureNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<IssueStructureNode | undefined | null | void> = this._onDidChangeTreeData.event;

    private currentActiveFile: string | null = null;
    private rootNodes: IssueStructureNode[] = [];
    private viewTitle: string = '问题结构';
    private nodeCache: Map<string, CachedNodeInfo> = new Map(); // 持久化缓存

    constructor(private context: vscode.ExtensionContext) {
        // 监听编辑器激活文件变化
        this.context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(editor => {
                this.onActiveEditorChanged(editor);
            })
        );

        // 监听文件系统变化，用于缓存失效
        this.setupFileWatcher();

        // 初始化时检查当前激活的编辑器
        this.onActiveEditorChanged(vscode.window.activeTextEditor);
    }

    /**
     * 设置文件监听器，当 Markdown 文件变化时清除相关缓存
     */
    private setupFileWatcher(): void {
        const issueDir = getIssueDir();
        if (issueDir) {
            const watcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(issueDir, '**/*.md')
            );

            // 文件内容变化时清除对应缓存
            watcher.onDidChange(uri => {
                this.invalidateFileCache(path.basename(uri.fsPath));
            });

            // 文件删除时清除对应缓存
            watcher.onDidDelete(uri => {
                this.invalidateFileCache(path.basename(uri.fsPath));
            });

            this.context.subscriptions.push(watcher);
        }
    }

    /**
     * 使指定文件的缓存失效
     */
    private invalidateFileCache(fileName: string): void {
        if (this.nodeCache.has(fileName)) {
            this.nodeCache.delete(fileName);
            console.log(`缓存失效: ${fileName}`);
            
            // 如果当前视图涉及到这个文件，则刷新视图
            if (this.currentActiveFile && this.isFileRelatedToCurrent(fileName)) {
                this.refresh();
            }
        }
    }

    /**
     * 检查指定文件是否与当前视图相关
     */
    private isFileRelatedToCurrent(fileName: string): boolean {
        // 简单检查：如果是当前激活文件或在当前结构中，则相关
        return fileName === this.currentActiveFile || this.findNodeInCurrent(fileName) !== null;
    }

    /**
     * 在当前结构中查找指定文件的节点
     */
    private findNodeInCurrent(fileName: string): IssueStructureNode | null {
        const findInNodes = (nodes: IssueStructureNode[]): IssueStructureNode | null => {
            for (const node of nodes) {
                if (node.filePath === fileName) {
                    return node;
                }
                const found = findInNodes(node.children);
                if (found) {
                    return found;
                }
            }
            return null;
        };
        
        return findInNodes(this.rootNodes);
    }

    /**
     * 当激活编辑器改变时调用
     */
    private async onActiveEditorChanged(editor: vscode.TextEditor | undefined): Promise<void> {
        if (!editor || editor.document.languageId !== 'markdown') {
            this.clearView();
            return;
        }

        const issueDir = getIssueDir();
        if (!issueDir || !editor.document.uri.fsPath.startsWith(issueDir)) {
            this.clearView();
            return;
        }

        // 检查文件是否有有效的 frontmatter
        const frontmatter = await getFrontmatter(editor.document.uri);
        if (!frontmatter || !frontmatter.root_file) {
            this.showGuidanceMessage();
            return;
        }

        this.currentActiveFile = path.basename(editor.document.uri.fsPath);
        await this.buildStructureFromActiveFile(frontmatter);
    }

    /**
     * 清空视图
     */
    private clearView(): void {
        this.currentActiveFile = null;
        this.rootNodes = [];
        this.viewTitle = '问题结构';
        this.updateViewTitle();
        this._onDidChangeTreeData.fire();
    }

    /**
     * 显示引导信息
     */
    private showGuidanceMessage(): void {
        this.currentActiveFile = null;
        this.rootNodes = [{
            id: 'guidance',
            filePath: '',
            title: '请打开一篇已结构化的文档以查看其问题结构',
            children: [],
            isCurrentFile: false,
            hasError: false
        }];
        this.viewTitle = '问题结构';
        this.updateViewTitle();
        this._onDidChangeTreeData.fire();
    }

    /**
     * 从当前激活文件构建结构
     */
    private async buildStructureFromActiveFile(frontmatter: FrontmatterData): Promise<void> {
        const issueDir = getIssueDir();
        if (!issueDir || !frontmatter.root_file) {
            return;
        }

        const rootFilePath = path.join(issueDir, frontmatter.root_file);
        const rootUri = vscode.Uri.file(rootFilePath);

        try {
            // 检查根文件是否存在
            await vscode.workspace.fs.stat(rootUri);
            
            // 获取根文件标题并更新视图标题
            const rootTitle = await getTitle(rootUri);
            this.viewTitle = `问题结构: ${rootTitle}`;
            this.updateViewTitle();

            // 构建树结构，使用持久化缓存和会话缓存
            const visited = new Set<string>();
            const sessionCache = new Map<string, IssueStructureNode>(); // 会话级缓存，避免同次构建中的重复计算
            const rootNode = await this.buildNodeRecursively(frontmatter.root_file, visited, this.nodeCache, sessionCache);
            this.rootNodes = rootNode ? [rootNode] : [];
            
            this._onDidChangeTreeData.fire();
        } catch (error) {
            console.error(`根文件不存在: ${rootFilePath}`, error);
            this.rootNodes = [{
                id: 'error',
                filePath: '',
                title: `根文件不存在: ${frontmatter.root_file}`,
                children: [],
                isCurrentFile: false,
                hasError: true,
                errorMessage: `根文件不存在: ${frontmatter.root_file}`
            }];
            this.viewTitle = '问题结构: 错误';
            this.updateViewTitle();
            this._onDidChangeTreeData.fire();
        }
    }

    /**
     * 递归构建节点，使用缓存避免重复计算，并检查文件修改时间
     * @param fileName 文件名
     * @param visited 访问标记集合，用于循环引用检测
     * @param nodeCache 持久化节点缓存，包含修改时间信息
     * @param sessionCache 会话级缓存，避免同一次构建中的重复计算
     */
    private async buildNodeRecursively(
        fileName: string, 
        visited: Set<string>, 
        nodeCache: Map<string, CachedNodeInfo>,
        sessionCache: Map<string, IssueStructureNode>
    ): Promise<IssueStructureNode | null> {
        // 首先检查会话缓存，避免同次构建中的重复计算
        if (sessionCache.has(fileName)) {
            const cachedNode = sessionCache.get(fileName)!;
            console.log(`会话缓存命中: ${fileName}`);
            return {
                ...cachedNode,
                isCurrentFile: fileName === this.currentActiveFile
            };
        }

        const issueDir = getIssueDir();
        if (!issueDir) {
            return null;
        }

        const filePath = path.join(issueDir, fileName);
        const fileUri = vscode.Uri.file(filePath);

        // 获取文件修改时间
        let currentModTime = 0;
        try {
            const stat = await vscode.workspace.fs.stat(fileUri);
            currentModTime = stat.mtime;
        } catch {
            // 文件不存在，继续处理
        }

        // 检查缓存中是否已存在该节点且未过期
        if (nodeCache.has(fileName)) {
            const cachedInfo = nodeCache.get(fileName)!;
            if (cachedInfo.lastModified === currentModTime) {
                // 缓存未过期，返回缓存节点（更新当前文件状态）
                return {
                    ...cachedInfo.node,
                    isCurrentFile: fileName === this.currentActiveFile
                };
            } else {
                // 缓存已过期，删除缓存
                nodeCache.delete(fileName);
                console.log(`缓存过期，重新构建: ${fileName}`);
            }
        }

        // 检测循环引用
        if (visited.has(fileName)) {
            const errorNode: IssueStructureNode = {
                id: fileName,
                filePath: fileName,
                title: `循环引用: ${fileName}`,
                children: [],
                isCurrentFile: fileName === this.currentActiveFile,
                hasError: true,
                errorMessage: '检测到循环引用'
            };
            // 缓存错误节点到持久化缓存
            nodeCache.set(fileName, {
                node: errorNode,
                lastModified: currentModTime
            });
            
            // 添加到会话缓存
            sessionCache.set(fileName, errorNode);
            
            return errorNode;
        }

        visited.add(fileName);

        try {
            // 检查文件是否存在
            await vscode.workspace.fs.stat(fileUri);
            
            // 获取文件标题
            const title = await getTitle(fileUri);
            
            // 获取 frontmatter
            const frontmatter = await getFrontmatter(fileUri);
            const childrenFiles = frontmatter?.children_files || [];

            // 递归构建子节点
            const children: IssueStructureNode[] = [];
            for (const childFileName of childrenFiles) {
                const childNode = await this.buildNodeRecursively(childFileName, visited, nodeCache, sessionCache);
                if (childNode) {
                    children.push(childNode);
                }
            }

            visited.delete(fileName);

            const node: IssueStructureNode = {
                id: fileName,
                filePath: fileName,
                title,
                children,
                isCurrentFile: fileName === this.currentActiveFile,
                hasError: false
            };

            // 缓存节点到持久化缓存
            nodeCache.set(fileName, {
                node,
                lastModified: currentModTime
            });
            
            // 添加到会话缓存
            sessionCache.set(fileName, node);
            
            return node;

        } catch (error) {
            visited.delete(fileName);
            const errorNode: IssueStructureNode = {
                id: fileName,
                filePath: fileName,
                title: `文件未找到: ${fileName}`,
                children: [],
                isCurrentFile: fileName === this.currentActiveFile,
                hasError: true,
                errorMessage: '文件不存在'
            };
            // 缓存错误节点到持久化缓存
            nodeCache.set(fileName, {
                node: errorNode,
                lastModified: currentModTime
            });
            
            // 添加到会话缓存
            sessionCache.set(fileName, errorNode);
            
            return errorNode;
        }
    }

    /**
     * 更新视图标题
     */
    private updateViewTitle(): void {
        vscode.commands.executeCommand('setContext', 'issueManager.structureViewTitle', this.viewTitle);
    }

    /**
     * 手动刷新视图，清空缓存
     */
    public refresh(): void {
        // 清空缓存以确保获取最新数据
        this.nodeCache.clear();
        console.log('手动刷新，清空所有缓存');
        this.onActiveEditorChanged(vscode.window.activeTextEditor);
    }

    getTreeItem(element: IssueStructureNode): vscode.TreeItem {
        // 处理引导信息节点
        if (element.id === 'guidance') {
            const item = new vscode.TreeItem(element.title, vscode.TreeItemCollapsibleState.None);
            item.id = element.id;
            item.contextValue = 'guidance';
            return item;
        }

        // 处理错误节点
        if (element.hasError) {
            const item = new vscode.TreeItem(element.title, vscode.TreeItemCollapsibleState.None);
            item.id = element.id;
            item.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
            item.tooltip = element.errorMessage;
            item.contextValue = 'errorNode';
            return item;
        }

        // 处理正常节点
        const collapsibleState = element.children.length > 0 
            ? vscode.TreeItemCollapsibleState.Expanded 
            : vscode.TreeItemCollapsibleState.None;

        const item = new vscode.TreeItem(element.title, collapsibleState);
        item.id = element.id;
        item.description = element.filePath;
        item.tooltip = new vscode.MarkdownString(`**${element.title}**\n\n文件名: \`${element.filePath}\``);
        
        // 设置资源URI以支持点击打开
        const issueDir = getIssueDir();
        if (issueDir) {
            item.resourceUri = vscode.Uri.file(path.join(issueDir, element.filePath));
        }

        // 高亮当前激活的文件
        if (element.isCurrentFile) {
            item.iconPath = new vscode.ThemeIcon('arrow-right', new vscode.ThemeColor('list.highlightForeground'));
        }

        // 设置点击命令
        item.command = {
            command: 'vscode.open',
            title: '打开文件',
            arguments: [item.resourceUri]
        };

        item.contextValue = 'structureNode';
        return item;
    }

    getChildren(element?: IssueStructureNode): vscode.ProviderResult<IssueStructureNode[]> {
        if (element) {
            return element.children;
        }
        return this.rootNodes;
    }

    /**
     * 获取父节点（支持 reveal 操作）
     */
    getParent(element: IssueStructureNode): IssueStructureNode | null {
        // 在树中查找父节点
        const findParent = (node: IssueStructureNode, target: IssueStructureNode): IssueStructureNode | null => {
            if (node.children.some(child => child.id === target.id)) {
                return node;
            }
            for (const child of node.children) {
                const parent = findParent(child, target);
                if (parent) {
                    return parent;
                }
            }
            return null;
        };

        for (const root of this.rootNodes) {
            const parent = findParent(root, element);
            if (parent) {
                return parent;
            }
        }
        return null;
    }

    /**
     * 清理资源
     */
    dispose(): void {
        // TreeDataProvider 接口实现通常不需要特殊清理
        // 但为了符合 VS Code 的 Disposable 接口要求，提供此方法
    }
}
