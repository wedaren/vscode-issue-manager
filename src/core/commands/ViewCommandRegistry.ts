import * as vscode from 'vscode';
import { BaseCommandRegistry } from './BaseCommandRegistry';
import { IIssueOverviewProvider, IIssueViewProvider } from '../interfaces';
import { IssueNode } from '../../data/issueTreeManager';
import { ParaViewProvider } from '../../views/ParaViewProvider';
import { isInBatchRefresh, markRefreshNeeded } from '../../utils/refreshBatch';

/**
 * 视图刷新调度器接口，提供每个视图的独立刷新方法。
 * 供 ConfigurationManager 及其他模块按需调用，便于未来灵活重组刷新策略。
 *
 * 各方法均内置防抖与批量暂停保护，可安全高频调用。
 */
export interface IViewRefreshDispatcher {
    /** 问题总览：完整刷新（重读 tree.json 结构） */
    refreshOverview(): void;
    /** 问题总览：仅标签刷新（标题缓存已热，不重读 tree.json） */
    refreshOverviewLabels(): void;
    /** 最近问题视图刷新 */
    refreshRecent(): void;
    /** PARA 视图刷新 */
    refreshPara(): void;
    /** 所有视图全量刷新（等同于同时调用以上全部） */
    refreshAll(): void;
}

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
    private overviewTimer?: ReturnType<typeof setTimeout>;
    private recentTimer?: ReturnType<typeof setTimeout>;
    private paraTimer?: ReturnType<typeof setTimeout>;

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
     * 返回视图刷新调度器，供外部模块按视图类型精准触发刷新。
     * @returns `IViewRefreshDispatcher` 实现，所有方法内置防抖
     */
    public getRefreshDispatcher(): IViewRefreshDispatcher {
        return {
            refreshOverview: () => this.scheduleRefreshOverview(),
            refreshOverviewLabels: () => this.scheduleRefreshOverviewLabels(),
            refreshRecent: () => this.scheduleRefreshRecent(),
            refreshPara: () => this.scheduleRefreshPara(),
            refreshAll: () => this.scheduleRefreshAllViews(),
        };
    }

    /**
     * 注册视图刷新命令
     */
    private registerViewRefreshCommands(): void {
        // 最近问题视图刷新（带防抖）
        this.registerCommand(
            'issueManager.recentIssues.refresh',
            () => this.scheduleRefreshRecent(),
            '刷新最近问题视图'
        );

        const debouncedRefreshAll = () => this.scheduleRefreshAllViews();

        // 刷新所有视图（向后兼容：显式命令 / 批量结束 / 配置变更等场景继续使用）
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

        // ---- 细粒度刷新命令 ----

        // 问题总览：完整刷新（重读 tree.json）
        this.registerCommand(
            'issueManager.refreshOverview',
            () => this.scheduleRefreshOverview(),
            '刷新问题总览视图（完整）'
        );

        // 问题总览：标签刷新（仅 fire，不重读 tree.json）
        this.registerCommand(
            'issueManager.refreshOverviewLabels',
            () => this.scheduleRefreshOverviewLabels(),
            '刷新问题总览标签'
        );

        // PARA 视图刷新
        this.registerCommand(
            'issueManager.refreshParaView',
            () => this.scheduleRefreshPara(),
            '刷新 PARA 视图'
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

    // ---- 细粒度防抖刷新 ----

    /** 问题总览完整刷新（重读 tree.json） */
    private scheduleRefreshOverview(): void {
        if (isInBatchRefresh()) { markRefreshNeeded(); return; }
        if (this.overviewTimer) { clearTimeout(this.overviewTimer); }
        this.overviewTimer = setTimeout(() => {
            this.overviewTimer = undefined;
            this.issueOverviewProvider?.refresh();
        }, ViewCommandRegistry.REFRESH_DEBOUNCE_MS);
    }

    /** 问题总览标签刷新（仅 fire，标题缓存已热） */
    private scheduleRefreshOverviewLabels(): void {
        if (isInBatchRefresh()) { markRefreshNeeded(); return; }
        // 若完整刷新已挂起，跳过（refresh 是 fireUpdate 的超集）
        if (this.overviewTimer) { return; }
        // 复用 overviewTimer 防止冲突
        this.overviewTimer = setTimeout(() => {
            this.overviewTimer = undefined;
            this.issueOverviewProvider?.fireUpdate();
        }, ViewCommandRegistry.REFRESH_DEBOUNCE_MS);
    }

    /** 最近问题视图刷新 */
    private scheduleRefreshRecent(): void {
        if (isInBatchRefresh()) { markRefreshNeeded(); return; }
        if (this.recentTimer) { clearTimeout(this.recentTimer); }
        this.recentTimer = setTimeout(() => {
            this.recentTimer = undefined;
            this.recentIssuesProvider?.refresh();
        }, ViewCommandRegistry.REFRESH_DEBOUNCE_MS);
    }

    /** PARA 视图刷新 */
    private scheduleRefreshPara(): void {
        if (isInBatchRefresh()) { markRefreshNeeded(); return; }
        if (this.paraTimer) { clearTimeout(this.paraTimer); }
        this.paraTimer = setTimeout(() => {
            this.paraTimer = undefined;
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