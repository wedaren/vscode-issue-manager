import * as vscode from 'vscode';
import * as path from 'path';
import { IssueOverviewProvider } from '../views/IssueOverviewProvider';
import { RecentIssuesProvider } from '../views/RecentIssuesProvider';
import { IssueDragAndDropController } from '../views/IssueDragAndDropController';
import { RSSIssuesProvider } from '../views/RSSIssuesProvider';
import { RSSIssueDragAndDropController } from '../views/RSSIssueDragAndDropController';
import { IssueStructureProvider } from '../views/IssueStructureProvider';
import { ParaViewProvider } from '../views/ParaViewProvider';
import { ParaDragAndDropController } from '../views/ParaDragAndDropController';
import { MarkerManager } from '../marker/MarkerManager';
import { MarkerTreeProvider } from '../marker/MarkerTreeProvider';
import { MarkerCommandHandler } from '../marker/MarkerCommandHandler';
import { registerRSSVirtualFileProvider } from '../views/RSSVirtualFileProvider';
import { registerRelatedIssuesView } from '../views/relatedIssuesViewRegistration';
import { IssueNode } from '../data/issueTreeManager';
import { IViewRegistryResult } from '../core/interfaces';
import { ParaViewNode } from '../types';
import { ViewContextManager } from '../services/ViewContextManager';
import { EditorGroupTreeProvider, type EditorGroupViewNode } from '../views/EditorGroupTreeProvider';
import { LLMChatRoleProvider, type LLMChatViewNode } from '../llmChat/LLMChatRoleProvider';
import { registerLLMChatCommands } from '../llmChat/llmChatCommands';
import { McpManager, registerMcpCommands } from '../llmChat/mcp';
import { RoleTimerManager } from '../llmChat/RoleTimerManager';
import { SkillManager } from '../llmChat/SkillManager';
import { getIssueDir } from '../config';

/**
 * 视图注册管理器
 * 
 * 负责创建和注册所有树视图组件、拖拽控制器和虚拟文件提供器。
 * 管理视图的生命周期，确保正确的初始化顺序和资源清理。
 * 
 * 支持的视图类型：
 * - 问题总览视图：显示完整的问题层次结构
 * - 关注问题视图：显示用户标记的重点问题
 * - 最近问题视图：显示最近访问或修改的问题
 * - RSS问题视图：显示从RSS源获取的外部问题
 * - 问题结构视图：显示问题的内部结构关系
 * - 相关问题视图：显示问题间的关联关系
 * 
 * @example
 * ```typescript
 * const registry = new ViewRegistry(context);
 * const views = registry.registerAllViews();
 * // 使用 views.overviewView, views.focusedView 等
 * ```
 */
export class ViewRegistry {
    private readonly context: vscode.ExtensionContext;
    private readonly viewContextManager: ViewContextManager;

