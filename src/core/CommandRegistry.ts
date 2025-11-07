import * as vscode from 'vscode';
import * as path from 'path';
import { IFocusedIssuesProvider, IIssueOverviewProvider, IIssueViewProvider } from './interfaces';
import { IssueTreeNode, readTree, removeNode, stripFocusedId, writeTree } from '../data/treeManager';
import { ViewCommandRegistry } from './commands/ViewCommandRegistry';
import { StateCommandRegistry } from './commands/StateCommandRegistry';
import { BaseCommandRegistry } from './commands/BaseCommandRegistry';
import { Logger } from './utils/Logger';
import { ParaCategory, removeIssueFromCategory, addIssueToCategory, getCategoryLabel } from '../data/paraManager';
import { addIssueToParaCategory } from '../commands/paraCommands';
import { isParaIssueNode, ParaViewNode } from '../types';
import { getIssueDir } from '../config';
import { ParaCategoryCache } from '../services/ParaCategoryCache';

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
import { smartCreateIssue } from '../commands/smartCreateIssue';
import { createIssueFromClipboard } from '../commands/createIssueFromClipboard';
import { createIssueFromHtml, CreateIssueFromHtmlParams } from '../commands/createIssueFromHtml';
import { addIssueToTree } from '../commands/issueFileUtils';
import { moveIssuesTo } from '../commands/moveTo';
import { IssueStructureProvider } from '../views/IssueStructureProvider';
import { ParaViewProvider } from '../views/ParaViewProvider';
import { getIssueIdFromUri } from '../utils/uriUtils';

/**
 * 类型守卫函数：检查对象是否为有效的 IssueTreeNode
 * @param item 要检查的对象
 * @returns 如果是有效的 IssueTreeNode 则返回 true
 */
