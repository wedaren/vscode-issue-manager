import * as vscode from 'vscode';
import { IssueTreeNode, readTree, writeTree, removeNode, stripFocusedId, updateNodeExpanded } from '../data/treeManager';
import { smartCreateIssue } from '../commands/smartCreateIssue';
import { addIssueToTree } from '../commands/issueFileUtils';
import { moveToCommand } from '../commands/moveTo';
import { registerSearchIssuesCommand } from '../commands/searchIssues';
import { registerOpenIssueDirCommand } from '../commands/openIssueDir';
import { registerDeleteIssueCommand } from '../commands/deleteIssue';
import { registerFocusCommands } from '../commands/focusCommands';
import { getIssueDir } from '../config';
import { IFocusedIssuesProvider, IIssueOverviewProvider, IIssueViewProvider } from './interfaces';
import { debounce, DebouncedFunction } from '../utils/debounce';
import * as path from 'path';

/**
 * 命令注册管理器
 * 
 * 负责注册和管理 VS Code 扩展的所有命令，采用模块化设计，
 * 将不同类型的命令分组管理，提高代码的可维护性和可扩展性。
 * 
 * 支持的命令类型：
 * - 基础命令：问题创建、视图打开等核心功能
 * - 移动和添加命令：问题的移动和树结构操作
 * - 视图刷新命令：各种视图的数据刷新
 * - 视图相关命令：定位、搜索、导航等视图操作
 * - 问题操作命令：解除关联、状态管理等
 * - 创建问题命令：各种上下文的问题创建
 * - 工具命令：复制、导出等辅助功能
 * - 展开/折叠状态同步：树视图状态持久化
 * 
 * @example
 * ```typescript
 * const registry = new CommandRegistry(context);
 * registry.registerAllCommands(
 *   focusedProvider, 
 *   overviewProvider, 
 *   recentProvider,
 *   overviewView,
 *   focusedView
 * );
 * ```
 */
export class CommandRegistry {
    private readonly context: vscode.ExtensionContext;
    private readonly expandCollapseHandler: ExpandCollapseHandler;