    /**
     * 创建视图注册管理器实例
     * 
     * @param context VS Code 扩展上下文，用于视图生命周期管理
     */
    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.viewContextManager = new ViewContextManager(context);
        this.context.subscriptions.push(this.viewContextManager);
    }

    /**
     * 注册所有视图并返回视图实例
     * 
     * 按照依赖关系顺序创建和注册所有视图组件，
     * 确保每个视图都正确配置了拖拽功能和多选支持。
     * 
     * @returns {IViewRegistryResult} 包含所有视图实例的对象
     * @throws {Error} 当视图注册失败时抛出错误
     */
    public registerAllViews(): IViewRegistryResult {
        // 注册问题总览视图
        const { issueOverviewProvider, overviewView } = this.registerOverviewView();

        // 注册最近问题视图
        const { recentIssuesProvider, recentIssuesView } = this.registerRecentView();

        // 注册 PARA 视图
        const { paraViewProvider, paraView } = this.registerParaView();

        // 注册标记视图
        const { markerManager, markerTreeProvider, markerView } = this.registerMarkerView();

        // 注册编辑器组管理视图
        const { editorGroupProvider, editorGroupView } = this.registerEditorGroupView();

        // 注册 LLM 聊天角色视图
        const { llmChatRoleProvider, llmChatRoleView } = this.registerLLMChatViews();

        // 注册相关问题视图
        this.registerRelatedView();

        // 注册RSS虚拟文件提供器
        this.registerRSSVirtualFileProvider();

        return {
            issueOverviewProvider,
            recentIssuesProvider,
            overviewView,
            recentIssuesView,
            paraViewProvider,
            paraView,
            markerManager,
            markerTreeProvider,
            markerView,
            editorGroupProvider,
            editorGroupView,
            llmChatRoleProvider,
            llmChatRoleView,
        };
    }

    /**
     * 注册问题总览视图
     */
    private registerOverviewView(): {
        issueOverviewProvider: IssueOverviewProvider;
        overviewView: vscode.TreeView<IssueNode>;
    } {
        const issueOverviewProvider = new IssueOverviewProvider(this.context);
        
        const overviewView = vscode.window.createTreeView('issueManager.views.overview', {
            treeDataProvider: issueOverviewProvider,
            dragAndDropController: new IssueDragAndDropController(issueOverviewProvider, 'overview'),
            canSelectMany: true,
            showCollapseAll: true
        }) as vscode.TreeView<IssueNode>;
        
        this.context.subscriptions.push(overviewView);
        
        // 注册到视图上下文管理器
        this.viewContextManager.registerTreeView('issueManager.views.overview', overviewView);
        
        return { issueOverviewProvider, overviewView };
    }

    /**
     * 注册最近问题视图
     */
    private registerRecentView(): {
        recentIssuesProvider: RecentIssuesProvider;
        recentIssuesView: vscode.TreeView<vscode.TreeItem>;
    } {
        const recentIssuesProvider = new RecentIssuesProvider(this.context);
        
        const recentIssuesView = vscode.window.createTreeView('issueManager.views.recent', {
            treeDataProvider: recentIssuesProvider,
            dragAndDropController: new IssueDragAndDropController(recentIssuesProvider, 'recent'),
            canSelectMany: true
        });
        
        this.context.subscriptions.push(recentIssuesView);
        
        // 注册到视图上下文管理器
        this.viewContextManager.registerTreeView('issueManager.views.recent', recentIssuesView);
        
        return { recentIssuesProvider, recentIssuesView };
    }

    /**
     * 注册 PARA 视图
     */
    private registerParaView(): {
        paraViewProvider: ParaViewProvider;
        paraView: vscode.TreeView<ParaViewNode>;
    } {
        const paraViewProvider = new ParaViewProvider(this.context);
        
        const paraView = vscode.window.createTreeView('issueManager.views.para', {
            treeDataProvider: paraViewProvider,
            dragAndDropController: new ParaDragAndDropController(() => paraViewProvider.refresh()),
            canSelectMany: true,
            showCollapseAll: true
        });
        
        this.context.subscriptions.push(paraView);
        
        // 激活时加载一次数据
        paraViewProvider.loadData();
        
        return { paraViewProvider, paraView };
    }



    /**
     * 注册相关问题视图
     */
    private registerRelatedView(): void {
        registerRelatedIssuesView(this.context, this.viewContextManager);
    }

    /**
     * 注册RSS虚拟文件提供器
     */
    private registerRSSVirtualFileProvider(): void {
        const rssVirtualFileProvider = registerRSSVirtualFileProvider(this.context);
        this.context.subscriptions.push(rssVirtualFileProvider);
    }

    /**
     * 注册编辑器组管理视图
     */
    private registerEditorGroupView(): {
        editorGroupProvider: EditorGroupTreeProvider;
        editorGroupView: vscode.TreeView<EditorGroupViewNode>;
    } {
        const editorGroupProvider = new EditorGroupTreeProvider(this.context);
        const editorGroupView = vscode.window.createTreeView<EditorGroupViewNode>('issueManager.views.editorGroups', {
            treeDataProvider: editorGroupProvider,
            showCollapseAll: true,
        });

        this.context.subscriptions.push(editorGroupView);
        this.context.subscriptions.push(editorGroupProvider);
        this.context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.editorGroup.refresh', () => editorGroupProvider.refresh()),
        );

        // 注册编辑器组相关命令（关闭其他组 / 仅保留当前活动编辑器）
        // 实现在 src/commands/editorGroupCommands.ts
        try {
            // 延迟加载以避免循环依赖
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { registerEditorGroupCommands } = require('../commands/editorGroupCommands');
            registerEditorGroupCommands(this.context);
        } catch (e) {
            // ignore
        }

        return { editorGroupProvider, editorGroupView };
    }

    /**
     * 注册标记视图
     */
    private registerMarkerView(): {
        markerManager: MarkerManager;
        markerTreeProvider: MarkerTreeProvider;
        markerView: vscode.TreeView<vscode.TreeItem>;
    } {
        const markerManager = new MarkerManager(this.context);
        const markerTreeProvider = new MarkerTreeProvider(markerManager);
        
        const markerView = vscode.window.createTreeView('issueManager.views.marker', {
            treeDataProvider: markerTreeProvider,
            dragAndDropController: markerTreeProvider
        });
        
        this.context.subscriptions.push(markerView);
        
        // 注册标记命令
        const commandHandler = new MarkerCommandHandler(markerManager, markerTreeProvider);
        commandHandler.registerCommands(this.context);
        
        return { markerManager, markerTreeProvider, markerView };
    }

    /**
     * 注册 LLM 聊天角色视图和底部聊天输入面板
     */
    private registerLLMChatViews(): {
        llmChatRoleProvider: LLMChatRoleProvider;
        llmChatRoleView: vscode.TreeView<LLMChatViewNode>;
    } {
        // 侧边栏树视图：聊天角色列表
        const llmChatRoleProvider = new LLMChatRoleProvider(this.context);
        const llmChatRoleView = vscode.window.createTreeView<LLMChatViewNode>('issueManager.views.llmChat', {
            treeDataProvider: llmChatRoleProvider,
            showCollapseAll: true,
        });

        this.context.subscriptions.push(llmChatRoleView);
        this.context.subscriptions.push(llmChatRoleProvider);

        // 绑定 TreeView：选中节点时自动预览对应文件（不抢焦点）
        llmChatRoleProvider.bindTreeView(llmChatRoleView);

        // 初始化 MCP 管理器（配置存储在 issueDir/.issueManager/）
        const mcpManager = McpManager.getInstance();
        const issueDir = getIssueDir();
        if (issueDir) {
            void mcpManager.initialize(issueDir);
            void SkillManager.getInstance().initialize(issueDir);
        }
        this.context.subscriptions.push(mcpManager);
        registerMcpCommands(this.context);

        // Skills 命令
        this.context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.skills.refresh', async () => {
                await SkillManager.getInstance().rescan();
                llmChatRoleProvider.refresh();
            }),
            vscode.commands.registerCommand('issueManager.skills.openSkillDir', (node: { skill?: { filePath: string } }) => {
                if (node?.skill?.filePath) {
                    const dirUri = vscode.Uri.file(path.dirname(node.skill.filePath));
                    void vscode.commands.executeCommand('vscode.openFolder', dirUri, true);
                }
            }),
            vscode.commands.registerCommand('issueManager.skills.revealInExplorer', (node: { skill?: { filePath: string } }) => {
                if (node?.skill?.filePath) {
                    const dirPath = path.dirname(node.skill.filePath);
                    void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(dirPath));
                }
            }),
            vscode.commands.registerCommand('issueManager.skills.importToProject', async () => {
                const mgr = SkillManager.getInstance();
                const result = await mgr.importPersonalToProject();
                if (result.copied > 0) {
                    await mgr.rescan();
                    llmChatRoleProvider.refresh();
                    vscode.window.showInformationMessage(`已导入 ${result.copied} 个 skill 到笔记库（跳过 ${result.skipped} 个已存在）`);
                } else if (result.skipped > 0) {
                    vscode.window.showInformationMessage(`所有 ${result.skipped} 个 skill 已存在于笔记库，无需导入`);
                } else {
                    vscode.window.showInformationMessage('未发现个人级 skill（~/.agents/skills/ 为空）');
                }
            }),
        );

        // 注册聊天相关命令
        registerLLMChatCommands(this.context, llmChatRoleProvider, llmChatRoleView);

        // 启动角色定时器管理器
        const timerManager = RoleTimerManager.getInstance();
        void timerManager.start();
        this.context.subscriptions.push(timerManager);

        return { llmChatRoleProvider, llmChatRoleView };
    }
}