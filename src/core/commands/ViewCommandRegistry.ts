import * as vscode from 'vscode';
import { BaseCommandRegistry } from './BaseCommandRegistry';
import { IIssueOverviewProvider, IIssueViewProvider } from '../interfaces';
import { IssueNode } from '../../data/issueTreeManager';
import { ParaViewProvider } from '../../views/ParaViewProvider';
import { isInBatchRefresh, markRefreshNeeded } from '../../utils/refreshBatch';

/**
 * 视图操作命令注册器
 *
 * 负责注册与视图相关的命令，包括刷新、定位、搜索等操作。
 * 这些命令主要用于用户与各种树视图的交互。
 */
export class ViewCommandRegistry extends BaseCommandRegistry {
    private static readonly REFRESH_DEBOUNCE_MS = 500;

    private issueOverviewProvider?: IIssueOverviewProvider;
    private recentIssuesProvider?: IIssueViewProvider;
    private recentView?: vscode.TreeView<vscode.TreeItem>;
    private paraViewProvider?: ParaViewProvider;
    private overviewView?: vscode.TreeView<IssueNode>;
    private refreshTimer?: ReturnType<typeof setTimeout>;

    /**
     * 设置视图提供者实例
     *
     * @param providers 视图提供者集合
     */
    public setProviders(providers: {
        issueOverviewProvider: IIssueOverviewProvider;
        recentIssuesProvider: IIssueViewProvider;
        recentView?: vscode.TreeView<vscode.TreeItem>;
        paraViewProvider?: ParaViewProvider;
        overviewView: vscode.TreeView<IssueNode>;
    }): void {
        this.issueOverviewProvider = providers.issueOverviewProvider;
        this.recentIssuesProvider = providers.recentIssuesProvider;
        this.recentView = providers.recentView;
        this.paraViewProvider = providers.paraViewProvider;
        this.overviewView = providers.overviewView;
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
        // 最近问题视图刷新
        this.registerCommand(
            'issueManager.recentIssues.refresh',
            () => this.recentIssuesProvider?.refresh(),
            '刷新最近问题视图'
        );

        const debouncedRefreshAll = () => this.scheduleRefreshAllViews();

        // 刷新所有视图
        this.registerCommand(
            'issueManager.refreshAllViews',
            debouncedRefreshAll,
            '刷新所有视图'
        );

        // 统一刷新视图命令（用于Language Model Tool等功能）
        this.registerCommand(
            'issueManager.refreshViews',
            debouncedRefreshAll,
            '刷新视图'
        );
    }

    /**
     * 防抖刷新所有视图
     * 合并短时间内的多次刷新请求，避免重复执行。
     * 在批量操作（batch）期间，刷新会被暂停并标记为待执行。
     */
    private scheduleRefreshAllViews(): void {
        // 批量操作期间只标记需要刷新，不实际调度
        if (isInBatchRefresh()) {
            markRefreshNeeded();
            return;
        }

        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = undefined;
            this.issueOverviewProvider?.refresh();
            this.recentIssuesProvider?.refresh();
            this.paraViewProvider?.refresh();
        }, ViewCommandRegistry.REFRESH_DEBOUNCE_MS);
    }

    /**
     * 注册视图导航命令
     */
    private registerViewNavigationCommands(): void {
        // no-op: search view removed
    }

    /**
     * 注册视图切换命令
     */
    private registerViewToggleCommands(): void {

        this.registerCommand(
            'issueManager.openMarkerView',
            async () => {
                await vscode.commands.executeCommand('workbench.view.extension.issue-manager');
                await vscode.commands.executeCommand('issueManager.views.marker.focus');
                vscode.window.showInformationMessage('已打开问题标记视图');
            },
            '打开问题标记视图'
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

        // 最近视图 reveal（接收 TreeItem）
        this.registerCommand('issueManager.views.recent.reveal', async (...args: unknown[]) => {
            const [element, options] = args as [vscode.TreeItem, { select?: boolean, focus?: boolean, expand?: boolean } | undefined];
            if (this.recentView && element) {
                await this.recentView.reveal(element, options);
            }
        }, '在最近视图中定位');

        // 从当前活动编辑器在最近视图中定位
        this.registerCommand('issueManager.revealInRecentFromEditor', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { vscode.window.showWarningMessage('未找到活动的编辑器'); return; }
            const uri = editor.document.uri;
            if (!this.recentIssuesProvider) { vscode.window.showWarningMessage('最近问题视图未初始化'); return; }

            await vscode.commands.executeCommand('workbench.view.extension.issue-manager');
            await vscode.commands.executeCommand('issueManager.views.recent.focus');

            // recentIssuesProvider 需要提供按 uri 查找元素的能力
            const element = await this.recentIssuesProvider?.getElementByUri?.(uri);
            if (!element) { vscode.window.showInformationMessage('未在最近问题中找到对应项'); return; }

            try {
                await vscode.commands.executeCommand('issueManager.views.recent.reveal', element, { select: true, focus: true, expand: true });
                vscode.window.showInformationMessage('已在最近问题视图中定位当前编辑器对应项');
            } catch (error) {
                this.logger.error('在最近视图中定位失败', error);
                vscode.window.showErrorMessage('在最近视图中定位失败');
            }
        }, '从编辑器在最近视图中定位');
    }
}