    /**
     * 创建命令注册管理器实例
     * 
     * @param context VS Code 扩展上下文，用于命令生命周期管理
     */
    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.expandCollapseHandler = new ExpandCollapseHandler();
    }

    /**
     * 注册所有命令
     * 
     * 按照功能模块分组注册所有VS Code命令，确保命令的
     * 注册顺序和依赖关系正确处理。
     * 
     * @param focusedIssuesProvider 关注问题视图提供者
     * @param issueOverviewProvider 问题总览视图提供者
     * @param recentIssuesProvider 最近问题视图提供者
     * @param overviewView 总览树视图实例
     * @param focusedView 关注问题树视图实例
     */
    public registerAllCommands(
        focusedIssuesProvider: IFocusedIssuesProvider,
        issueOverviewProvider: IIssueOverviewProvider,
        recentIssuesProvider: IIssueViewProvider,
        overviewView: vscode.TreeView<IssueTreeNode>,
        focusedView: vscode.TreeView<IssueTreeNode>
    ): void {
        console.log('  🔧 注册基础命令...');
        this.registerBasicCommands();
        
        console.log('  🚚 注册移动和添加命令...');
        this.registerMoveAndAddCommands();
        
        console.log('  📦 注册外部定义的命令...');
        this.registerExternalCommands();
        
        console.log('  🔄 注册视图刷新命令...');
        this.registerViewRefreshCommands(focusedIssuesProvider, issueOverviewProvider, recentIssuesProvider);
        
        console.log('  👁️ 注册视图相关命令...');
        this.registerViewCommands(focusedIssuesProvider, overviewView, focusedView);
        
        console.log('  ⚡ 注册问题操作命令...');
        this.registerIssueOperationCommands();
        
        console.log('  ➕ 注册创建问题命令...');
        this.registerCreateIssueCommands();
        
        console.log('  🛠️ 注册工具命令...');
        this.registerUtilityCommands();
        
        console.log('  🌳 注册展开/折叠状态同步...');
        this.registerExpandCollapseSync(overviewView, focusedView);
        
        console.log('  ✅ 所有命令注册完成');
    }

    /**
     * 注册基础命令
     */
    private registerBasicCommands(): void {
        // 创建问题命令
        const createIssueCommand = vscode.commands.registerCommand('issueManager.createIssue', async () => {
            await smartCreateIssue(null);
        });
        this.context.subscriptions.push(createIssueCommand);

        // 打开关注视图命令
        const openFocusedViewCommand = vscode.commands.registerCommand('issueManager.openFocusedView', async () => {
            try {
                await vscode.commands.executeCommand('workbench.view.extension.issue-manager');
                await vscode.commands.executeCommand('issueManager.views.focused.focus');
                vscode.window.showInformationMessage('已打开关注问题视图');
            } catch (error) {
                console.error('打开关注问题视图失败:', error);
                vscode.window.showErrorMessage('无法打开关注问题视图，请检查扩展是否正确安装。');
            }
        });
        this.context.subscriptions.push(openFocusedViewCommand);
    }

    /**
     * 注册移动和添加命令
     */
    private registerMoveAndAddCommands(): void {
        // 移动到命令
        const moveToCommand_reg = vscode.commands.registerCommand('issueManager.moveTo', async (node: IssueTreeNode, selectedNodes?: IssueTreeNode[]) => {
            const nodes = selectedNodes && selectedNodes.length > 0 ? selectedNodes : node ? [node] : [];
            await moveToCommand(nodes);
        });
        this.context.subscriptions.push(moveToCommand_reg);

        // 为"最近问题"视图注册"添加到..."命令
        const addToCommand = vscode.commands.registerCommand('issueManager.addTo', async (node: vscode.TreeItem, selectedNodes?: vscode.TreeItem[]) => {
            const nodes = selectedNodes && selectedNodes.length > 0 ? selectedNodes : node ? [node] : [];
            await moveToCommand(nodes);
        });
        this.context.subscriptions.push(addToCommand);

        // addIssueToTree命令
        const addIssueToTreeCommand = vscode.commands.registerCommand('issueManager.addIssueToTree', async (issueUris: vscode.Uri[], parentId: string | null, isAddToFocused: boolean) => {
            await addIssueToTree(issueUris, parentId, isAddToFocused);
        });
        this.context.subscriptions.push(addIssueToTreeCommand);
    }

    /**
     * 注册外部定义的命令
     */
    private registerExternalCommands(): void {
        registerSearchIssuesCommand(this.context);
        registerOpenIssueDirCommand(this.context);
        registerDeleteIssueCommand(this.context);
        registerFocusCommands(this.context);
    }

    /**
     * 注册视图刷新命令
     */
    private registerViewRefreshCommands(
        focusedIssuesProvider: IFocusedIssuesProvider,
        issueOverviewProvider: IIssueOverviewProvider,
        recentIssuesProvider: IIssueViewProvider
    ): void {
        // 关注问题刷新
        const focusedRefreshCommand = vscode.commands.registerCommand('issueManager.focusedIssues.refresh', () => {
            focusedIssuesProvider.loadData();
        });
        this.context.subscriptions.push(focusedRefreshCommand);

        // 最近问题刷新
        const recentRefreshCommand = vscode.commands.registerCommand('issueManager.recentIssues.refresh', () => {
            recentIssuesProvider.refresh();
        });
        this.context.subscriptions.push(recentRefreshCommand);

        // 刷新所有视图
        const refreshAllViewsCommand = vscode.commands.registerCommand('issueManager.refreshAllViews', () => {
            focusedIssuesProvider.refresh();
            issueOverviewProvider.refresh();
            recentIssuesProvider.refresh();
        });
        this.context.subscriptions.push(refreshAllViewsCommand);

        // 统一刷新视图命令
        const refreshViewsCommand = vscode.commands.registerCommand('issueManager.refreshViews', () => {
            focusedIssuesProvider.refresh();
            issueOverviewProvider.refresh();
            recentIssuesProvider.refresh();
        });
        this.context.subscriptions.push(refreshViewsCommand);
    }

    /**
     * 注册视图相关命令
     */
    private registerViewCommands(
        focusedIssuesProvider: IFocusedIssuesProvider,
        overviewView: vscode.TreeView<IssueTreeNode>,
        focusedView: vscode.TreeView<IssueTreeNode>
    ): void {
        // 总览视图定位命令
        const overviewRevealCommand = vscode.commands.registerCommand('issueManager.views.overview.reveal', async (targetNode: IssueTreeNode, options?: { select?: boolean; focus?: boolean; expand?: boolean }) => {
            if (targetNode) {
                await overviewView.reveal(targetNode, options || { select: true, focus: true, expand: true });
            }
        });
        this.context.subscriptions.push(overviewRevealCommand);

        // 关注视图定位命令
        const focusedRevealCommand = vscode.commands.registerCommand('issueManager.views.focused.reveal', async (targetNode: IssueTreeNode, options?: { select?: boolean; focus?: boolean; expand?: boolean }) => {
            await focusedView.reveal(targetNode, options || { select: true, focus: true, expand: true });
        });
        this.context.subscriptions.push(focusedRevealCommand);

        // 搜索命令
        const searchInFocusedCommand = vscode.commands.registerCommand('issueManager.searchIssuesInFocused', async () => {
            vscode.commands.executeCommand('issueManager.searchIssues', 'focused');
        });
        this.context.subscriptions.push(searchInFocusedCommand);

        const searchInOverviewCommand = vscode.commands.registerCommand('issueManager.searchIssuesInOverview', async () => {
            vscode.commands.executeCommand('issueManager.searchIssues', 'overview');
        });
        this.context.subscriptions.push(searchInOverviewCommand);

        // 打开并定位问题命令
        const openAndRevealCommand = vscode.commands.registerCommand('issueManager.openAndRevealIssue', async (node: IssueTreeNode, type: 'focused' | 'overview') => {
            if (!node || !node.resourceUri) { return; }
            await vscode.window.showTextDocument(node.resourceUri, { preview: false });
            if (type === 'overview') {
                await vscode.commands.executeCommand('issueManager.views.overview.reveal', node, { select: true, focus: true, expand: true });
            } else if (type === 'focused') {
                const result = focusedIssuesProvider.findFirstFocusedNodeById(node.id);
                if (result?.node) {
                    await vscode.commands.executeCommand('issueManager.views.focused.reveal', result.node, { select: true, focus: true, expand: true });
                } else {
                    await vscode.commands.executeCommand('issueManager.views.overview.reveal', node, { select: true, focus: true, expand: true });
                }
            }
        });
        this.context.subscriptions.push(openAndRevealCommand);
    }

    /**
     * 注册问题操作命令
     */
    private registerIssueOperationCommands(): void {
        // 解除关联命令
        const disassociateIssueCommand = vscode.commands.registerCommand('issueManager.disassociateIssue', async (node: IssueTreeNode) => {
            if (!node || node.id === 'placeholder-no-issues') {
                return;
            }

            if (node.children && node.children.length > 0) {
                const confirm = await vscode.window.showWarningMessage(
                    '该节点下包含子问题，解除关联将一并移除其所有子节点。是否继续？',
                    { modal: true },
                    '确定'
                );
                if (confirm !== '确定') {
                    return;
                }
            }

            const treeData = await readTree();
            if (!treeData) {
                vscode.window.showErrorMessage('无法读取问题树数据。');
                return;
            }

            const { success } = removeNode(treeData, stripFocusedId(node.id));

            if (success) {
                await writeTree(treeData);
                vscode.commands.executeCommand('issueManager.refreshAllViews');
            } else {
                vscode.window.showWarningMessage('无法在树中找到该节点以解除关联。');
            }
        });
        this.context.subscriptions.push(disassociateIssueCommand);
    }

    /**
     * 注册创建问题命令
     */
    private registerCreateIssueCommands(): void {
        // 创建子问题处理器
        const createChildIssueHandler = (viewType: 'overview' | 'focused') => {
            return async (parentNode?: IssueTreeNode) => {
                const id = parentNode?.id && stripFocusedId(parentNode.id);
                await smartCreateIssue(id || null, true);
                if (parentNode) {
                    const revealCommand = `issueManager.views.${viewType}.reveal`;
                    await vscode.commands.executeCommand(revealCommand, parentNode, { select: true, focus: true, expand: true });
                }
            };
        };

        // 总览视图创建子问题
        const createChildIssueCommandInOverview = vscode.commands.registerCommand(
            'issueManager.createChildIssueInOverview',
            createChildIssueHandler('overview')
        );
        this.context.subscriptions.push(createChildIssueCommandInOverview);

        // 关注视图创建子问题
        const createChildIssueCommandInFocused = vscode.commands.registerCommand(
            'issueManager.createChildIssueInFocused',
            createChildIssueHandler('focused')
        );
        this.context.subscriptions.push(createChildIssueCommandInFocused);

        // 从总览创建问题
        const createIssueFromOverviewCommand = vscode.commands.registerCommand('issueManager.createIssueFromOverview', async () => {
            await smartCreateIssue(null, true);
        });
        this.context.subscriptions.push(createIssueFromOverviewCommand);

        // 从关注创建问题
        const createIssueFromFocusedCommand = vscode.commands.registerCommand('issueManager.createIssueFromFocused', async (node?: IssueTreeNode) => {
            await smartCreateIssue(null, true, true);
        });
        this.context.subscriptions.push(createIssueFromFocusedCommand);
    }

    /**
     * 注册工具命令
     */
    private registerUtilityCommands(): void {
        // 复制文件名命令
        const copyFilenameCommand = vscode.commands.registerCommand('issueManager.copyFilename', async (treeItemOrResourceUri?: vscode.TreeItem | vscode.Uri) => {
            let resourceUri: vscode.Uri | undefined;

            if (treeItemOrResourceUri instanceof vscode.Uri) {
                resourceUri = treeItemOrResourceUri;
            } else if (treeItemOrResourceUri?.resourceUri) {
                resourceUri = treeItemOrResourceUri.resourceUri;
            } else if (vscode.window.activeTextEditor) {
                const doc = vscode.window.activeTextEditor.document;
                const issueDir = getIssueDir();
                if (doc.languageId === 'markdown' && issueDir && doc.uri.fsPath.startsWith(issueDir)) {
                    resourceUri = doc.uri;
                }
            }

            if (resourceUri) {
                const fileName = path.basename(resourceUri.fsPath);
                try {
                    await vscode.env.clipboard.writeText(fileName);
                    vscode.window.showInformationMessage(`已复制文件名: ${fileName}`);
                } catch (e) {
                    console.error('复制文件名到剪贴板失败:', e);
                    vscode.window.showErrorMessage('复制文件名失败。');
                }
            } else {
                vscode.window.showWarningMessage('未找到有效的文件路径，无法复制文件名。');
            }
        });
        this.context.subscriptions.push(copyFilenameCommand);

        // 注意：问题结构视图刷新命令由ViewRegistry中的结构视图直接处理
    }

    /**
     * 注册展开/折叠状态同步
     * 
     * 为树视图注册展开和折叠事件监听器，实现状态持久化。
     * 使用防抖机制避免频繁的I/O操作，提高性能。
     * 
     * @param overviewView 总览树视图
     * @param focusedView 关注问题树视图
     */
    private registerExpandCollapseSync(
        overviewView: vscode.TreeView<IssueTreeNode>,
        focusedView: vscode.TreeView<IssueTreeNode>
    ): void {
        try {
            this.expandCollapseHandler.registerTreeView(overviewView, 'overview');
            this.expandCollapseHandler.registerTreeView(focusedView, 'focused');
            console.log('    ✓ 展开/折叠状态同步已注册');
        } catch (error) {
            console.error('    ✗ 展开/折叠状态同步注册失败:', error);
            // 展开/折叠同步失败不应该阻止扩展启动
        }
    }
}

