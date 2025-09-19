import * as vscode from 'vscode';
import { IssueOverviewProvider } from '../views/IssueOverviewProvider';
import { FocusedIssuesProvider } from '../views/FocusedIssuesProvider';
import { RecentIssuesProvider } from '../views/RecentIssuesProvider';
import { IssueDragAndDropController } from '../views/IssueDragAndDropController';
import { RSSIssuesProvider } from '../views/RSSIssuesProvider';
import { RSSIssueDragAndDropController } from '../views/RSSIssueDragAndDropController';
import { IssueStructureProvider } from '../views/IssueStructureProvider';
import { registerRSSVirtualFileProvider } from '../views/RSSVirtualFileProvider';
import { registerRelatedIssuesView } from '../views/relatedIssuesViewRegistration';
import { IssueTreeNode } from '../data/treeManager';
import { IViewRegistryResult } from './interfaces';

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

    /**
     * 创建视图注册管理器实例
     * 
     * @param context VS Code 扩展上下文，用于视图生命周期管理
     */
    constructor(context: vscode.ExtensionContext) {
        this.context = context;
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
        
        // 注册RSS问题视图
        const { rssIssuesProvider, rssIssuesView } = this.registerRSSView();
        
        // 注册问题结构视图
        const { issueStructureProvider, structureView } = this.registerStructureView();
        
        // 注册相关问题视图
        this.registerRelatedView();
        
        // 注册RSS虚拟文件提供器
        this.registerRSSVirtualFileProvider();

        return {
            issueOverviewProvider,
            focusedIssuesProvider,
            recentIssuesProvider,
            overviewView,
            focusedView,
            recentIssuesView,
            rssIssuesProvider,
            rssIssuesView,
            issueStructureProvider,
            structureView
        };
    }

    /**
     * 注册问题总览视图
     */
    private registerOverviewView(): {
        issueOverviewProvider: IssueOverviewProvider;
        overviewView: vscode.TreeView<IssueTreeNode>;
    } {
        const issueOverviewProvider = new IssueOverviewProvider(this.context);
        
        const overviewView = vscode.window.createTreeView('issueManager.views.overview', {
            treeDataProvider: issueOverviewProvider,
            dragAndDropController: new IssueDragAndDropController(issueOverviewProvider, 'overview'),
            canSelectMany: true,
            showCollapseAll: true
        }) as vscode.TreeView<IssueTreeNode>;
        
        this.context.subscriptions.push(overviewView);
        
        return { issueOverviewProvider, overviewView };
    }

    /**
     * 注册关注问题视图
     */
    private registerFocusedView(): {
        focusedIssuesProvider: FocusedIssuesProvider;
        focusedView: vscode.TreeView<IssueTreeNode>;
    } {
        const focusedIssuesProvider = new FocusedIssuesProvider(this.context);
        
        const focusedView = vscode.window.createTreeView('issueManager.views.focused', {
            treeDataProvider: focusedIssuesProvider,
            dragAndDropController: new IssueDragAndDropController(focusedIssuesProvider, 'focused'),
            canSelectMany: true,
            showCollapseAll: true
        }) as vscode.TreeView<IssueTreeNode>;
        
        this.context.subscriptions.push(focusedView);
        
        // 激活时加载一次数据
        focusedIssuesProvider.loadData();
        
        return { focusedIssuesProvider, focusedView };
    }

    /**
     * 注册最近问题视图
     */
    private registerRecentView(): {
        recentIssuesProvider: RecentIssuesProvider;
        recentIssuesView: vscode.TreeView<any>;
    } {
        const recentIssuesProvider = new RecentIssuesProvider(this.context);
        
        const recentIssuesView = vscode.window.createTreeView('issueManager.views.recent', {
            treeDataProvider: recentIssuesProvider,
            dragAndDropController: new IssueDragAndDropController(recentIssuesProvider, 'recent'),
            canSelectMany: true
        });
        
        this.context.subscriptions.push(recentIssuesView);
        
        return { recentIssuesProvider, recentIssuesView };
    }

    /**
     * 注册RSS问题视图
     */
    private registerRSSView(): {
        rssIssuesProvider: RSSIssuesProvider;
        rssIssuesView: vscode.TreeView<any>;
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
        structureView: vscode.TreeView<any>;
    } {
        const issueStructureProvider = new IssueStructureProvider(this.context);
        
        const structureView = vscode.window.createTreeView('issueManager.views.structure', {
            treeDataProvider: issueStructureProvider
        });
        
        this.context.subscriptions.push(structureView);
        this.context.subscriptions.push(issueStructureProvider);
        
        // 注册结构视图刷新命令
        const structureRefreshCommand = vscode.commands.registerCommand('issueManager.structure.refresh', () => {
            issueStructureProvider.refresh();
        });
        this.context.subscriptions.push(structureRefreshCommand);
        
        return { issueStructureProvider, structureView };
    }

    /**
     * 注册相关问题视图
     */
    private registerRelatedView(): void {
        registerRelatedIssuesView(this.context);
    }

    /**
     * 注册RSS虚拟文件提供器
     */
    private registerRSSVirtualFileProvider(): void {
        const rssVirtualFileProvider = registerRSSVirtualFileProvider(this.context);
        this.context.subscriptions.push(rssVirtualFileProvider);
    }
}