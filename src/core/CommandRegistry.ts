import * as vscode from 'vscode';
import * as path from 'path';
import { IFocusedIssuesProvider, IIssueOverviewProvider, IIssueViewProvider } from './interfaces';
import { IssueNode, readTree, isIssueNode, stripFocusedId, writeTree, findNodeById, getIssueNodeById, createIssueNodes } from '../data/issueTreeManager';
import { ViewCommandRegistry } from './commands/ViewCommandRegistry';
import { StateCommandRegistry } from './commands/StateCommandRegistry';
import { BaseCommandRegistry } from './commands/BaseCommandRegistry';
import { WebviewManager } from '../webview/WebviewManager';
import { GraphDataService } from '../services/GraphDataService';
import { EditorContextService } from '../services/EditorContextService';
import { addFocus } from '../data/focusedManager';
import { ParaCategory, removeIssueFromCategory, addIssueToCategory, getCategoryLabel } from '../data/paraManager';
import { addIssueToParaCategory } from '../commands/paraCommands';
import { isParaIssueNode, ParaViewNode } from '../types';

const PARA_CATEGORY_CONFIGS = [
    { category: ParaCategory.Projects, suffix: 'Projects', displayName: 'Projects' },
    { category: ParaCategory.Areas, suffix: 'Areas', displayName: 'Areas' },
    { category: ParaCategory.Resources, suffix: 'Resources', displayName: 'Resources' },
    { category: ParaCategory.Archives, suffix: 'Archives', displayName: 'Archives' }
] as const;

// 等待视图切换和渲染完成的延迟时间  
const VIEW_REVEAL_DELAY_MS = 300;
// 等待分类节点展开动画完成的延迟时间  
const EXPAND_ANIMATION_DELAY_MS = 100;

