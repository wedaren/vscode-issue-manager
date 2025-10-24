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
    'issueManager.views.related'
];

/**
 * 视图上下文管理器类
 * 
 * 监听视图可见性变化，并设置相应的上下文变量。
 * 这样可以在 package.json 中使用简化的 when 条件。
 */
export class ViewContextManager implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];

    constructor(private context: vscode.ExtensionContext) {
        this.initialize();
    }

    /**
     * 初始化视图上下文管理器
     * 设置所有视图的可见性监听器
     */
    private initialize(): void {
        // 为每个问题树视图设置监听器
        ISSUE_TREE_VIEWS.forEach(viewId => {
            this.setupViewVisibilityListener(viewId);
        });
    }

    /**
     * 为指定视图设置可见性监听器
     * @param viewId 视图的 ID
     */
    private setupViewVisibilityListener(viewId: string): void {
        // 注意：VS Code 的 TreeView 在创建后才能访问其 visible 属性
        // 我们需要在视图注册后，通过视图实例来监听可见性变化
        // 这里我们采用一个简化的方法：监听视图焦点变化
        
        // 由于 VS Code API 限制，我们使用一个简化的策略：
        // 当用户与任何问题树视图交互时，设置上下文变量为 true
        // 这个功能需要在各个视图创建时集成
    }

    /**
     * 注册视图实例，监听其可见性变化
     * @param viewId 视图的 ID
     * @param treeView 树视图实例
     */
    public registerTreeView(viewId: string, treeView: vscode.TreeView<any>): void {
        if (ISSUE_TREE_VIEWS.includes(viewId)) {
            // 监听视图可见性变化
            this.disposables.push(
                treeView.onDidChangeVisibility(e => {
                    if (e.visible) {
                        // 当任一问题树视图可见时，设置上下文变量为 true
                        this.updateIssueTreeViewContext();
                    }
                })
            );

            // 监听视图选择变化（用户正在与视图交互）
            this.disposables.push(
                treeView.onDidChangeSelection(() => {
                    this.updateIssueTreeViewContext();
                })
            );
        }
    }

    /**
     * 更新问题树视图上下文
     * 检查是否有任何问题树视图当前处于活动状态
     */
    private async updateIssueTreeViewContext(): Promise<void> {
        // 设置上下文变量
        // 注意：由于 API 限制，我们采用简化策略：
        // 当用户与问题树视图交互时，认为该上下文激活
        await vscode.commands.executeCommand(
            'setContext',
            'issueManager.isInIssueTreeView',
            true
        );
    }

    /**
     * 释放资源
     */
    public dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}
