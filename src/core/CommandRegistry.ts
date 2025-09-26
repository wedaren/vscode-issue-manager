import * as vscode from 'vscode';
import { IFocusedIssuesProvider, IIssueOverviewProvider, IIssueViewProvider } from './interfaces';
import { IssueTreeNode, readTree, removeNode, stripFocusedId, writeTree } from '../data/treeManager';
import { ViewCommandRegistry } from './commands/ViewCommandRegistry';
import { StateCommandRegistry } from './commands/StateCommandRegistry';
import { BaseCommandRegistry } from './commands/BaseCommandRegistry';
import { Logger } from './utils/Logger';

// 重新导入外部命令注册函数
import { registerOpenIssueDirCommand } from '../commands/openIssueDir';
import { registerSearchIssuesCommand } from '../commands/searchIssues';
import { registerDeleteIssueCommand } from '../commands/deleteIssue';
import { registerFocusCommands } from '../commands/focusCommands';
import { smartCreateIssue } from '../commands/smartCreateIssue';
import { addIssueToTree } from '../commands/issueFileUtils';
import { moveToCommand as moveToFunction } from '../commands/moveTo';
import { IssueStructureProvider } from '../views/IssueStructureProvider';

/**
 * 命令注册管理器
 * 
 * 负责协调和管理所有VS Code扩展命令的注册。采用模块化设计，
 * 将不同类型的命令分组到专门的注册器中，提高代码的可维护性。
 * 
 * 架构设计：
 * - ViewCommandRegistry: 视图操作命令（刷新、导航、切换等）
 * - StateCommandRegistry: 状态管理命令（展开/折叠、工具命令等）
 * - 外部命令：直接调用其他模块的注册函数
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
export class CommandRegistry extends BaseCommandRegistry {
    private readonly viewCommandRegistry: ViewCommandRegistry;
    private readonly stateCommandRegistry: StateCommandRegistry;

    /**
     * 创建命令注册管理器实例
     * 
     * @param context VS Code 扩展上下文，用于命令生命周期管理
     */
    constructor(context: vscode.ExtensionContext) {
        super(context);
        this.viewCommandRegistry = new ViewCommandRegistry(context);
        this.stateCommandRegistry = new StateCommandRegistry(context);
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
        recentIssuesProvider: IIssueViewProvider<vscode.TreeItem>,
        overviewView: vscode.TreeView<IssueTreeNode>,
        focusedView: vscode.TreeView<IssueTreeNode>,
        issueStructureProvider: IssueStructureProvider
    ): void {
        this.logger.info('🔧 开始注册命令...');

        try {
            // 1. 注册基础问题管理命令
            this.registerBasicIssueCommands();

            // 2. 设置视图提供者并注册视图命令
            this.viewCommandRegistry.setProviders({
                focusedIssuesProvider,
                issueOverviewProvider,
                recentIssuesProvider,
                overviewView,
                focusedView
            });
            this.viewCommandRegistry.registerCommands();

            // 3. 注册状态管理命令
            this.stateCommandRegistry.registerCommands();
            this.stateCommandRegistry.registerExpandCollapseSync(overviewView, focusedView);

            // 4. 注册外部定义的命令
            this.registerExternalCommands();

            // 5. 注册问题操作和创建命令
            this.registerIssueOperationCommands();

            // 6. 注册“打开并定位”命令
            this.context.subscriptions.push(
                vscode.commands.registerCommand('issueManager.openAndRevealIssue', async (node: IssueTreeNode, type: 'focused' | 'overview') => {
                    if (!node || !node.resourceUri) { return; }
                    // 打开文件
                    await vscode.window.showTextDocument(node.resourceUri, { preview: false });
                    const revealInOverview = () => vscode.commands.executeCommand('issueManager.views.overview.reveal', node, { select: true, focus: true, expand: true });

                    if (type === 'overview') {
                        await revealInOverview();
                    } else if (type === 'focused') {
                        const { node: target } = focusedIssuesProvider.findFirstFocusedNodeById(node.id) || {};
                        if (target) {
                            await vscode.commands.executeCommand('issueManager.views.focused.reveal', target, { select: true, focus: true, expand: true });
                        } else {
                            await revealInOverview();
                        }
                    }
                })
            );

            // 7. 注册结构视图命令
            this.registerStructureViewCommands(issueStructureProvider);

            this.logger.info('✅ 所有命令注册完成');

        } catch (error) {
            this.logger.error('✗ 命令注册过程中出现错误:', error);
            throw new Error(`命令注册失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
    }

    /**
     * 注册基础问题管理命令
     */
    private registerBasicIssueCommands(): void {
        this.logger.info('📝 注册基础问题管理命令...');

        // 创建问题命令
        this.registerCommand(
            'issueManager.createIssue',
            async () => {
                await smartCreateIssue();
            },
            '创建问题'
        );

        // 问题移动命令 
        this.registerCommand(
            'issueManager.moveTo',
            async (...args: unknown[]) => {
                const node = args[0];
                // 使用结构化类型守卫来检查节点是否符合 IssueTreeNode 的特征
                if (node && typeof node === 'object' && 'id' in node && 'resourceUri' in node) {
                    await moveToFunction([node as IssueTreeNode]);
                } else {
                    this.logger.warn('moveTo 命令需要一个有效的树节点参数。');
                    vscode.window.showWarningMessage('请从视图中选择一个问题以执行移动操作。');
                }
            },
            '移动问题'
        );

        // 添加问题到树命令
        this.registerCommand(
            'issueManager.addIssueToTree',
            async (...args: unknown[]) => {
                const [issueUris, parentId, isAddToFocused] = args;

                // 添加类型守卫以确保参数类型正确
                if (
                    Array.isArray(issueUris) &&
                    issueUris.every(uri => uri instanceof vscode.Uri) &&
                    (parentId === null || typeof parentId === 'string') &&
                    typeof isAddToFocused === 'boolean'
                ) {
                    await addIssueToTree(issueUris, parentId, isAddToFocused);
                } else {
                    this.logger.error('addIssueToTree 命令接收到无效的参数', { args });
                    vscode.window.showErrorMessage('添加问题到树时发生内部错误，参数类型不匹配。');
                }
            },
            '添加问题到树'
        );
    }

    /**
     * 注册外部定义的命令
     */
    private registerExternalCommands(): void {
        this.logger.info('📦 注册外部定义的命令...');

        // 这些命令在其他模块中定义，直接调用注册函数
        registerOpenIssueDirCommand(this.context);
        registerSearchIssuesCommand(this.context);
        registerDeleteIssueCommand(this.context);
        registerFocusCommands(this.context);
    }

    /**
     * 注册问题操作命令
     */
    private registerIssueOperationCommands(): void {
        this.logger.info('⚡ 注册问题操作命令...');

        // 创建从当前关注问题的子问题
        this.registerCommand(
            'issueManager.createSubIssue',
            async (...args: unknown[]) => {
                const node = args[0];
                // 类型守卫，确保 node 是一个有效的 IssueTreeNode
                if (node && typeof node === 'object' && 'resourceUri' in node && 'id' in node) {
                    // 使用智能创建问题功能，并指定父节点ID和添加到树
                    const id = stripFocusedId((node as IssueTreeNode).id);
                    await smartCreateIssue(id, true);
                    vscode.window.showInformationMessage('子问题创建成功');
                } else {
                    this.logger.warn('createSubIssue 命令需要一个有效的树节点参数。');
                    vscode.window.showErrorMessage('请从视图中选择一个有效的问题节点来创建子问题。');
                }
            },
            '创建子问题'
        );

        // 从关注问题视图创建新问题
        this.registerCommand(
            'issueManager.createIssueFromFocused',
            async () => {
                await smartCreateIssue(null, true, true);
                vscode.commands.executeCommand('issueManager.refreshAllViews');
            },
            '从关注问题视图创建新问题'
        );

        // 从问题总览视图创建新问题
        this.registerCommand(
            'issueManager.createIssueFromOverview',
            async () => {
                await smartCreateIssue(null, true);
                vscode.commands.executeCommand('issueManager.refreshAllViews');
            },
            '从问题总览创建新问题'
        );

        // 在关注问题中搜索
        this.registerCommand(
            'issueManager.searchIssuesInFocused',
            async () => vscode.commands.executeCommand('issueManager.searchIssues', 'focused'),
            '在关注问题中搜索'
        );


        // 解除问题关联命令
        this.registerCommand(
            'issueManager.disassociateIssue',
            async (...args: unknown[]) => {
                // 类型守卫，确保 node 是一个有效的 IssueTreeNode
                const node = (Array.isArray(args) && args.length > 0) ? args[0] as IssueTreeNode : null;
                
                if (!node || node.id === 'placeholder-no-issues') {
                    return;
                }

                // 判断是否有子节点
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
            },
            '解除问题关联'
        );

    }

    /**
     * 注册结构视图命令
     * @param issueStructureProvider 问题结构视图提供者
     */
    private registerStructureViewCommands(issueStructureProvider: IssueStructureProvider): void {
        this.logger.info('🏗️ 注册结构视图命令...');

        this.registerCommand(
            'issueManager.structure.refresh',
            () => {
                issueStructureProvider.refresh();
            },
            '刷新结构视图'
        );
    }

    registerCommands(): void {
        throw new Error('Method not implemented.');
    }
}