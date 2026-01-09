import * as vscode from 'vscode';
import { BaseCommandRegistry } from './BaseCommandRegistry';
import { IFocusedIssuesProvider, IIssueOverviewProvider, IIssueViewProvider } from '../interfaces';
import { IssueNode } from '../../data/issueTreeManager';
import { ParaViewProvider } from '../../views/ParaViewProvider';

/**
 * 视图操作命令注册器
 * 
 * 负责注册与视图相关的命令，包括刷新、定位、搜索等操作。
 * 这些命令主要用于用户与各种树视图的交互。
 */
export class ViewCommandRegistry extends BaseCommandRegistry {
    private focusedIssuesProvider?: IFocusedIssuesProvider;
    private issueOverviewProvider?: IIssueOverviewProvider;
    private recentIssuesProvider?: IIssueViewProvider;
    private paraViewProvider?: ParaViewProvider;
    private overviewView?: vscode.TreeView<IssueNode>;
    private focusedView?: vscode.TreeView<IssueNode>;

    /**
     * 设置视图提供者实例
     * 
     * @param providers 视图提供者集合
     */
    public setProviders(providers: {
        focusedIssuesProvider: IFocusedIssuesProvider;
        issueOverviewProvider: IIssueOverviewProvider;
        recentIssuesProvider: IIssueViewProvider;
        paraViewProvider?: ParaViewProvider;
        overviewView: vscode.TreeView<IssueNode>;
        focusedView: vscode.TreeView<IssueNode>;
    }): void {
        this.focusedIssuesProvider = providers.focusedIssuesProvider;
        this.issueOverviewProvider = providers.issueOverviewProvider;
        this.recentIssuesProvider = providers.recentIssuesProvider;
        this.paraViewProvider = providers.paraViewProvider;
        this.overviewView = providers.overviewView;
        this.focusedView = providers.focusedView;
    }

    /**
     * 注册所有视图相关命令
     */
    public registerCommands(): void {
        this.logger.info('  🔄 注册视图操作命令...');
        
        this.registerViewRefreshCommands();
        this.registerViewNavigationCommands();
        this.registerViewToggleCommands();
        this.registerViewRevealCommands();
    }

    /**
     * 注册视图刷新命令
     */
    private registerViewRefreshCommands(): void {
        // 关注问题视图刷新
        this.registerCommand(
            'issueManager.focusedIssues.refresh',
            () => this.focusedIssuesProvider?.loadData(),
            '刷新关注问题视图'
        );

        // 最近问题视图刷新
        this.registerCommand(
            'issueManager.recentIssues.refresh',
            () => this.recentIssuesProvider?.refresh(),
            '刷新最近问题视图'
        );

        // 刷新所有视图
        this.registerCommand(
            'issueManager.refreshAllViews',
            () => {
                this.focusedIssuesProvider?.refresh();
                this.issueOverviewProvider?.refresh();
                this.recentIssuesProvider?.refresh();
                this.paraViewProvider?.refresh();
            },
            '刷新所有视图'
        );

        // 统一刷新视图命令（用于Language Model Tool等功能）
        this.registerCommand(
            'issueManager.refreshViews',
            () => {
                this.focusedIssuesProvider?.refresh();
                this.issueOverviewProvider?.refresh();
                this.recentIssuesProvider?.refresh();
                this.paraViewProvider?.refresh();
            },
            '刷新视图'
        );
    }

    /**
     * 注册视图导航命令
     */
    private registerViewNavigationCommands(): void {
        // 定位到关注问题中的节点
        this.registerCommand(
            'issueManager.locateNodeInFocused',
            async (...args: unknown[]) => {
                const nodeId = args[0];
                if (typeof nodeId !== 'string') {
                    vscode.window.showWarningMessage('无效的节点ID');
                    this.logger.warn('locateNodeInFocused: 无效的节点ID，参数不是字符串。');
                    return;
                }

                if (!this.focusedIssuesProvider || !this.focusedView) {
                    vscode.window.showWarningMessage('关注问题视图未初始化');
                    return;
                }

                const result = this.focusedIssuesProvider.findFirstFocusedNodeById(nodeId);
                if (!result) {
                    vscode.window.showInformationMessage('未在关注问题中找到指定节点');
                    return;
                }

                try {
                    await this.focusedView.reveal(result.node, { 
                        select: true, 
                        focus: true, 
                        expand: true 
                    });
                    vscode.window.showInformationMessage('已定位到关注问题中的节点');
                } catch (error) {
                    this.logger.error('定位节点失败:', error);
                    vscode.window.showErrorMessage('定位节点失败');
                }
            },
            '在关注问题中定位节点'
        );

        // 在总览视图中搜索问题
        this.registerCommand(
            'issueManager.searchIssuesInOverview',
            async () => vscode.commands.executeCommand('issueManager.searchIssues', 'overview'),
            '在总览视图中搜索'
        );
    }

    /**
     * 注册视图切换命令
     */
    private registerViewToggleCommands(): void {
        // 打开关注视图
        this.registerCommand(
            'issueManager.openFocusedView',
            async () => {
                await vscode.commands.executeCommand('workbench.view.extension.issue-manager');
                await vscode.commands.executeCommand('issueManager.views.focused.focus');
                vscode.window.showInformationMessage('已打开关注问题视图');
            },
            '打开关注视图'
        );

        this.registerCommand(
            'issueManager.openRecentView',
            async () => {
                await vscode.commands.executeCommand('workbench.view.extension.issue-manager');
                await vscode.commands.executeCommand('issueManager.views.recent.focus');
                vscode.window.showInformationMessage('已打开最近问题视图');
            },
            '打开最近问题视图'
        );

        // 切换视图焦点
        this.registerCommand(
            'issueManager.toggleViewFocus',
            async () => {
                // 在不同视图间切换焦点
                await vscode.commands.executeCommand('workbench.action.focusNextGroup');
            },
            '切换视图焦点'
        );
    }

    /**
     * 注册视图定位相关命令
     */
    private registerViewRevealCommands(): void {
        this.registerCommand('issueManager.views.overview.reveal', async (...args: unknown[]) => {
            const [node, options] = args as [IssueNode, { select: boolean, focus: boolean, expand: boolean } | undefined];
            if (this.overviewView && node) {
                await this.overviewView.reveal(node, options);
            }
        }, '在总览视图中定位');

        this.registerCommand('issueManager.views.focused.reveal', async (...args: unknown[]) => {
            const [node, options] = args as [IssueNode, { select: boolean, focus: boolean, expand: boolean } | undefined];
            if (this.focusedView && node) {
                await this.focusedView.reveal(node, options);
            }
        }, '在关注视图中定位');
    }
}