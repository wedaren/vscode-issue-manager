import * as vscode from 'vscode';
import { IssueOverviewProvider } from '../views/IssueOverviewProvider';
import { FocusedIssuesProvider } from '../views/FocusedIssuesProvider';
import { RecentIssuesProvider } from '../views/RecentIssuesProvider';
import { RSSIssuesProvider } from '../views/RSSIssuesProvider';
import { IssueStructureProvider } from '../views/IssueStructureProvider';
import { IssueDragAndDropController } from '../views/IssueDragAndDropController';
import { RSSIssueDragAndDropController } from '../views/RSSIssueDragAndDropController';
import { registerRelatedIssuesView } from '../views/relatedIssuesViewRegistration';
import { registerRSSVirtualFileProvider } from '../views/RSSVirtualFileProvider';
import { IssueTreeNode, readTree, writeTree, updateNodeExpanded, stripFocusedId } from '../data/treeManager';

/**
 * 视图注册器
 * 负责注册所有的TreeView和相关的视图组件
 */
export class ViewRegistrar {
    /**
     * 注册所有视图
     */
    static register(context: vscode.ExtensionContext): {
        issueOverviewProvider: IssueOverviewProvider;
        focusedIssuesProvider: FocusedIssuesProvider;
        recentIssuesProvider: RecentIssuesProvider;
        overviewView: vscode.TreeView<IssueTreeNode>;
        focusedView: vscode.TreeView<IssueTreeNode>;
    } {
        // 注册"问题总览"视图
        const issueOverviewProvider = new IssueOverviewProvider(context);
        const overviewView = vscode.window.createTreeView('issueManager.views.overview', {
            treeDataProvider: issueOverviewProvider,
            dragAndDropController: new IssueDragAndDropController(issueOverviewProvider, 'overview'),
            canSelectMany: true, // 允许多选
            showCollapseAll: true // 启用折叠所有功能
        });
        context.subscriptions.push(overviewView);

        // 注册"关注问题"视图
        const focusedIssuesProvider = new FocusedIssuesProvider(context);
        const focusedView = vscode.window.createTreeView('issueManager.views.focused', {
            treeDataProvider: focusedIssuesProvider,
            dragAndDropController: new IssueDragAndDropController(focusedIssuesProvider, 'focused'),
            canSelectMany: true,
            showCollapseAll: true // 启用折叠所有功能
        });
        context.subscriptions.push(focusedView);

        // 注册"最近问题"视图
        const recentIssuesProvider = new RecentIssuesProvider(context);
        const recentIssuesView = vscode.window.createTreeView('issueManager.views.recent', {
            treeDataProvider: recentIssuesProvider,
            dragAndDropController: new IssueDragAndDropController(recentIssuesProvider, 'recent'),
            canSelectMany: true
        });
        context.subscriptions.push(recentIssuesView);

        // 注册RSS问题视图
        const rssIssuesProvider = new RSSIssuesProvider(context);
        const rssIssuesView = vscode.window.createTreeView('issueManager.views.rss', {
            treeDataProvider: rssIssuesProvider,
            dragAndDropController: new RSSIssueDragAndDropController(),
            canSelectMany: true // 启用多选以支持批量拖拽
        });
        context.subscriptions.push(rssIssuesView);
        context.subscriptions.push(rssIssuesProvider);

        // 注册RSS虚拟文件提供器
        const rssVirtualFileProvider = registerRSSVirtualFileProvider(context);
        context.subscriptions.push(rssVirtualFileProvider);

        // 注册问题结构视图
        const issueStructureProvider = new IssueStructureProvider(context);
        const structureView = vscode.window.createTreeView('issueManager.views.structure', {
            treeDataProvider: issueStructureProvider
        });
        context.subscriptions.push(structureView);
        context.subscriptions.push(issueStructureProvider);

        // 注册相关问题视图
        registerRelatedIssuesView(context);

        // 激活时加载一次数据
        focusedIssuesProvider.loadData();

        // ========== TreeView 展开/折叠状态同步与持久化 ==========
        this.registerExpandCollapseSync(overviewView as vscode.TreeView<IssueTreeNode>, 'overview');
        this.registerExpandCollapseSync(focusedView as vscode.TreeView<IssueTreeNode>, 'focused');

        return {
            issueOverviewProvider,
            focusedIssuesProvider,
            recentIssuesProvider,
            overviewView: overviewView as vscode.TreeView<IssueTreeNode>,
            focusedView: focusedView as vscode.TreeView<IssueTreeNode>
        };
    }

    /**
     * 注册TreeView展开/折叠状态同步
     */
    private static registerExpandCollapseSync(treeView: vscode.TreeView<IssueTreeNode>, viewName: string) {
        treeView.onDidExpandElement(async (e) => {
            const treeData = await readTree();
            if (updateNodeExpanded(treeData.rootNodes, stripFocusedId(e.element.id), true)) {
                await writeTree(treeData);
                vscode.commands.executeCommand('issueManager.refreshAllViews');
            }
        });
        treeView.onDidCollapseElement(async (e) => {
            const treeData = await readTree();
            if (updateNodeExpanded(treeData.rootNodes, stripFocusedId(e.element.id), false)) {
                await writeTree(treeData);
                vscode.commands.executeCommand('issueManager.refreshAllViews');
            }
        });
    }
}