// 重新导入外部命令注册函数
import { registerOpenIssueDirCommand, registerOpenvscodeIssueManagerDirCommand, registerOpenVscodeSIEMDirCommand } from '../commands/openIssueDir';
import { registerDisassociateIssueCommand } from '../commands/disassociateIssue';
import { registerSearchIssuesCommand } from '../commands/searchIssues';
import { registerDeleteIssueCommand } from '../commands/deleteIssue';
import { registerFocusCommands } from '../commands/focusCommands';
import { registerCreateSubIssueCommand } from '../commands/createSubIssue';
import { registerCreateSubIssueFromEditorCommand } from '../commands/createSubIssueFromEditor';
import { registerCreateTranslationFromEditorCommand } from '../commands/createTranslationFromEditor';
import { smartCreateIssue } from '../commands/smartCreateIssue';
import { selectOrCreateIssue } from '../commands/selectOrCreateIssue';
import { executeCreateIssueFromCompletion } from '../commands/createIssueFromCompletion';
import { createIssueFromClipboard } from '../commands/createIssueFromClipboard';
import { createIssueFromHtml, CreateIssueFromHtmlParams } from '../commands/createIssueFromHtml';
import { moveIssuesTo } from '../commands/moveTo';
import { attachIssuesTo } from '../commands/attachTo';
import { IssueStructureProvider } from '../views/IssueStructureProvider';
import { IssueLogicalTreeProvider } from '../views/IssueLogicalTreeProvider';
import { IssueLogicalTreeNode } from '../models/IssueLogicalTreeModel';
import { ParaViewProvider } from '../views/ParaViewProvider';
import { MarkerManager } from '../marker/MarkerManager';
import { getIssueIdFromUri } from '../utils/uriUtils';
import { getIssueMarkdown } from '../data/IssueMarkdowns';
import { getRelativeToNoteRoot } from '../utils/pathUtils';
import { selectLLMModel } from '../commands/llmCommands';
// note mapping commands removed
import { copilotDiffSend, copilotDiffCopyResult } from '../commands/copilotDiff';
import {registerGenerateTitleCommand} from '../commands/generateTitle';
import {registerGenerateBriefSummaryCommand} from '../commands/generateBriefSummary';
import { registerGenerateProjectNameCommand, registerGenerateGitBranchCommand } from '../commands/nameGenerators';
import { registerUnifiedQuickOpenCommand } from '../commands/unifiedQuickOpen';
import { registerInsertMarksCommand } from '../commands/insertMarksCommand';
import { registerInsertTermsReferenceCommand } from '../commands/insertTermsReferenceCommand';
import { ShowRelationGraphCommand } from '../commands/ShowRelationGraphCommand';
import { ShowMindMapCommand } from '../commands/ShowMindMapCommand';
import { registerOpenIssueBesideEditorHandler } from '../commands/openIssueBesideEditor';
import { openIssueNode } from '../commands/openIssueNode';
import { registerReviewPlanCommands } from '../commands/reviewPlanCommands';
import { registerOpenReviewPlanQuickPick } from '../commands/openReviewPlanQuickPick';
import {
    registerDeepResearchIssueCommand,
    registerDeepResearchIssueLocalCommand,
    registerDeepResearchIssueLlmOnlyCommand,
} from '../commands/deepResearchIssue';
import { registerDeepResearchDocCommands } from '../commands/deepResearchDocCommands';



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
    private webviewManager?: WebviewManager;
    private graphDataService?: GraphDataService;

    constructor(context: vscode.ExtensionContext, deps?: { webviewManager?: WebviewManager; graphDataService?: GraphDataService }) {
        super(context);
        this.viewCommandRegistry = new ViewCommandRegistry(context);
        this.stateCommandRegistry = new StateCommandRegistry(context);
        // 可选注入，保持向后兼容
        if (deps) {
            this.webviewManager = deps.webviewManager;
            this.graphDataService = deps.graphDataService;
        }
        // 初始化视图上下文：自动删除设置
        try {
            const v = this.context.globalState.get<boolean>('issueManager.autoDeleteOnDisassociate', false);
            void vscode.commands.executeCommand('setContext', 'issueManager.autoDeleteOnDisassociate', !!v);
        } catch (err) {
            this.logger.warn('初始化 issueManager.autoDeleteOnDisassociate 上下文失败', err);
        }
    }

    /**
     * 注册所有命令（实现抽象方法）
     * 
     * 按照功能模块分组注册所有VS Code命令，确保命令的
     * 注册顺序和依赖关系正确处理。
     * 
     * 注意：此方法需要先通过 setProviders 设置视图提供者
     */
    public registerCommands(): void {
        // 此方法由 setProviders 后自动调用
        // 不应该直接调用
    }

    private paraView?: vscode.TreeView<ParaViewNode>;
    private markerManager?: MarkerManager;

    /**
     * 设置视图提供者并注册所有命令
     * 
     * @param focusedIssuesProvider 关注问题视图提供者
     * @param issueOverviewProvider 问题总览视图提供者
     * @param recentIssuesProvider 最近问题视图提供者
     * @param overviewView 总览树视图实例
     * @param focusedView 关注问题树视图实例
     * @param issueStructureProvider 问题结构视图提供者
     * @param paraViewProvider PARA 视图提供者
     * @param paraView PARA 树视图实例
     */
    public registerAllCommands(
        focusedIssuesProvider: IFocusedIssuesProvider,
        issueOverviewProvider: IIssueOverviewProvider,
        recentIssuesProvider: IIssueViewProvider<vscode.TreeItem>,
        recentView: vscode.TreeView<vscode.TreeItem> | undefined,
        overviewView: vscode.TreeView<IssueNode>,
        focusedView: vscode.TreeView<IssueNode>,
        issueSearchProvider: import('../views/IssueSearchViewProvider').IssueSearchViewProvider,
        issueSearchView: vscode.TreeView<import('../views/IssueSearchViewProvider').IssueSearchViewNode>,
        deepResearchProvider: import('../views/DeepResearchIssuesProvider').DeepResearchIssuesProvider,
        deepResearchView: vscode.TreeView<import('../views/DeepResearchIssuesProvider').DeepResearchViewNode>,
        // issueStructureProvider: IssueStructureProvider,
        // issueLogicalTreeProvider: IssueLogicalTreeProvider,
        paraViewProvider: ParaViewProvider,
        paraView?: vscode.TreeView<ParaViewNode>,
        markerManager?: MarkerManager
    ): void {
        // 保存 paraView 引用
        this.paraView = paraView;
        // 保存 markerManager 引用（可选）
        this.markerManager = markerManager;
        this.logger.info('🔧 开始注册命令...');

        try {
            // 1. 注册基础问题管理命令
            this.registerBasicIssueCommands();

            // 2. 设置视图提供者并注册视图命令
            this.viewCommandRegistry.setProviders({
                focusedIssuesProvider,
                issueOverviewProvider,
                recentIssuesProvider,
                recentView,
                paraViewProvider,
                overviewView,
                focusedView,
                issueSearchProvider,
                issueSearchView,
                deepResearchProvider,
                deepResearchView
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
                vscode.commands.registerCommand('issueManager.openAndRevealIssue', async (node: IssueNode, type: 'focused' | 'overview') => {
                    if (!node || !node.resourceUri) { return; }
                    // 打开文件
                    const uri = node.resourceUri;
                    if (node.id && uri) {
                        const id = stripFocusedId(node.id);
                        await vscode.window.showTextDocument(uri.with({ query: `issueId=${encodeURIComponent(id)}` }), { preview: false });
                    } else {
                        await vscode.window.showTextDocument(uri, { preview: false });
                    }
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

            // // 7. 注册结构视图命令
            // this.registerStructureViewCommands(issueStructureProvider);

            // 8. 注册逻辑树视图命令
            // this.registerLogicalTreeViewCommands(issueLogicalTreeProvider);

            // 9. 注册 PARA 视图命令
            this.registerParaCommands();

            // 10. 注册 LLM 相关命令
            this.registerLLMCommands();

            // 新命令：在激活的编辑器旁边打开问题（如果编辑器包含 issueId）
            this.registerCommand(
                'issueManager.openIssueBesideEditor',
                registerOpenIssueBesideEditorHandler,
                '在编辑器旁边打开问题'
            );
            this.registerCommand(
                'issueManager.openIssueNode',
                async (...args: unknown[]) => {
                    const [first] = args;  
                    if (typeof first === 'string' || isIssueNode(first)) {  
                        await openIssueNode(first);  
                    } else {  
                        this.logger.warn(`'issueManager.openIssueNode' command called with invalid argument:`, first);  
                        vscode.window.showErrorMessage('打开笔记节点的参数无效。');  
                    }  
                },
                '在编辑器打开IssueNode'
            );


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

        // 快速新建命令（QuickPick 三选项实现）
        this.registerCommand(
            'issueManager.selectOrCreateIssue',
                async (...args: unknown[]) => {
                // 允许外部传入 parentId（或其他可选参数的扩展），若无则为默认 undefined
                const parentId = args && args.length > 0 && typeof args[0] === 'string' ? (args[0] as string) : undefined;
                const createdId = await selectOrCreateIssue(parentId);
                // 如果返回了 issueId，则定位并打开该问题
                if (createdId) {
                    try {
                        const node = await getIssueNodeById(createdId);
                        if (node) {
                            await vscode.commands.executeCommand('issueManager.openAndRevealIssue', node, 'overview');
                        } else {
                            // 若未找到节点，尝试刷新视图以同步状态
                            vscode.commands.executeCommand('issueManager.refreshAllViews');
                        }
                    } catch (error) {
                        this.logger.error('打开新建问题失败', error);
                    }
                }
            },
            '快速新建问题'
        );


        // 支持从补全直接创建问题（CompletionItem 直接调用，无 QuickPick）
        this.registerCommand(
            'issueManager.createIssueFromCompletion',
            executeCreateIssueFromCompletion,
            '从补全直接创建问题'
        );

        // 命令：通过文件路径在侧边打开（供 markdown 中的 command: 链接使用）
        this.registerCommand(
            'issueManager.openUriBeside',
            async (...args: unknown[]) => {
                try {
                    const fsPath = args && args.length > 0 && typeof args[0] === 'string' ? args[0] as string : undefined;
                    const issueId = args && args.length > 1 && typeof args[1] === 'string' ? args[1] as string : undefined;
                    if (!fsPath) { return; }
                    let uri = vscode.Uri.file(fsPath);
                    if (issueId) {
                        uri = uri.with({ query: `issueId=${encodeURIComponent(issueId)}` });
                    }
                    try {
                        await vscode.window.showTextDocument(uri, { preview: false, viewColumn: vscode.ViewColumn.Beside });
                    } catch (e) {
                        await vscode.window.showTextDocument(uri, { preview: false });
                    }
                } catch (error) {
                    console.error('openUriBeside 执行失败:', error);
                    throw error;
                }
            },
            '在侧边打开 URI'
        );

        // 问题移动命令 
        this.registerCommand(
            'issueManager.moveTo',
            async (...args: unknown[]) => {
                const [node, nodes] = args;
                if (nodes && Array.isArray(nodes) && nodes.length > 0) {
                    const validNodes = nodes.filter(isIssueNode);
                    await moveIssuesTo(validNodes);
                } else if (node && isIssueNode(node)) {
                    await moveIssuesTo([node]);
                } else {
                    this.logger.warn('moveTo 命令需要一个有效的树节点参数。');
                    vscode.window.showWarningMessage('请从视图中选择一个问题以执行移动操作。');
                }
            },
            '移动问题'
        );

        // 问题关联命令（与移动类似但保留原位置）
        this.registerCommand(
            'issueManager.attachTo',
            async (...args: unknown[]) => {
                const [node, nodes] = args;
                if (nodes && Array.isArray(nodes) && nodes.length > 0) {
                    const validNodes = nodes.filter(isIssueNode);
                    await attachIssuesTo(validNodes);
                } else if (node && isIssueNode(node)) {
                    await attachIssuesTo([node]);
                } else {
                    this.logger.warn('attachTo 命令需要一个有效的树节点参数。');
                    vscode.window.showWarningMessage('请从视图中选择一个问题以执行关联操作。');
                }
            },
            '关联问题'
        );

        // 从编辑器移动问题命令
        this.registerCommand(
            'issueManager.moveToFromEditor',
            async () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    vscode.window.showErrorMessage('未找到活动的编辑器。');
                    return;
                }

                const uri = editor.document.uri;
                const issueId = getIssueIdFromUri(uri);
                
                if (!issueId) {
                    vscode.window.showWarningMessage('当前文档不包含问题 ID，无法执行移动操作。');
                    return;
                }

                try {
                    // 从树结构中查找节点
                    const tree = await readTree();
                    const result = findNodeById(tree.rootNodes, issueId);
                    
                    if (!result) {
                        vscode.window.showWarningMessage('未在问题树中找到当前问题的节点。');
                        return;
                    }

                    // 调用移动命令
                    await moveIssuesTo([result.node]);
                } catch (error) {
                    this.logger.error('从编辑器移动问题失败', error);
                    vscode.window.showErrorMessage(`移动问题失败: ${error instanceof Error ? error.message : '未知错误'}`);
                }
            },
            '从编辑器移动问题'
        );

        // 从编辑器关联问题命令
        this.registerCommand(
            'issueManager.attachToFromEditor',
            async () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    vscode.window.showErrorMessage('未找到活动的编辑器。');
                    return;
                }

                const uri = editor.document.uri;
                const issueId = getIssueIdFromUri(uri);
                if(issueId) {
                    const node = await getIssueNodeById(issueId);
                    node && await attachIssuesTo([node]);
                } else {
                    const nodes = await createIssueNodes([uri]);
                    nodes && await attachIssuesTo(nodes);
                }
            },
            '从编辑器关联问题'
        );

        // 添加问题到树命令
        this.registerCommand(
            'issueManager.addIssueToTree',
            async (...args: unknown[]) => {
                let issues: vscode.TreeItem[];
                const [firstArg, secondArg] = args;

                if (secondArg && Array.isArray(secondArg)) {
                    if (secondArg.length > 0 && typeof secondArg[0] === 'object' && 'resourceUri' in secondArg[0]) {
                        issues = (secondArg as vscode.TreeItem[]);
                        await moveIssuesTo(issues);
                    }
                } else if (firstArg && typeof firstArg === 'object' && 'resourceUri' in firstArg) {
                    issues = [firstArg as vscode.TreeItem];
                    await moveIssuesTo(issues);
                } else {
                    this.logger.error('addIssueToTree 命令接收到无效的参数', { args });
                    vscode.window.showErrorMessage('添加问题到树时发生内部错误，参数类型不匹配。');
                }
            },
            '添加问题到树'
        );

        // 从 HTML 创建问题命令
        this.registerCommand(
            'issueManager.createIssueFromHtml',
            async (params?: unknown) => {
                await createIssueFromHtml(params as CreateIssueFromHtmlParams);
            },
            '从 HTML 创建问题'
        );

        // 显示问题关系图命令
        this.registerCommand(
            'issueManager.showRelationGraph',
            async (...args: unknown[]) => {
                const uri = args[0] as vscode.Uri | undefined;
                // 使用静态导入的 `ShowRelationGraphCommand`

                let webviewManager = this.webviewManager;
                if (!webviewManager) {
                    webviewManager = WebviewManager.getInstance(this.context);
                }

                let graphDataService = this.graphDataService;
                if (!graphDataService) {
                    graphDataService = GraphDataService.getInstance();
                }

                const command = new ShowRelationGraphCommand(this.context, webviewManager, graphDataService);
                await command.execute(uri);
            },
            '显示问题关系图'
        );

        // 显示思维导图命令
        this.registerCommand(
            'issueManager.showMindMap',
            async (...args: unknown[]) => {
                const uri = args[0] as vscode.Uri | undefined;
                // 使用静态导入的 `ShowMindMapCommand`

                let webviewManager = this.webviewManager;
                if (!webviewManager) {
                    webviewManager = WebviewManager.getInstance(this.context);
                }

                let graphDataService = this.graphDataService;
                if (!graphDataService) {
                    graphDataService = GraphDataService.getInstance();
                }

                const command = new ShowMindMapCommand(this.context, webviewManager, graphDataService);
                await command.execute(uri);
            },
            '显示思维导图'
        );
        // 自动删除切换命令（用于问题总览标题栏图标）
        this.registerCommand(
            'issueManager.autoDeleteOnDisassociate.enable',
            async () => {
                await this.context.globalState.update('issueManager.autoDeleteOnDisassociate', true);
                await vscode.commands.executeCommand('setContext', 'issueManager.autoDeleteOnDisassociate', true);
            },
            '启用自动删除'
        );

        this.registerCommand(
            'issueManager.autoDeleteOnDisassociate.disable',
            async () => {
                await this.context.globalState.update('issueManager.autoDeleteOnDisassociate', false);
                await vscode.commands.executeCommand('setContext', 'issueManager.autoDeleteOnDisassociate', false);
            },
            '禁用自动删除'
        );
    }

    /**
     * 注册外部定义的命令
     */
    private registerExternalCommands(): void {
        this.logger.info('📦 注册外部定义的命令...');

        // 这些命令在其他模块中定义，直接调用注册函数
        registerOpenIssueDirCommand(this.context);
        registerOpenvscodeIssueManagerDirCommand(this.context);
        registerOpenVscodeSIEMDirCommand(this.context);
        registerSearchIssuesCommand(this.context);
        registerDeleteIssueCommand(this.context);
        registerFocusCommands(this.context);
        // 注册外部实现的子问题创建命令
        registerCreateSubIssueCommand(this.context);
        registerCreateSubIssueFromEditorCommand(this.context);
        registerCreateTranslationFromEditorCommand(this.context);

        // Review/计划相关命令
        registerReviewPlanCommands(this.context);
        // 快捷回顾命令（QuickPick）
        registerOpenReviewPlanQuickPick(this.context);

        // 深度调研文档维护命令（例如删除）
        registerDeepResearchDocCommands(this.context);
    }

    /**
     * 注册问题操作命令
     */
    private registerIssueOperationCommands(): void {
        this.logger.info('⚡ 注册问题操作命令...');

        

        // 从问题总览视图创建新问题
        this.registerCommand(
            'issueManager.createIssueFromOverview',
            async () => {
                await smartCreateIssue(undefined, { addToTree: true });
                vscode.commands.executeCommand('issueManager.refreshAllViews');
            },
            '从问题总览创建新问题'
        );

        // 从剪贴板智能创建问题（快捷键触发）
        this.registerCommand(
            'issueManager.createIssueFromClipboard',
            async () => {
                await createIssueFromClipboard();
                // 刷新视图，确保新文件出现在树中（如果配置了自动添加可以进一步集成）
                vscode.commands.executeCommand('issueManager.refreshAllViews');
            },
            '从剪贴板创建问题'
        );

        // 在关注问题中搜索
        this.registerCommand(
            'issueManager.searchIssuesInFocused',
            async () => vscode.commands.executeCommand('issueManager.searchIssues', 'focused'),
            '在关注问题中搜索'
        );


        // 解除问题关联命令（委托到独立模块实现）
        registerDisassociateIssueCommand(this.context);

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

    /**
     * 注册逻辑树视图命令
     * @param issueLogicalTreeProvider 问题逻辑树视图提供者
     */
    private registerLogicalTreeViewCommands(issueLogicalTreeProvider: IssueLogicalTreeProvider): void {
        this.logger.info('🌲 注册逻辑树视图命令...');

        this.registerCommand(
            'issueManager.logicalTree.refresh',
            () => {
                issueLogicalTreeProvider.refresh();
            },
            '刷新逻辑树视图'
        );

        this.registerCommand(
            'issueManager.logicalTree.createRoot',
            async () => {
                await issueLogicalTreeProvider.createRootForCurrentFile();
            },
            '为当前文件创建根节点'
        );

        this.registerCommand(
            'issueManager.logicalTree.addChild',
            async (...args: unknown[]) => {
                const node = args[0] as IssueLogicalTreeNode | undefined;
                await issueLogicalTreeProvider.addChild(node);
            },
            '添加子节点到逻辑树'
        );

        this.registerCommand(
            'issueManager.logicalTree.removeNode',
            async (...args: unknown[]) => {
                const node = args[0] as IssueLogicalTreeNode | undefined;
                await issueLogicalTreeProvider.removeNode(node);
            },
            '从逻辑树移除节点'
        );
    }

    /**
     * 注册 PARA 视图命令
     */
    private registerParaCommands(): void {
        this.logger.info('📋 注册 PARA 视图命令...');

        // 刷新 PARA 视图
        this.registerCommand(
            'issueManager.para.refresh',
            () => {
                vscode.commands.executeCommand('issueManager.refreshAllViews');
            },
            '刷新 PARA 视图'
        );

        this.registerParaCategoryCommands(
            'issueManager.para.addTo',
            (displayName: string) => `添加问题到 ${displayName}`,
            async (category: ParaCategory, args: unknown[]) => {
                const node = args[0];
                if (node && isIssueNode(node)) {
                    const id = stripFocusedId(node.id);
                    await addIssueToParaCategory(category, id);
                }
            }
        );

        // 复制问题 ID 命令（用于编辑器右键菜单）
        this.registerCommand(
            'issueManager.copyIssueId',
            async () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    vscode.window.showWarningMessage('没有激活的编辑器可复制问题 ID。');
                    return;
                }
                const id = getIssueIdFromUri(editor.document.uri);
                if (!id) {
                    vscode.window.showWarningMessage('当前文档不包含问题 ID。');
                    return;
                }
                try {
                    await vscode.env.clipboard.writeText(id);
                    vscode.window.showInformationMessage('已复制问题 ID');
                } catch (e) {
                    this.logger.error('复制问题 ID 到剪贴板失败', e);
                    vscode.window.showErrorMessage('复制问题 ID 失败');
                }
            },
            '复制问题 ID'
        );

        // 复制问题 Markdown 链接命令
        this.registerCommand(
            'issueManager.copyIssueMarkdownLink',
            async () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    vscode.window.showWarningMessage('没有激活的编辑器可复制 IssueMarkdown 链接。');
                    return;
                }

                const md = await getIssueMarkdown(editor.document.uri);
                if (!md) {
                    vscode.window.showWarningMessage('当前文档不是有效的 IssueMarkdown。');
                    return;
                }

                const rawRel = getRelativeToNoteRoot(md.uri.fsPath) ?? vscode.workspace.asRelativePath(md.uri, false);
                const safeRel = (rawRel || path.basename(md.uri.fsPath)).replace(/\\/g, '/');
                const link = `[${md.title}](IssueDir/${safeRel})`;

                try {
                    await vscode.env.clipboard.writeText(link);
                    vscode.window.showInformationMessage('已复制 IssueMarkdown 链接');
                } catch (e) {
                    this.logger.error('复制 IssueMarkdown 链接失败', e);
                    vscode.window.showErrorMessage('复制 IssueMarkdown 链接失败');
                }
            },
            '复制 IssueMarkdown 链接'
        );

        this.registerParaCategoryCommands(
            'issueManager.para.viewIn',
            (displayName: string) => `在 ${displayName} 中查看`,
            async (category: ParaCategory, args: unknown[]) => {
                const node = args[0];
                if (node && isIssueNode(node)) {
                    await this.revealInParaView(node, category);
                }
            }
        );

        // 从 PARA 视图中移除
        this.registerCommand(
            'issueManager.para.removeFromCategory',
            async (...args: unknown[]) => {
                const element = args[0];
                if (isParaIssueNode(element)) {
                    await this.removeFromParaCategory(element.id, element.category);
                }
            },
            '从 PARA 分类中移除'
        );

        // 从 PARA 视图添加到关注视图
        this.registerCommand(
            'issueManager.para.addToFocused',
            async (...args: unknown[]) => {
                const element = args[0];
                if (isParaIssueNode(element)) {
                    await this.addParaNodeToFocused(element.id);
                }
            },
            '从 PARA 视图添加到关注视图'
        );

        this.registerParaCategoryCommands(
            'issueManager.para.moveTo',
            (displayName: string) => `移动到 ${displayName}`,
            async (category: ParaCategory, args: unknown[]) => {
                const element = args[0];
                if (isParaIssueNode(element)) {
                    await this.moveParaIssue(element.id, element.category, category);
                }
            }
        );
    }

    /**
     * 批量注册 PARA 分类相关命令
     * @param commandPrefix 命令前缀，例如 issueManager.para.addTo
     * @param descriptionFactory 根据分类显示名称返回命令描述
     * @param handler 实际命令处理逻辑
     */
    private registerParaCategoryCommands(
        commandPrefix: string,
        descriptionFactory: (displayName: string) => string,
        handler: (category: ParaCategory, args: unknown[]) => void | Promise<void>
    ): void {
        for (const { category, suffix, displayName } of PARA_CATEGORY_CONFIGS) {
            // issueManager.para.viewInProjects
            // issueManager.para.viewInAreas
            // issueManager.para.viewInResources
            // issueManager.para.viewInArchives
            // issueManager.para.addToProjects
            // issueManager.para.addToAreas
            // issueManager.para.addToResources
            // issueManager.para.addToArchives
            // issueManager.para.moveToProjects
            // issueManager.para.moveToAreas
            // issueManager.para.moveToResources
            // issueManager.para.moveToArchives
            const commandId = `${commandPrefix}${suffix}`;
            this.registerCommand(
                commandId,
                async (...args: unknown[]) => {
                    await handler(category, args);
                },
                descriptionFactory(displayName)
            );
        }
    }

    /**
     * 在 PARA 视图中定位并高亮显示节点
     * @param treeNode 已存在的树节点实例
     * @param category PARA类别
     */
    private async revealInParaView(treeNode: IssueNode, category: ParaCategory): Promise<void> {

        try {
            if (!this.paraView) {
                this.logger.warn('PARA 视图引用不存在,使用降级方案');
                await vscode.commands.executeCommand('issueManager.views.para.focus');
                vscode.window.showInformationMessage(`该问题位于 PARA 视图的 ${getCategoryLabel(category)} 分类中`);
                return;
            }

            const nodeId = stripFocusedId(treeNode.id);
            this.logger.info(`尝试在 PARA 视图中定位节点: ${nodeId}, 分类: ${category}`);

            // 构造目标节点
            const targetNode = {
                type: 'issue' as const,
                id: nodeId,
                category: category,
                treeNode: treeNode
            };

            // 先切换到 PARA 视图
            await vscode.commands.executeCommand('issueManager.views.para.focus');

            // 等待视图完全加载
            await new Promise(resolve => setTimeout(resolve, VIEW_REVEAL_DELAY_MS));

            // 先展开分类节点
            const categoryNode = { type: 'category' as const, category: category };
            try {
                await this.paraView.reveal(categoryNode, {
                    select: false,
                    focus: false,
                    expand: true
                });
                // 等待展开完成
                await new Promise(resolve => setTimeout(resolve, EXPAND_ANIMATION_DELAY_MS));
            } catch (error) {
                this.logger.warn('展开分类节点失败,继续尝试定位目标节点', error);
            }

            // 定位到目标节点并高亮
            await this.paraView.reveal(targetNode, {
                select: true,  // 选中节点
                focus: true,   // 聚焦节点
                expand: 1      // 展开一层子节点
            });

            this.logger.info(`成功在 PARA 视图中定位节点: ${nodeId}`);

            // 可选:短暂显示成功提示
            vscode.window.setStatusBarMessage(`✓ 已在 ${getCategoryLabel(category)} 中定位到该问题`, 2000);

        } catch (error) {
            this.logger.error('在 PARA 视图中定位节点失败:', error);
            // 降级方案：只切换到 PARA 视图
            await vscode.commands.executeCommand('issueManager.views.para.focus');
            vscode.window.showInformationMessage(`该问题位于 PARA 视图的 ${getCategoryLabel(category)} 分类中`);
        }
    }

    /**
     * 从 PARA 分类中移除问题
     * @param issueId 问题ID
     * @param category 当前所在分类
     */
    private async removeFromParaCategory(issueId: string, category: ParaCategory): Promise<void> {
        try {
            // 确认删除
            const categoryLabel = getCategoryLabel(category);
            const confirm = await vscode.window.showWarningMessage(
                `确定要从 ${categoryLabel} 中移除此问题吗？`,
                { modal: false },
                '确定'
            );

            if (confirm !== '确定') {
                return;
            }

            await removeIssueFromCategory(category, issueId);
            await vscode.commands.executeCommand('issueManager.refreshAllViews');

            vscode.window.showInformationMessage(`已从 ${categoryLabel} 中移除`);
            this.logger.info(`从 ${category} 中移除问题: ${issueId}`);

        } catch (error) {
            this.logger.error('从 PARA 分类中移除问题失败:', error);
            vscode.window.showErrorMessage(`移除失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
    }

    /**
     * 从 PARA 视图添加节点到关注视图
     * @param issueId 问题节点ID
     */
    private async addParaNodeToFocused(issueId: string): Promise<void> {
        try {
            await addFocus([issueId]);
            await Promise.all([
                vscode.commands.executeCommand('issueManager.focused.refresh'),
                vscode.commands.executeCommand('issueManager.para.refresh')
            ]);
            vscode.window.showInformationMessage('已添加到关注问题');
            this.logger.info(`从 PARA 视图添加到关注: ${issueId}`);

        } catch (error) {
            this.logger.error('从 PARA 视图添加到关注失败:', error);
            vscode.window.showErrorMessage(`添加失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
    }

    /**
     * 在 PARA 视图内移动问题到其他分类
     * @param issueId 问题ID
     * @param fromCategory 源分类
     * @param toCategory 目标分类
     */
    private async moveParaIssue(issueId: string, fromCategory: ParaCategory, toCategory: ParaCategory): Promise<void> {
        try {
            if (fromCategory === toCategory) {
                vscode.window.showInformationMessage('该问题已在目标分类中');
                return;
            }

            const fromLabel = getCategoryLabel(fromCategory);
            const toLabel = getCategoryLabel(toCategory);

            // addIssueToCategory 会自动处理从旧分类中移除的逻辑
            await addIssueToCategory(toCategory, issueId);

            await vscode.commands.executeCommand('issueManager.refreshAllViews');

            vscode.window.showInformationMessage(`已从 ${fromLabel} 移动到 ${toLabel}`);
            this.logger.info(`移动问题: ${issueId} 从 ${fromCategory} 到 ${toCategory}`);

        } catch (error) {
            this.logger.error('移动 PARA 问题失败:', error);
            vscode.window.showErrorMessage(`移动失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
    }

    /**
     * 注册 LLM 相关命令
     */
    private registerLLMCommands(): void {
        this.logger.info('🤖 注册 LLM 相关命令...');

        this.registerCommand(
            'issueManager.selectLLMModel',
            async () => {
                await selectLLMModel();
            },
            '选择 LLM 模型'
        );


        this.registerCommand(
            'issueManager.copilotDiffSend',
            async () => {
                await copilotDiffSend();
            },
            '发送当前编辑器内容到 Copilot 并展示 Diff'
        );

        this.registerCommand(
            'issueManager.copilotDiffCopyResult',
            async () => {
                await copilotDiffCopyResult();
            },
            '复制当前激活编辑器内容到剪贴板'
        );

        registerGenerateTitleCommand(this.context);
        registerGenerateBriefSummaryCommand(this.context);
        // 注册生成名称相关命令和统一入口
        registerGenerateProjectNameCommand(this.context);
        registerGenerateGitBranchCommand(this.context);
        registerUnifiedQuickOpenCommand(this.context);
        // marker 插入到关联问题的命令
        registerInsertMarksCommand(this.context, this.markerManager);
        // 插入 terms_references 到当前编辑器
        registerInsertTermsReferenceCommand(this.context);

        // 深度调研问题（生成专业文档并落盘到 issueDir）
        registerDeepResearchIssueCommand(this.context);
        registerDeepResearchIssueLocalCommand(this.context);
        registerDeepResearchIssueLlmOnlyCommand(this.context);

        // 注册智能 Agent 相关命令
        void Promise.resolve()
            .then(() => {
                const { registerSmartResearchCommand } =
                    require('../commands/smartResearchCommand') as typeof import('../commands/smartResearchCommand');
                registerSmartResearchCommand(this.context);
            })
            .catch((error: unknown) => {
                this.logger.error('注册智能 Agent 命令失败:', error);
            });

        void Promise.resolve()
            .then(() => {
                const { registerSaveAgentResearchReport } =
                    require('../commands/saveAgentResearchReport') as typeof import('../commands/saveAgentResearchReport');
                registerSaveAgentResearchReport(this.context);
            })
            .catch((error: unknown) => {
                this.logger.error('注册保存 Agent 报告命令失败:', error);
            });

        this.logger.info('✅ LLM 相关命令注册完成');

        // note: copilotDiffSaveResult command was removed per user request
    }
}
