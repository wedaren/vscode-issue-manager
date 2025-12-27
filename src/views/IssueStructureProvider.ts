import * as vscode from 'vscode';
import * as path from 'path';
import { getIssueDir } from '../config';
import { getIssueMarkdownFrontmatter, FrontmatterData, getIssueMarkdownTitleFromCache } from '../data/IssueMarkdowns';
import { FrontmatterService } from '../services/FrontmatterService';
import { findParentNodeById } from '../data/issueTreeManager';
import { UnifiedFileWatcher } from '../services/UnifiedFileWatcher';
import { EditorEventManager } from '../services/EditorEventManager';

/**
 * 问题结构节点
 */
export interface IssueStructureNode {
    id: string;
    filePath: string;
    title: string;
    children: IssueStructureNode[];
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
    private currentActiveFrontmatter: FrontmatterData | null = null; // 缓存当前活动文件的 frontmatter
    private rootNodes: IssueStructureNode[] = [];
    private nodeCache: Map<string, CachedNodeInfo> = new Map(); // 持久化缓存
    private refreshDebouncer: NodeJS.Timeout | null = null; // 防抖计时器

    constructor(private context: vscode.ExtensionContext) {
        // 订阅编辑器事件管理器的 Issue 文件激活事件
        const editorEventManager = EditorEventManager.getInstance();
        const subscription = editorEventManager.onIssueFileActivated((uri) => {
            this.onIssueFileActivated(uri);
        });
        this.context.subscriptions.push(subscription);

        // 监听文件系统变化，用于缓存失效
        this.setupFileWatcher();

        // 初始化时检查当前激活的编辑器
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            this.onIssueFileActivated(activeEditor.document.uri);
        }
    }

    /**
     * 设置文件监听器，当 Markdown 文件变化时清除相关缓存
     */
    private setupFileWatcher(): void {
        const fileWatcher = UnifiedFileWatcher.getInstance(this.context);

        // 监听 Markdown 文件变化
        this.context.subscriptions.push(
            fileWatcher.onMarkdownChange(async (event) => {
                await this.handleFileSystemChange(event.fileName, event.type);
            })
        );
    }

    /**
     * 统一处理文件系统变化事件
     * 自动同步frontmatter关系并决定是否刷新视图
     */
    private async handleFileSystemChange(fileName: string, changeType: 'change' | 'create' | 'delete'): Promise<void> {
        //  清除指定文件的缓存
        if (this.nodeCache.has(fileName)) {
            this.nodeCache.delete(fileName);
            const root_file = this.currentActiveFrontmatter?.issue_root_file;
            if (root_file && this.nodeCache.has(root_file)) {
                this.nodeCache.delete(root_file);
            }
        }
        //  根据变化类型处理frontmatter同步和判断是否需要刷新
        const shouldRefresh = await this.handleFileOperation(fileName, changeType);
        
        //  如果需要刷新，执行防抖刷新
        if (shouldRefresh) {
            this.debouncedRefresh();
        }
    }

    /**
     * 统一处理文件变化事件（创建、删除、修改）
     * 基于 frontmatter 的 parent_file 和 children_files 关系自动同步
     */
    private async handleFileOperation(fileName: string, changeType: 'change' | 'create' | 'delete'): Promise<boolean> {
        const issueDir = getIssueDir();
        if (!issueDir) {
            return false;
        }

        try {
            // 对于删除操作，先处理清理逻辑
            if (changeType === 'delete') {
                const cleanupSuccess = await this.autoRemoveFromParentChildren(fileName);
                const wasInCurrentView = this.findNodeInCurrentTree(fileName) !== null;
                return cleanupSuccess || wasInCurrentView;
            }

            // 对于创建和修改操作，获取文件的 frontmatter
            const filePath = path.join(issueDir, fileName);
            const fileUri = vscode.Uri.file(filePath);
            const frontmatter = await getIssueMarkdownFrontmatter(fileUri);

            // 如果文件没有 frontmatter，检查是否与当前视图相关
            if (!frontmatter || !frontmatter.issue_root_file) {
                return changeType === 'create' ? false : await this.isFileRelatedToCurrent(fileName);
            }

            // 检查是否是当前的根文件
            if (fileName === this.currentActiveFrontmatter?.issue_root_file) {
                return true;
            }

            // 检查是否与当前结构相关（同一个 root_file）
            if (frontmatter.issue_root_file === this.currentActiveFrontmatter?.issue_root_file) {
                // 统一的 frontmatter 关系同步处理
                await this.syncFrontmatterRelations(fileName, frontmatter);

                return true;
            }

            // 对于修改操作，还需要检查文件是否在当前树结构中
            if (changeType === 'change') {
                return this.findNodeInCurrentTree(fileName) !== null;
            }

            return false;

        } catch (error) {
            console.debug(`处理文件${changeType}操作时出错 (${fileName}):`, error);
            // 错误处理策略：创建操作失败不刷新，其他操作失败则刷新
            return changeType !== 'create';
        }
    }

    /**
     * 统一的 frontmatter 关系同步处理
     * 自动维护 parent_file 和 children_files 的双向关系
     */
    private async syncFrontmatterRelations(fileName: string, frontmatter: FrontmatterData): Promise<void> {
        try {
            // 创建文件时的关系建立逻辑
            if (frontmatter.issue_parent_file) {
                // 如果新文件声明了 parent_file，自动更新父文件的 children_files
                const success = await FrontmatterService.addChildToParent(fileName, frontmatter.issue_parent_file);
                if (success && this.nodeCache.has(frontmatter.issue_parent_file)) {
                    this.nodeCache.delete(frontmatter.issue_parent_file);
                }
            } else if (this.currentActiveFile && fileName !== frontmatter.issue_root_file) {
                // 如果新文件没有 parent_file，并且它本身不是根文件，  
                // 则将其添加到当前活动文件的 children_files  
                const currentActiveFileName = path.basename(this.currentActiveFile!);
                const addChildSuccess = await FrontmatterService.addChildToParent(fileName, currentActiveFileName);
                const setParentSuccess = await FrontmatterService.setParentFile(fileName, currentActiveFileName);
                
                if ((addChildSuccess || setParentSuccess) && this.nodeCache.has(currentActiveFileName)) {
                    this.nodeCache.delete(currentActiveFileName);
                }
            }
        } catch (error) {
            console.error(`同步 frontmatter 关系时出错 (${fileName}):`, error);
        }
    }


    /**
     * 检查指定文件是否与当前视图相关
     * 基于相同的 root_file 来判断关联性，使用缓存的活动文件 frontmatter 提升性能
     */
    private async isFileRelatedToCurrent(fileName: string): Promise<boolean> {
        // 如果没有当前激活文件或缓存的 frontmatter，无法判断关联性
        if (!this.currentActiveFile || !this.currentActiveFrontmatter) {
            return false;
        }

        try {
            const issueDir = getIssueDir();
            if (!issueDir) {
                return false;
            }

            const filePath = path.join(issueDir, fileName);
            const fileUri = vscode.Uri.file(filePath);

            // 获取目标文件的 frontmatter
            const frontmatter = await getIssueMarkdownFrontmatter(fileUri);

            if (frontmatter) {  
                // 对于存在 frontmatter 的文件，通过 root_file 判断关联性  
                return frontmatter.issue_root_file === this.currentActiveFrontmatter.issue_root_file;  
            }  
            
            // 回退逻辑：对于已删除或无 frontmatter 的文件，检查它是否存在于当前视图的树结构中  
            return this.findNodeInCurrentTree(fileName) !== null;

        } catch (error) {
            console.error(`检查文件关联性时出错 (${fileName}):`, error);  
            return false;  
        }
    }

    /**
     * 获取当前树结构中的所有文件名
     */
    private getAllFilesInCurrentTree(): string[] {
        const files: string[] = [];
        
        const collectFiles = (nodes: IssueStructureNode[]) => {
            for (const node of nodes) {
                if (node.filePath && node.id !== 'guidance' && node.id !== 'error') {
                    files.push(node.filePath);
                }
                collectFiles(node.children);
            }
        };
        
        collectFiles(this.rootNodes);
        return files;
    }

    /**
     * 自动从当前视图树中的父文件的 children_files 中移除被删除的文件
     * 
     * 注意：此方法仅扫描当前显示的结构树中的文件，不会处理树外的文件。
     * 如果被删除文件的父文件不在当前视图中，其 frontmatter 不会被更新。
     * 
     * @param deletedFileName 被删除的文件名
     * @returns 是否成功更新了任何父文件的 children_files
     */
    private async autoRemoveFromParentChildren(deletedFileName: string): Promise<boolean> {
        try {
            const issueDir = getIssueDir();
            if (!issueDir) {
                return false;
            }

            // 扫描当前树结构中的所有文件
            const filesToCheck = this.getAllFilesInCurrentTree();
            let hasUpdates = false;

            for (const existingFileName of filesToCheck) {
                const existingFilePath = path.join(issueDir, existingFileName);
                const existingFileUri = vscode.Uri.file(existingFilePath);
                
                try {
                    const existingFrontmatter = await getIssueMarkdownFrontmatter(existingFileUri);
                    const childrenFiles = existingFrontmatter?.issue_children_files || [];
                    
                    // 如果当前文件的 children_files 中包含被删除的文件
                    if (childrenFiles.includes(deletedFileName)) {
                        const success = await FrontmatterService.removeChildFromParent(deletedFileName, existingFileName);
                        if (success) {
                            hasUpdates = true;
                            // 清除该文件的缓存，确保下次读取时获取最新数据
                            if (this.nodeCache.has(existingFileName)) {
                                this.nodeCache.delete(existingFileName);
                            }
                        }
                    }
                } catch {
                    // 跳过无法读取的文件
                    continue;
                }
            }

            return hasUpdates;
            
        } catch (error) {
            console.error(`自动清理删除文件引用时出错:`, error);
            return false;
        }
    }


    /**
     * 在当前树结构中查找指定文件的节点
     */
    private findNodeInCurrentTree(fileName: string): IssueStructureNode | null {
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
     * 当 Issue 文件被激活时调用
     */
    private async onIssueFileActivated(uri: vscode.Uri): Promise<void> {
        // 检查文件是否有有效的 frontmatter
        const frontmatter = await getIssueMarkdownFrontmatter(uri);
        if (!frontmatter || !frontmatter.issue_root_file) {
            this.showGuidanceMessage();
            return;
        }

        this.currentActiveFile = path.basename(uri.fsPath);
        this.currentActiveFrontmatter = frontmatter; // 缓存当前活动文件的 frontmatter
        await this.buildStructureFromActiveFile(frontmatter);
        this._onDidChangeTreeData.fire();
    }

    /**
     * 显示引导信息
     */
    private showGuidanceMessage(): void {
        this.currentActiveFile = null;
        this.currentActiveFrontmatter = null; // 清空 frontmatter 缓存
        this.rootNodes = [{
            id: 'guidance',
            filePath: '',
            title: '请打开一篇已结构化的文档以查看其问题结构',
            children: [],
            hasError: false
        }];
        this._onDidChangeTreeData.fire();  
    }

    /**
     * 从当前激活文件构建结构（使用自动维护的 frontmatter 关系）
     */
    private async buildStructureFromActiveFile(frontmatter: FrontmatterData): Promise<void> {
        const issueDir = getIssueDir();
        if (!issueDir || !frontmatter.issue_root_file) {
            return;
        }

        const rootFilePath = path.join(issueDir, frontmatter.issue_root_file);
        const rootUri = vscode.Uri.file(rootFilePath);

        try {
            // 检查根文件是否存在
            await vscode.workspace.fs.stat(rootUri);
            
            // 使用传统的基于 children_files 的构建方式
            // 因为现在我们会自动维护 frontmatter 关系
            const visited = new Set<string>();
            const sessionCache = new Map<string, IssueStructureNode>();
            const rootNode = await this.buildNodeRecursively(
                frontmatter.issue_root_file, 
                visited, 
                this.nodeCache, 
                sessionCache
            );
            this.rootNodes = rootNode ? [rootNode] : [];
            this._onDidChangeTreeData.fire();
        } catch (error) {
            console.error(`根文件不存在: ${rootFilePath}`, error);
            this.rootNodes = [{
                id: 'error',
                filePath: '',
                title: `根文件不存在: ${frontmatter.issue_root_file}`,
                children: [],
                hasError: true,
                errorMessage: `根文件不存在: ${frontmatter.issue_root_file}`
            }];
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
            return sessionCache.get(fileName)!;
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
                };
            } else {
                // 缓存已过期，删除缓存
                nodeCache.delete(fileName);
            }
        }

        // 检测循环引用
        if (visited.has(fileName)) {
            const errorNode: IssueStructureNode = {
                id: fileName,
                filePath: fileName,
                title: `循环引用: ${fileName}`,
                children: [],
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
            
            const title = getIssueMarkdownTitleFromCache(fileName);
            
            // 获取 frontmatter
            const frontmatter = await getIssueMarkdownFrontmatter(fileUri);
            const childrenFiles = frontmatter?.issue_children_files || [];

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
     * 刷新视图（软刷新，保留缓存）
     * 
     * 说明：
     * - 不清空持久化缓存（nodeCache），依赖文件修改时间（mtime）的失效策略与
     * - 适用于自动触发的刷新场景，避免对大型工作区造成不必要的重建开销。
     * 
     * 注意：如需“硬刷新”（强制重建所有节点），可在未来考虑提供单独命令。
     */
    public refresh(): void {
        // 软刷新：保留缓存，依赖基于 mtime 的失效机制与 invalidateFileCache 的精准清理
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            this.onIssueFileActivated(activeEditor.document.uri);
        }
    }

    /**
     * 防抖刷新视图
     * 避免短时间内多次刷新导致的性能问题
     */
    private debouncedRefresh(): void {
        if (this.refreshDebouncer) {
            clearTimeout(this.refreshDebouncer);
        }
        this.refreshDebouncer = setTimeout(() => {
            this.refresh();
            this.refreshDebouncer = null;
        }, 150); // 150ms 防抖延迟
    }

    /**
     * 获取指定结构节点对应的 TreeItem 展示项
     * 
     * 规则：
     * - 引导节点（guidance）展示为不可折叠的说明项。
     * - 错误节点展示错误图标与提示信息。
     * - 普通节点根据是否存在子节点决定折叠状态；当前活动文件高亮展示。
     * - 为每个节点设置 resourceUri 以支持点击打开文件。
     * 
     * @param element 要渲染的结构节点
     * @returns 用于视图展示的 vscode.TreeItem
     */
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
        if (this.currentActiveFile === element.filePath) {
            item.iconPath = new vscode.ThemeIcon('eye', new vscode.ThemeColor('list.highlightForeground'));
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

    /**
     * 获取给定节点的子节点集合
     * 
     * 行为：
     * - 当传入 element 时，返回该节点的 children。
     * - 当未传入 element 时，返回根节点集合（rootNodes）。
     * 
     * @param element 可选；要展开的父节点
     * @returns 子节点数组；根级请求时返回根节点数组
     */
    getChildren(element?: IssueStructureNode): vscode.ProviderResult<IssueStructureNode[]> {
        if (element) {
            return element.children;
        }
        return this.rootNodes;
    }

    /**
     * 获取父节点（支持 reveal 操作）
     * 
     * 说明：
     * - 在当前内存中的树结构内进行搜索，返回与传入节点匹配的父节点。
     * - 若为根节点或未找到匹配父节点，返回 null。
     * 
     * @param element 目标子节点
     * @returns 父节点；若不存在则返回 null
     */
    getParent(element: IssueStructureNode): IssueStructureNode | null {
        return findParentNodeById(this.rootNodes, element.id);
    }

    /**
     * 清理资源
     * 
     * 释放：
     * - 事件发射器（_onDidChangeTreeData）。
     * - 清空持久化缓存（nodeCache）以释放内存。
     * 
     * 注意：文件系统监听器已注册到扩展上下文（context.subscriptions），
     * 将在扩展停用时由 VS Code 自动释放。
     */
    dispose(): void {
        // 清理防抖计时器
        if (this.refreshDebouncer) {
            clearTimeout(this.refreshDebouncer);
            this.refreshDebouncer = null;
        }
        
        // 释放事件发射器
        this._onDidChangeTreeData.dispose();
        
        // 清空缓存以释放内存
        this.nodeCache.clear();
    }
}