function isIssueTreeNode(item: unknown): item is IssueTreeNode {
    return !!item && typeof item === 'object' && 'id' in item && 'filePath' in item;
}

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
    
    // 保存视图引用
    private paraView?: vscode.TreeView<ParaViewNode>;
    private overviewView?: vscode.TreeView<IssueTreeNode>;
    private focusedView?: vscode.TreeView<IssueTreeNode>;
    private recentIssuesView?: vscode.TreeView<vscode.TreeItem>;
    
    // 保存视图提供者引用
    private issueOverviewProvider?: IIssueOverviewProvider;
    private focusedIssuesProvider?: IFocusedIssuesProvider;
    private recentIssuesProvider?: IIssueViewProvider<vscode.TreeItem>;
    private paraViewProvider?: ParaViewProvider;

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

    /**
     * 设置视图提供者并注册所有命令
     * 
     * @param focusedIssuesProvider 关注问题视图提供者
     * @param issueOverviewProvider 问题总览视图提供者
     * @param recentIssuesProvider 最近问题视图提供者
     * @param overviewView 总览树视图实例
     * @param focusedView 关注问题树视图实例
     * @param recentIssuesView 最近问题树视图实例
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
        recentIssuesView: vscode.TreeView<vscode.TreeItem>,
        issueStructureProvider: IssueStructureProvider,
        paraViewProvider: ParaViewProvider,
        paraView?: vscode.TreeView<ParaViewNode>
    ): void {
        // 保存视图和提供者引用
        this.paraView = paraView;
        this.overviewView = overviewView;
        this.focusedView = focusedView;
        this.recentIssuesView = recentIssuesView;
        this.issueOverviewProvider = issueOverviewProvider;
        this.focusedIssuesProvider = focusedIssuesProvider;
        this.recentIssuesProvider = recentIssuesProvider;
        this.paraViewProvider = paraViewProvider;
        
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
                    if(node.id && uri){
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
                const [node,nodes] = args;
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
                if (node && isIssueTreeNode(node)) {
                    // 使用智能创建问题功能，并指定父节点ID和添加到树
                    const id = stripFocusedId(node.id);
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
        
        // 注册 reveal 命令
        this.registerRevealCommands();
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
     * 注册 reveal 命令
     * 在编辑器右键菜单中提供在不同视图中显示当前文档的功能
     */
    private registerRevealCommands(): void {
        this.logger.info('👁️ 注册 reveal 命令...');

        // 在问题总览中显示
        this.registerCommand(
            'issueManager.revealInOverview',
            async () => {
                await this.revealCurrentFileInView('overview');
            },
            '在问题总览中显示'
        );

        // 在关注问题中显示
        this.registerCommand(
            'issueManager.revealInFocused',
            async () => {
                await this.revealCurrentFileInView('focused');
            },
            '在关注问题中显示'
        );

        // 在 PARA 视图中显示
        this.registerCommand(
            'issueManager.revealInPara',
            async () => {
                await this.revealCurrentFileInView('para');
            },
            '在 PARA 视图中显示'
        );

        // 在最近问题中显示
        this.registerCommand(
            'issueManager.revealInRecent',
            async () => {
                await this.revealCurrentFileInView('recent');
            },
            '在最近问题中显示'
        );
    }

    /**
     * 在指定视图中定位并高亮当前打开的文件
     * @param viewType 视图类型
     */
    private async revealCurrentFileInView(viewType: 'overview' | 'focused' | 'para' | 'recent'): Promise<void> {
        try {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('没有激活的编辑器。');
                return;
            }

            const uri = editor.document.uri;
            const issueDir = getIssueDir();
            if (!issueDir) {
                vscode.window.showWarningMessage('问题目录未配置。');
                return;
            }

            // 检查是否是问题目录下的文件
            if (!uri.fsPath.startsWith(issueDir)) {
                vscode.window.showWarningMessage('当前文件不在问题目录中。');
                return;
            }

            switch (viewType) {
                case 'overview':
                    await this.revealInOverviewView(uri);
                    break;
                case 'focused':
                    await this.revealInFocusedView(uri);
                    break;
                case 'para':
                    await this.revealInParaViewByUri(uri);
                    break;
                case 'recent':
                    await this.revealInRecentView(uri);
                    break;
            }
        } catch (error) {
            this.logger.error(`在 ${viewType} 视图中显示文件失败:`, error);
            vscode.window.showErrorMessage(`在视图中显示失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
    }

    /**
     * 在问题总览视图中定位文件
     */
    private async revealInOverviewView(uri: vscode.Uri): Promise<void> {
        if (!this.overviewView || !this.issueOverviewProvider) {
            vscode.window.showWarningMessage('问题总览视图未初始化。');
            return;
        }

        const node = this.issueOverviewProvider.findNodeByUri(uri);
        if (!node) {
            vscode.window.showWarningMessage('在问题总览中未找到该文件。');
            return;
        }

        // 切换到视图并定位
        await vscode.commands.executeCommand('issueManager.views.overview.focus');
        await new Promise(resolve => setTimeout(resolve, VIEW_REVEAL_DELAY_MS));
        
        await this.overviewView.reveal(node, {
            select: true,
            focus: true,
            expand: true
        });

        vscode.window.setStatusBarMessage('✓ 已在问题总览中定位', 2000);
    }

    /**
     * 在关注问题视图中定位文件
     */
    private async revealInFocusedView(uri: vscode.Uri): Promise<void> {
        if (!this.focusedView || !this.focusedIssuesProvider) {
            vscode.window.showWarningMessage('关注问题视图未初始化。');
            return;
        }

        // 先尝试通过 URI 找到对应的问题 ID
        const issueDir = getIssueDir();
        if (!issueDir) {
            vscode.window.showWarningMessage('问题目录未配置。');
            return;
        }

        // 从 URI 中提取相对路径作为 ID 查找
        const relativePath = path.relative(issueDir, uri.fsPath);
        const issueId = relativePath.replace(/\\/g, '/');

        const result = this.focusedIssuesProvider.findFirstFocusedNodeById(issueId);
        if (!result) {
            vscode.window.showWarningMessage('该文件未在关注问题中。');
            return;
        }

        // 切换到视图并定位
        await vscode.commands.executeCommand('issueManager.views.focused.focus');
        await new Promise(resolve => setTimeout(resolve, VIEW_REVEAL_DELAY_MS));
        
        await this.focusedView.reveal(result.node, {
            select: true,
            focus: true,
            expand: true
        });

        vscode.window.setStatusBarMessage('✓ 已在关注问题中定位', 2000);
    }

    /**
     * 在 PARA 视图中定位文件
     */
    private async revealInParaViewByUri(uri: vscode.Uri): Promise<void> {
        if (!this.paraView || !this.paraViewProvider) {
            vscode.window.showWarningMessage('PARA 视图未初始化。');
            return;
        }

        // 从 URI 获取问题 ID
        const issueDir = getIssueDir();
        if (!issueDir) {
            vscode.window.showWarningMessage('问题目录未配置。');
            return;
        }

        const relativePath = path.relative(issueDir, uri.fsPath);
        const issueId = relativePath.replace(/\\/g, '/');

        // 获取该问题的 PARA 分类
        const paraCategoryCache = ParaCategoryCache.getInstance(this.context);
        const { paraCategory } = paraCategoryCache.getParaMetadata(issueId);

        if (!paraCategory) {
            vscode.window.showWarningMessage('该文件未分配到任何 PARA 分类。');
            return;
        }

        // 构造节点并定位
        // 需要一个临时的 IssueTreeNode 用于定位
        const tempNode: IssueTreeNode = {
            id: issueId,
            filePath: relativePath,
            children: []
        };

        await this.revealInParaView(tempNode, paraCategory);
    }

    /**
     * 在最近问题视图中定位文件
     * 
     * 注意：最近问题视图具有特殊的结构（支持分组和列表两种模式），
     * 并且使用 TreeItem 而不是 IssueTreeNode，这使得直接定位变得复杂。
     * 
     * 当前实现：切换到最近问题视图并刷新，文件会出现在视图中但不会被高亮。
     * 
     * 未来改进方向：
     * 1. 在 RecentIssuesProvider 中添加 findFileInView 方法
     * 2. 实现根据视图模式（列表/分组）的不同查找逻辑
     * 3. 支持在分组模式下展开包含目标文件的组并高亮文件
     */
    private async revealInRecentView(uri: vscode.Uri): Promise<void> {
        if (!this.recentIssuesView) {
            vscode.window.showWarningMessage('最近问题视图未初始化。');
            return;
        }

        // 切换到最近问题视图
        await vscode.commands.executeCommand('issueManager.views.recent.focus');
        
        // 刷新视图以确保当前文件在列表中
        if (this.recentIssuesProvider) {
            this.recentIssuesProvider.refresh();
        }
        
        // 提示用户：由于视图结构复杂，无法直接定位
        // 但文件会在视图中可见（按排序规则）
        vscode.window.setStatusBarMessage('✓ 已切换到最近问题视图', 2000);
        this.logger.info('已切换到最近问题视图，文件可见但未高亮');
    }
}