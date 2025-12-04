import * as vscode from 'vscode';
import { IFocusedIssuesProvider, IIssueOverviewProvider, IIssueViewProvider } from './interfaces';
import { IssueTreeNode, readTree, removeNode, stripFocusedId, writeTree } from '../data/treeManager';
import { isIssueTreeNode } from '../utils/treeUtils';
import { ViewCommandRegistry } from './commands/ViewCommandRegistry';
import { StateCommandRegistry } from './commands/StateCommandRegistry';
import { BaseCommandRegistry } from './commands/BaseCommandRegistry';
import { Logger } from './utils/Logger';
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
import { registerOpenIssueDirCommand, registerOpenvscodeIssueManagerDirCommand } from '../commands/openIssueDir';
import { registerSearchIssuesCommand } from '../commands/searchIssues';
import { registerDeleteIssueCommand } from '../commands/deleteIssue';
import { registerFocusCommands } from '../commands/focusCommands';
import { registerCreateSubIssueCommand } from '../commands/createSubIssue';
import { registerCreateSubIssueFromEditorCommand } from '../commands/createSubIssueFromEditor';
import { smartCreateIssue } from '../commands/smartCreateIssue';
import { createIssueFromClipboard } from '../commands/createIssueFromClipboard';
import { createIssueFromHtml, CreateIssueFromHtmlParams } from '../commands/createIssueFromHtml';
import { addIssueToTree } from '../commands/issueFileUtils';
import { moveIssuesTo } from '../commands/moveTo';
import { IssueStructureProvider } from '../views/IssueStructureProvider';
import { ParaViewProvider } from '../views/ParaViewProvider';
import { getIssueIdFromUri } from '../utils/uriUtils';
import { selectLLMModel } from '../commands/llmCommands';
import { TitleCacheService } from '../services/TitleCacheService';



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
        overviewView: vscode.TreeView<IssueTreeNode>,
        focusedView: vscode.TreeView<IssueTreeNode>,
        issueStructureProvider: IssueStructureProvider,
        paraViewProvider: ParaViewProvider,
        paraView?: vscode.TreeView<ParaViewNode>
    ): void {
        // 保存 paraView 引用
        this.paraView = paraView;
        this.logger.info('🔧 开始注册命令...');

        try {
            // 1. 注册基础问题管理命令
            this.registerBasicIssueCommands();

            // 2. 设置视图提供者并注册视图命令
            this.viewCommandRegistry.setProviders({
                focusedIssuesProvider,
                issueOverviewProvider,
                recentIssuesProvider,
                paraViewProvider,
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

            // 7. 注册结构视图命令
            this.registerStructureViewCommands(issueStructureProvider);

            // 8. 注册 PARA 视图命令
            this.registerParaCommands();

            // 9. 注册 LLM 相关命令
            this.registerLLMCommands();

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
                const [node, nodes] = args;
                if (nodes && Array.isArray(nodes) && nodes.length > 0) {
                    const validNodes = nodes.filter(isIssueTreeNode);
                    await moveIssuesTo(validNodes);
                } else if (node && isIssueTreeNode(node)) {
                    await moveIssuesTo([node]);
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


        this.registerCommand(
            'issueManager.refreshTitle',
            async () => {
                TitleCacheService.getInstance().forceRebuild();
            },
            '重新渲染标题'
        );

        // 显示问题关系图命令
        this.registerCommand(
            'issueManager.showRelationGraph',
            async (...args: unknown[]) => {
                const uri = args[0] as vscode.Uri | undefined;
                const { WebviewManager } = await import('../webview/WebviewManager');
                const { ShowRelationGraphCommand } = await import('../commands/ShowRelationGraphCommand');
                const { GraphDataService } = await import('../services/GraphDataService');

                const webviewManager = WebviewManager.getInstance(this.context);
                const graphDataService = GraphDataService.getInstance();

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
                const { WebviewManager } = await import('../webview/WebviewManager');
                const { ShowMindMapCommand } = await import('../commands/ShowMindMapCommand');
                const { GraphDataService } = await import('../services/GraphDataService');

                const webviewManager = WebviewManager.getInstance(this.context);
                const graphDataService = GraphDataService.getInstance();

                const command = new ShowMindMapCommand(this.context, webviewManager, graphDataService);
                await command.execute(uri);
            },
            '显示思维导图'
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
        registerSearchIssuesCommand(this.context);
        registerDeleteIssueCommand(this.context);
        registerFocusCommands(this.context);
        // 注册外部实现的子问题创建命令
        registerCreateSubIssueCommand(this.context);
        registerCreateSubIssueFromEditorCommand(this.context);
    }

    /**
     * 注册问题操作命令
     */
    private registerIssueOperationCommands(): void {
        this.logger.info('⚡ 注册问题操作命令...');

        // 子问题创建命令由外部模块注册（createSubIssue / createSubIssueFromEditor）

        // 从关注问题视图创建新问题
                this.registerCommand(
            'issueManager.createIssueFromFocused',
            async () => {
                await smartCreateIssue(null, { addToTree: true, addToFocused: true });
                vscode.commands.executeCommand('issueManager.refreshAllViews');
            },
            '从关注问题视图创建新问题'
        );

        // 从问题总览视图创建新问题
        this.registerCommand(
            'issueManager.createIssueFromOverview',
            async () => {
                await smartCreateIssue(null, { addToTree: true });
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


        // 解除问题关联命令
        this.registerCommand(
            'issueManager.disassociateIssue',
            async (...args: unknown[]) => {
                // 类型守卫，确保 node 是一个有效的 IssueTreeNode
                const node = (Array.isArray(args) && args.length > 0) ? args[0] : null;

                if (!node || !isIssueTreeNode(node) || node.id === 'placeholder-no-issues') {
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
                if (node && isIssueTreeNode(node)) {
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

        this.registerParaCategoryCommands(
            'issueManager.para.viewIn',
            (displayName: string) => `在 ${displayName} 中查看`,
            async (category: ParaCategory, args: unknown[]) => {
                const node = args[0];
                if (node && isIssueTreeNode(node)) {
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
    private async revealInParaView(treeNode: IssueTreeNode, category: ParaCategory): Promise<void> {

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
            // @ts-ignore - 动态导入路径特意省略了扩展名，以便 webpack 可以解析 TS 模块
            const { addFocus } = await import('../data/focusedManager') as { addFocus: (nodeIds: string[]) => Promise<void> };
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
    }
}