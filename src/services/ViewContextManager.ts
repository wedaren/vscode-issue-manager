/**
 * 视图上下文管理器
 * 
 * 负责管理全局视图上下文变量，简化 package.json 中的 when 条件。
 * 通过统一的上下文变量来标识用户当前所在的视图类型。
 */
import * as vscode from 'vscode';

/**
 * 问题树视图的 ID 列表
 * 包含所有支持问题节点操作的树视图
 */
const ISSUE_TREE_VIEWS = [
    'issueManager.views.overview',
    'issueManager.views.focused',
    'issueManager.views.recent',
    'issueManager.views.related',
    'issueManager.views.search'
];

/**
 * 视图上下文管理器类
 * 
 * 监听视图可见性变化,并设置相应的上下文变量。
 * 这样可以在 package.json 中使用简化的 when 条件。
 */
export class ViewContextManager implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];
    /** 跟踪所有已注册视图的可见性状态 */
    private viewVisibilityMap: Map<string, boolean> = new Map();

    constructor(private context: vscode.ExtensionContext) {
        this.initialize();
    }

    /**
     * 初始化视图上下文管理器
     * 设置所有视图的可见性监听器
     */
    private initialize(): void {
        // 初始化所有问题树视图的可见性状态为 false
        ISSUE_TREE_VIEWS.forEach(viewId => {
            this.viewVisibilityMap.set(viewId, false);
        });
    }

    /**
     * 注册视图实例，监听其可见性变化
     * @param viewId 视图的 ID
     * @param treeView 树视图实例
     */
    public registerTreeView(viewId: string, treeView: vscode.TreeView<unknown>): void {
        if (ISSUE_TREE_VIEWS.includes(viewId)) {
            // 监听视图可见性变化
            this.disposables.push(
                treeView.onDidChangeVisibility(e => {
                    // 更新视图的可见性状态
                    this.viewVisibilityMap.set(viewId, e.visible);
                    // 重新计算上下文变量
                    this.updateIssueTreeViewContext();
                })
            );

            // 监听视图选择变化（用户正在与视图交互）
            this.disposables.push(
                treeView.onDidChangeSelection(() => {
                    // 当用户与视图交互时，确保该视图标记为可见
                    this.viewVisibilityMap.set(viewId, true);
                    this.updateIssueTreeViewContext();
                })
            );
        }
    }

    /**
     * 更新问题树视图上下文
     * 检查是否有任何问题树视图当前处于可见状态
     */
    private updateIssueTreeViewContext(): void {
        // 检查是否有任何视图当前可见
        const hasVisibleView = Array.from(this.viewVisibilityMap.values()).some(visible => visible);
        
        // 根据实际状态设置上下文变量
        vscode.commands.executeCommand(
            'setContext',
            'issueManager.isInIssueTreeView',
            hasVisibleView
        );
    }

    /**
     * 释放资源
     */
    public dispose(): void {
        // 清理上下文变量
        vscode.commands.executeCommand(
            'setContext',
            'issueManager.isInIssueTreeView',
            false
        );
        
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        this.viewVisibilityMap.clear();
    }
}