/**
 * 展开/折叠状态处理器
 * 
 * 专门处理树视图的展开和折叠事件，实现状态持久化。
 * 使用防抖机制和错误恢复，确保性能和稳定性。
 */
class ExpandCollapseHandler {
    private readonly debouncedSaveState: DebouncedFunction<() => void>;
    private pendingUpdates = new Map<string, boolean>();

    constructor() {
        // 使用防抖机制，避免频繁的I/O操作
        this.debouncedSaveState = debounce(() => {
            this.saveExpandedStates();
        }, 300);
    }

    /**
     * 为树视图注册展开/折叠事件监听器
     * 
     * @param treeView 要注册的树视图
     * @param viewName 视图名称，用于日志记录
     */
    public registerTreeView(treeView: vscode.TreeView<IssueTreeNode>, viewName: string): void {
        // 展开事件监听
        treeView.onDidExpandElement((e) => {
            this.handleExpandCollapse(e.element.id, true, viewName);
        });

        // 折叠事件监听
        treeView.onDidCollapseElement((e) => {
            this.handleExpandCollapse(e.element.id, false, viewName);
        });
    }

    /**
     * 处理展开/折叠事件
     * 
     * @param nodeId 节点ID
     * @param expanded 是否展开
     * @param viewName 视图名称
     */
    private handleExpandCollapse(nodeId: string, expanded: boolean, viewName: string): void {
        try {
            const cleanId = stripFocusedId(nodeId);
            this.pendingUpdates.set(cleanId, expanded);
            
            // 触发防抖保存
            this.debouncedSaveState();
            
        } catch (error) {
            console.error(`展开/折叠处理失败 (${viewName}):`, error);
        }
    }

