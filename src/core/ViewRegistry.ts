import * as vscode from 'vscode';
import { IssueOverviewProvider } from '../views/IssueOverviewProvider';
import { FocusedIssuesProvider } from '../views/FocusedIssuesProvider';
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
import { GitBranchManager } from '../gitBranch/GitBranchManager';
import { GitBranchTreeProvider } from '../gitBranch/GitBranchTreeProvider';
import { GitBranchCommandHandler } from '../gitBranch/GitBranchCommandHandler';
import { registerRSSVirtualFileProvider } from '../views/RSSVirtualFileProvider';
import { registerRelatedIssuesView } from '../views/relatedIssuesViewRegistration';
import { IssueSearchViewProvider } from '../views/IssueSearchViewProvider';
import type { IssueSearchViewNode } from '../views/IssueSearchViewProvider';
import { IssueNode } from '../data/issueTreeManager';
import { IViewRegistryResult } from '../core/interfaces';
import { ParaViewNode } from '../types';
import { ViewContextManager } from '../services/ViewContextManager';
// 新增 Agent 视图导入
import { KnowledgeGraphViewProvider } from '../views/KnowledgeGraphViewProvider';
import { LearningPathViewProvider } from '../views/LearningPathViewProvider';
import { IdeaSparkViewProvider } from '../views/IdeaSparkViewProvider';

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
        
        // 注册关注问题视图
        const { focusedIssuesProvider, focusedView } = this.registerFocusedView();
        
        // 注册最近问题视图
        const { recentIssuesProvider, recentIssuesView } = this.registerRecentView();

        // 注册问题搜索视图
        const { issueSearchProvider, issueSearchView } = this.registerIssueSearchView();
        
        // 注册RSS问题视图
        // const { rssIssuesProvider, rssIssuesView } = this.registerRSSView();
        
        // // 注册问题结构视图
        // const { issueStructureProvider, structureView } = this.registerStructureView();
        
        // 注册问题逻辑树视图（基于 issue_ frontmatter 字段）
        // const { issueLogicalTreeProvider, logicalTreeView } = this.registerLogicalTreeView();
        
        // 注册 PARA 视图
        const { paraViewProvider, paraView } = this.registerParaView();
        
        // 笔记映射视图已移除（不再注册）
        
        // 注册标记视图
        const { markerManager, markerTreeProvider, markerView } = this.registerMarkerView();

        // 注册 Git 分支视图
        const { gitBranchManager, gitBranchProvider, gitBranchView } = this.registerGitBranchView();
        
        // 注册相关问题视图
        this.registerRelatedView();
        
        // 注册RSS虚拟文件提供器
        this.registerRSSVirtualFileProvider();

        // 注册 Agent 视图
        const knowledgeGraphProvider = this.registerKnowledgeGraphView();
        const learningPathProvider = this.registerLearningPathView();
        const ideaSparkProvider = this.registerIdeaSparkView();

        return {
            issueOverviewProvider,
            focusedIssuesProvider,
            recentIssuesProvider,
            overviewView,
            focusedView,
            recentIssuesView,
            issueSearchProvider,
            issueSearchView,
            // rssIssuesProvider,
            // rssIssuesView,
            // issueStructureProvider,
            // structureView,
            // issueLogicalTreeProvider,
            // logicalTreeView,
            paraViewProvider,
            paraView,
            // noteMappingProvider, // removed
            // noteMappingView,     // removed
            markerManager,
            markerTreeProvider,
            markerView,
            gitBranchManager,
            gitBranchProvider,
            gitBranchView,
            // Agent 视图
            knowledgeGraphProvider,
            learningPathProvider,
            ideaSparkProvider
        };
    }

    /**
     * 注册问题搜索视图
     */
    private registerIssueSearchView(): {
        issueSearchProvider: IssueSearchViewProvider;
        issueSearchView: vscode.TreeView<IssueSearchViewNode>;
    } {
        const issueSearchProvider = new IssueSearchViewProvider(this.context);
        const issueSearchView = vscode.window.createTreeView<IssueSearchViewNode>('issueManager.views.search', {
            treeDataProvider: issueSearchProvider,
            showCollapseAll: true
        });

        this.context.subscriptions.push(issueSearchView);

        return { issueSearchProvider, issueSearchView };
    }

    /**
     * 注册 Git 分支视图
     */
    private registerGitBranchView(): {
        gitBranchManager: GitBranchManager;
        gitBranchProvider: GitBranchTreeProvider;
        gitBranchView: vscode.TreeView<vscode.TreeItem>;
    } {
        const gitBranchManager = new GitBranchManager(this.context);
        const gitBranchProvider = new GitBranchTreeProvider(gitBranchManager);

        const gitBranchView = vscode.window.createTreeView('issueManager.views.gitBranches', {
            treeDataProvider: gitBranchProvider,
            showCollapseAll: true
        });

        this.context.subscriptions.push(gitBranchView);

        const commandHandler = new GitBranchCommandHandler(gitBranchManager, gitBranchProvider);
        commandHandler.registerCommands(this.context);

        // 首次刷新数据
        void gitBranchManager.refresh();

        return { gitBranchManager, gitBranchProvider, gitBranchView };
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
     * 注册关注问题视图
     */
    private registerFocusedView(): {
        focusedIssuesProvider: FocusedIssuesProvider;
        focusedView: vscode.TreeView<IssueNode>;
    } {
        const focusedIssuesProvider = new FocusedIssuesProvider(this.context);
        
        const focusedView = vscode.window.createTreeView('issueManager.views.focused', {
            treeDataProvider: focusedIssuesProvider,
            dragAndDropController: new IssueDragAndDropController(focusedIssuesProvider, 'focused'),
            canSelectMany: true,
            showCollapseAll: true
        }) as vscode.TreeView<IssueNode>;
        
        this.context.subscriptions.push(focusedView);
        
        // 注册到视图上下文管理器
        this.viewContextManager.registerTreeView('issueManager.views.focused', focusedView);
        
        // 激活时加载一次数据
        focusedIssuesProvider.loadData();
        
        return { focusedIssuesProvider, focusedView };
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
     * 注册RSS问题视图
     */
    private registerRSSView(): {
        rssIssuesProvider: RSSIssuesProvider;
        rssIssuesView: vscode.TreeView<vscode.TreeItem>;
    } {
        const rssIssuesProvider = new RSSIssuesProvider(this.context);
        
        const rssIssuesView = vscode.window.createTreeView('issueManager.views.rss', {
            treeDataProvider: rssIssuesProvider,
            dragAndDropController: new RSSIssueDragAndDropController(),
            canSelectMany: true
        });
        
        this.context.subscriptions.push(rssIssuesView);
        this.context.subscriptions.push(rssIssuesProvider);
        
        return { rssIssuesProvider, rssIssuesView };
    }

    /**
     * 注册问题结构视图
     */
    private registerStructureView(): {
        issueStructureProvider: IssueStructureProvider;
        structureView: vscode.TreeView<vscode.TreeItem>;
    } {
        const issueStructureProvider = new IssueStructureProvider(this.context);
        
        const structureView = vscode.window.createTreeView('issueManager.views.structure', {
            treeDataProvider: issueStructureProvider
        });
        
        this.context.subscriptions.push(structureView);
        this.context.subscriptions.push(issueStructureProvider);
        
        return { issueStructureProvider, structureView };
    }

    // /**
    //  * 注册问题逻辑树视图（基于 issue_ frontmatter 字段）
    //  */
    // private registerLogicalTreeView(): {
    //     issueLogicalTreeProvider: IssueLogicalTreeProvider;
    //     logicalTreeView: vscode.TreeView<IssueLogicalTreeNode>;
    // } {
    //     const issueLogicalTreeProvider = new IssueLogicalTreeProvider(this.context);
        
    //     const logicalTreeView = vscode.window.createTreeView('issueManager.views.logicalTree', {
    //         treeDataProvider: issueLogicalTreeProvider,
    //         showCollapseAll: true
    //     });
        
    //     this.context.subscriptions.push(logicalTreeView);
    //     this.context.subscriptions.push(issueLogicalTreeProvider);
        
    //     return { issueLogicalTreeProvider, logicalTreeView };
    // }

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
     * 注册知识图谱视图
     */
    private registerKnowledgeGraphView(): KnowledgeGraphViewProvider {
        return KnowledgeGraphViewProvider.register(this.context);
    }

    /**
     * 注册学习路径视图
     */
    private registerLearningPathView(): LearningPathViewProvider {
        return LearningPathViewProvider.register(this.context);
    }

    /**
     * 注册创意激发视图
     */
    private registerIdeaSparkView(): IdeaSparkViewProvider {
        return IdeaSparkViewProvider.register(this.context);
    }
}