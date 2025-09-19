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

/**
 * 视图注册管理器
 * 负责注册所有树视图和相关的拖拽控制器
 */
export class ViewRegistry {
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * 注册所有视图并返回视图实例
     */
    public registerAllViews(): {
        issueOverviewProvider: IssueOverviewProvider;
        focusedIssuesProvider: FocusedIssuesProvider;
        recentIssuesProvider: RecentIssuesProvider;
        overviewView: vscode.TreeView<IssueTreeNode>;
        focusedView: vscode.TreeView<IssueTreeNode>;
        recentIssuesView: vscode.TreeView<any>;
        rssIssuesProvider: RSSIssuesProvider;
        rssIssuesView: vscode.TreeView<any>;
        issueStructureProvider: IssueStructureProvider;
        structureView: vscode.TreeView<any>;
    } {
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