    /**
     * 保存展开状态到存储
     * 
     * 批量处理所有待保存的状态更新，减少I/O操作次数
     */
    private saveExpandedStates(): void {
        if (this.pendingUpdates.size === 0) {
            return;
        }

        // 异步处理保存操作，不阻塞用户界面
        this.performSave().catch(error => {
            console.error('保存展开状态失败:', error);
            // 清空待处理的更新，避免重复尝试
            this.pendingUpdates.clear();
            
            // 显示用户友好的错误消息
            vscode.window.showWarningMessage('无法保存视图状态，下次启动时展开状态可能丢失。');
        });
    }

    /**
     * 执行实际的保存操作
     */
    private async performSave(): Promise<void> {
        try {
            const treeData = await readTree();
            let hasChanges = false;

            // 批量应用所有状态更新
            for (const [nodeId, expanded] of this.pendingUpdates) {
                if (updateNodeExpanded(treeData.rootNodes, nodeId, expanded)) {
                    hasChanges = true;
                }
            }

            // 清空待处理的更新
            this.pendingUpdates.clear();

            // 只有在有实际变化时才保存和刷新
            if (hasChanges) {
                await writeTree(treeData);
                // 延迟刷新，避免阻塞用户操作
                setTimeout(() => {
                    vscode.commands.executeCommand('issueManager.refreshAllViews');
                }, 100);
            }

        } catch (error) {
            throw error; // 重新抛出错误，让上层处理
        }
    }
}