import * as vscode from 'vscode';
import { IFocusedIssuesProvider, IIssueOverviewProvider, IIssueViewProvider } from './interfaces';
import { IssueTreeNode } from '../data/treeManager';
import { ViewCommandRegistry } from './commands/ViewCommandRegistry';
import { StateCommandRegistry } from './commands/StateCommandRegistry';
import { BaseCommandRegistry } from './commands/BaseCommandRegistry';

// 重新导入外部命令注册函数
import { registerOpenIssueDirCommand } from '../commands/openIssueDir';
import { registerSearchIssuesCommand } from '../commands/searchIssues';
import { registerDeleteIssueCommand } from '../commands/deleteIssue';
import { registerFocusCommands } from '../commands/focusCommands';
import { smartCreateIssue } from '../commands/smartCreateIssue';
import { addIssueToTree } from '../commands/issueFileUtils';
import { moveToCommand as moveToFunction } from '../commands/moveTo';

/**
 * 命令注册管理器
 * 
 * 负责协调和管理所有VS Code扩展命令的注册。采用模块化设计，
 * 将不同类型的命令分组到专门的注册器中，提高代码的可维护性。
 * 
 * 架构设计：
 * - ViewCommandRegistry: 视图操作命令（刷新、导航、切换等）
 * - StateCommandRegistry: 状态管理命令（展开/折叠、工具命令等）
 * - 外部命令：直接调用其他模块的注册函数
 * 
 * @example
 * ```typescript
 * const registry = new CommandRegistry(context);
 * registry.registerAllCommands(
 *   focusedProvider, 
 *   overviewProvider, 
 *   recentProvider,
 *   overviewView,
 *   focusedView
 * );
 * ```
 */
export class CommandRegistry extends BaseCommandRegistry {
    private readonly viewCommandRegistry: ViewCommandRegistry;
    private readonly stateCommandRegistry: StateCommandRegistry;

    /**
     * 创建命令注册管理器实例
     * 
     * @param context VS Code 扩展上下文，用于命令生命周期管理
     */
    constructor(context: vscode.ExtensionContext) {
        super(context);
        this.viewCommandRegistry = new ViewCommandRegistry(context);
        this.stateCommandRegistry = new StateCommandRegistry(context);
    }

    /**
     * 注册所有命令
     * 
     * 按照功能模块分组注册所有VS Code命令，确保命令的
     * 注册顺序和依赖关系正确处理。
     * 
     * @param focusedIssuesProvider 关注问题视图提供者
     * @param issueOverviewProvider 问题总览视图提供者
     * @param recentIssuesProvider 最近问题视图提供者
     * @param overviewView 总览树视图实例
     * @param focusedView 关注问题树视图实例
     */
    public registerAllCommands(
        focusedIssuesProvider: IFocusedIssuesProvider,
        issueOverviewProvider: IIssueOverviewProvider,
        recentIssuesProvider: IIssueViewProvider<vscode.TreeItem>,
        overviewView: vscode.TreeView<IssueTreeNode>,
        focusedView: vscode.TreeView<IssueTreeNode>
    ): void {
        console.log('  🔧 开始注册命令...');

        try {
            // 1. 注册基础问题管理命令
            this.registerBasicIssueCommands();
            
            // 2. 设置视图提供者并注册视图命令
            this.viewCommandRegistry.setProviders({
                focusedIssuesProvider,
                issueOverviewProvider,
                recentIssuesProvider,
                overviewView,
                focusedView
            });
            this.viewCommandRegistry.registerCommands();
            
            // 3. 注册状态管理命令
            this.stateCommandRegistry.registerCommands();
            this.stateCommandRegistry.registerExpandCollapseSync(overviewView, focusedView);
            
            // 4. 注册外部定义的命令
            this.registerExternalCommands();
            
            // 5. 注册问题操作和创建命令
            this.registerIssueOperationCommands();
            
            console.log('  ✅ 所有命令注册完成');
            
        } catch (error) {
            console.error('  ✗ 命令注册过程中出现错误:', error);
            throw new Error(`命令注册失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
    }

    /**
     * 注册基础问题管理命令
     */
    private registerBasicIssueCommands(): void {
        console.log('    📝 注册基础问题管理命令...');

        // 创建问题命令
        this.registerCommand(
            'issueManager.createIssue',
            async () => {
                await smartCreateIssue();
            },
            '创建问题'
        );

        // 问题移动命令 
        this.registerCommand(
            'issueManager.moveTo',
            async (...args: any[]) => {
                const node = args[0] as IssueTreeNode;
                await moveToFunction([node]);
            },
            '移动问题'
        );

        // 添加问题到树命令
        this.registerCommand(
            'issueManager.addIssueToTree',
            async (...args: any[]) => {
                const [issueUris, parentId, isAddToFocused] = args as [vscode.Uri[], string | null, boolean];
                await addIssueToTree(issueUris, parentId, isAddToFocused);
            },
            '添加问题到树'
        );
    }

    /**
     * 注册外部定义的命令
     */
    private registerExternalCommands(): void {
        console.log('    📦 注册外部定义的命令...');

        // 这些命令在其他模块中定义，直接调用注册函数
        registerOpenIssueDirCommand(this.context);
        registerSearchIssuesCommand(this.context);
        registerDeleteIssueCommand(this.context);
        registerFocusCommands(this.context);
    }

    /**
     * 注册问题操作命令
     */
    private registerIssueOperationCommands(): void {
        console.log('    ⚡ 注册问题操作命令...');

        // 创建从当前关注问题的子问题
        this.registerCommand(
            'issueManager.createSubIssue',
            async (...args: any[]) => {
                const node = args[0] as IssueTreeNode;
                if (!node?.resourceUri) {
                    vscode.window.showErrorMessage('请选择一个有效的问题节点');
                    return;
                }
                
                // 使用智能创建问题功能，指定父节点
                await smartCreateIssue();
                vscode.window.showInformationMessage('子问题创建成功');
            },
            '创建子问题'
        );

        // 从关注问题创建新问题
        this.registerCommand(
            'issueManager.createIssueFromFocused',
            async () => {
                await smartCreateIssue();
                vscode.commands.executeCommand('issueManager.refreshAllViews');
            },
            '从关注问题创建新问题'
        );

        // 在关注问题中搜索
        this.registerCommand(
            'issueManager.searchIssuesInFocused',
            async () => {
                const searchTerm = await vscode.window.showInputBox({
                    prompt: '在关注问题中搜索',
                    placeHolder: '输入搜索关键词...'
                });
                
                if (searchTerm) {
                    await vscode.commands.executeCommand('issueManager.searchIssues', searchTerm);
                }
            },
            '在关注问题中搜索'
        );
    }

    // @ts-ignore
    registerCommands(): void {
        throw new Error('Method not implemented.');
    }
}