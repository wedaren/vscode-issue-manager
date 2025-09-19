import * as vscode from 'vscode';
import { IssueTreeNode, readTree, writeTree, removeNode, stripFocusedId, updateNodeExpanded } from '../data/treeManager';
import { smartCreateIssue } from '../commands/smartCreateIssue';
import { addIssueToTree } from '../commands/issueFileUtils';
import { moveToCommand } from '../commands/moveTo';
import { registerSearchIssuesCommand } from '../commands/searchIssues';
import { registerOpenIssueDirCommand } from '../commands/openIssueDir';
import { registerDeleteIssueCommand } from '../commands/deleteIssue';
import { registerFocusCommands } from '../commands/focusCommands';
import { getIssueDir } from '../config';
import * as path from 'path';

/**
 * 命令注册管理器
 * 负责注册所有扩展命令
 */
export class CommandRegistry {
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * 注册所有命令
     */
    public registerAllCommands(
        focusedIssuesProvider: any,
        issueOverviewProvider: any,
        recentIssuesProvider: any,
        overviewView: vscode.TreeView<IssueTreeNode>,
        focusedView: vscode.TreeView<IssueTreeNode>
    ): void {
        // 注册基础命令
        this.registerBasicCommands();
        
        // 注册移动和添加命令
        this.registerMoveAndAddCommands();
        
        // 注册外部定义的命令
        this.registerExternalCommands();
        
        // 注册视图刷新命令
        this.registerViewRefreshCommands(focusedIssuesProvider, issueOverviewProvider, recentIssuesProvider);
        
        // 注册视图相关命令
        this.registerViewCommands(focusedIssuesProvider, overviewView, focusedView);
        
        // 注册问题操作命令
        this.registerIssueOperationCommands();
        
        // 注册创建问题命令
        this.registerCreateIssueCommands();
        
        // 注册工具命令
        this.registerUtilityCommands();
        
        // 注册展开/折叠状态同步
        this.registerExpandCollapseSync(overviewView, focusedView);
    }

    /**
     * 注册基础命令
     */
    private registerBasicCommands(): void {
        // 创建问题命令
        const createIssueCommand = vscode.commands.registerCommand('issueManager.createIssue', async () => {
            await smartCreateIssue(null);
        });
        this.context.subscriptions.push(createIssueCommand);

        // 打开关注视图命令
        const openFocusedViewCommand = vscode.commands.registerCommand('issueManager.openFocusedView', async () => {
            try {
                await vscode.commands.executeCommand('workbench.view.extension.issue-manager');
                await vscode.commands.executeCommand('issueManager.views.focused.focus');
                vscode.window.showInformationMessage('已打开关注问题视图');
            } catch (error) {
                console.error('打开关注问题视图失败:', error);
                vscode.window.showErrorMessage('无法打开关注问题视图，请检查扩展是否正确安装。');
            }
        });
        this.context.subscriptions.push(openFocusedViewCommand);
    }

    /**
     * 注册移动和添加命令
     */
    private registerMoveAndAddCommands(): void {
        // 移动到命令
        const moveToCommand_reg = vscode.commands.registerCommand('issueManager.moveTo', async (node: IssueTreeNode, selectedNodes?: IssueTreeNode[]) => {
            const nodes = selectedNodes && selectedNodes.length > 0 ? selectedNodes : node ? [node] : [];
            await moveToCommand(nodes);
        });
        this.context.subscriptions.push(moveToCommand_reg);

        // 为"最近问题"视图注册"添加到..."命令
        const addToCommand = vscode.commands.registerCommand('issueManager.addTo', async (node: vscode.TreeItem, selectedNodes?: vscode.TreeItem[]) => {
            const nodes = selectedNodes && selectedNodes.length > 0 ? selectedNodes : node ? [node] : [];
            await moveToCommand(nodes);
        });
        this.context.subscriptions.push(addToCommand);

        // addIssueToTree命令
        const addIssueToTreeCommand = vscode.commands.registerCommand('issueManager.addIssueToTree', async (issueUris: vscode.Uri[], parentId: string | null, isAddToFocused: boolean) => {
            await addIssueToTree(issueUris, parentId, isAddToFocused);
        });
        this.context.subscriptions.push(addIssueToTreeCommand);
    }

    /**
     * 注册外部定义的命令
     */
    private registerExternalCommands(): void {
        registerSearchIssuesCommand(this.context);
        registerOpenIssueDirCommand(this.context);
        registerDeleteIssueCommand(this.context);
        registerFocusCommands(this.context);
    }

    /**
     * 注册视图刷新命令
     */
    private registerViewRefreshCommands(
        focusedIssuesProvider: any,
        issueOverviewProvider: any,
        recentIssuesProvider: any
    ): void {
        // 关注问题刷新
        const focusedRefreshCommand = vscode.commands.registerCommand('issueManager.focusedIssues.refresh', () => {
            focusedIssuesProvider.loadData();
        });
        this.context.subscriptions.push(focusedRefreshCommand);

        // 最近问题刷新
        const recentRefreshCommand = vscode.commands.registerCommand('issueManager.recentIssues.refresh', () => {
            recentIssuesProvider.refresh();
        });
        this.context.subscriptions.push(recentRefreshCommand);

        // 刷新所有视图
        const refreshAllViewsCommand = vscode.commands.registerCommand('issueManager.refreshAllViews', () => {
            focusedIssuesProvider.refresh();
            issueOverviewProvider.refresh();
            recentIssuesProvider.refresh();
        });
        this.context.subscriptions.push(refreshAllViewsCommand);

        // 统一刷新视图命令
        const refreshViewsCommand = vscode.commands.registerCommand('issueManager.refreshViews', () => {
            focusedIssuesProvider.refresh();
            issueOverviewProvider.refresh();
            recentIssuesProvider.refresh();
        });
        this.context.subscriptions.push(refreshViewsCommand);
    }

    /**
     * 注册视图相关命令
     */
    private registerViewCommands(
        focusedIssuesProvider: any,
        overviewView: vscode.TreeView<IssueTreeNode>,
        focusedView: vscode.TreeView<IssueTreeNode>
    ): void {
        // 总览视图定位命令
        const overviewRevealCommand = vscode.commands.registerCommand('issueManager.views.overview.reveal', async (targetNode: IssueTreeNode, options?: { select?: boolean; focus?: boolean; expand?: boolean }) => {
            if (targetNode) {
                await overviewView.reveal(targetNode, options || { select: true, focus: true, expand: true });
            }
        });
        this.context.subscriptions.push(overviewRevealCommand);

        // 关注视图定位命令
        const focusedRevealCommand = vscode.commands.registerCommand('issueManager.views.focused.reveal', async (targetNode: IssueTreeNode, options?: { select?: boolean; focus?: boolean; expand?: boolean }) => {
            await focusedView.reveal(targetNode, options || { select: true, focus: true, expand: true });
        });
        this.context.subscriptions.push(focusedRevealCommand);

        // 搜索命令
        const searchInFocusedCommand = vscode.commands.registerCommand('issueManager.searchIssuesInFocused', async () => {
            vscode.commands.executeCommand('issueManager.searchIssues', 'focused');
        });
        this.context.subscriptions.push(searchInFocusedCommand);

        const searchInOverviewCommand = vscode.commands.registerCommand('issueManager.searchIssuesInOverview', async () => {
            vscode.commands.executeCommand('issueManager.searchIssues', 'overview');
        });
        this.context.subscriptions.push(searchInOverviewCommand);

        // 打开并定位问题命令
        const openAndRevealCommand = vscode.commands.registerCommand('issueManager.openAndRevealIssue', async (node: IssueTreeNode, type: 'focused' | 'overview') => {
            if (!node || !node.resourceUri) { return; }
            await vscode.window.showTextDocument(node.resourceUri, { preview: false });
            if (type === 'overview') {
                await vscode.commands.executeCommand('issueManager.views.overview.reveal', node, { select: true, focus: true, expand: true });
            } else if (type === 'focused') {
                const { node: target } = focusedIssuesProvider.findFirstFocusedNodeById(node.id) || {};
                if (target) {
                    await vscode.commands.executeCommand('issueManager.views.focused.reveal', target, { select: true, focus: true, expand: true });
                } else {
                    await vscode.commands.executeCommand('issueManager.views.overview.reveal', node, { select: true, focus: true, expand: true });
                }
            }
        });
        this.context.subscriptions.push(openAndRevealCommand);
    }

    /**
     * 注册问题操作命令
     */
    private registerIssueOperationCommands(): void {
        // 解除关联命令
        const disassociateIssueCommand = vscode.commands.registerCommand('issueManager.disassociateIssue', async (node: IssueTreeNode) => {
            if (!node || node.id === 'placeholder-no-issues') {
                return;
            }

            if (node.children && node.children.length > 0) {
                const confirm = await vscode.window.showWarningMessage(
                    '该节点下包含子问题，解除关联将一并移除其所有子节点。是否继续？',
                    { modal: true },
                    '确定'
                );
                if (confirm !== '确定') {
                    return;
                }
            }

            const treeData = await readTree();
            if (!treeData) {
                vscode.window.showErrorMessage('无法读取问题树数据。');
                return;
            }

            const { success } = removeNode(treeData, stripFocusedId(node.id));

            if (success) {
                await writeTree(treeData);
                vscode.commands.executeCommand('issueManager.refreshAllViews');
            } else {
                vscode.window.showWarningMessage('无法在树中找到该节点以解除关联。');
            }
        });
        this.context.subscriptions.push(disassociateIssueCommand);
    }

    /**
     * 注册创建问题命令
     */
    private registerCreateIssueCommands(): void {
        // 创建子问题处理器
        const createChildIssueHandler = (viewType: 'overview' | 'focused') => {
            return async (parentNode?: IssueTreeNode) => {
                const id = parentNode?.id && stripFocusedId(parentNode.id);
                await smartCreateIssue(id || null, true);
                if (parentNode) {
                    const revealCommand = `issueManager.views.${viewType}.reveal`;
                    await vscode.commands.executeCommand(revealCommand, parentNode, { select: true, focus: true, expand: true });
                }
            };
        };

        // 总览视图创建子问题
        const createChildIssueCommandInOverview = vscode.commands.registerCommand(
            'issueManager.createChildIssueInOverview',
            createChildIssueHandler('overview')
        );
        this.context.subscriptions.push(createChildIssueCommandInOverview);

        // 关注视图创建子问题
        const createChildIssueCommandInFocused = vscode.commands.registerCommand(
            'issueManager.createChildIssueInFocused',
            createChildIssueHandler('focused')
        );
        this.context.subscriptions.push(createChildIssueCommandInFocused);

        // 从总览创建问题
        const createIssueFromOverviewCommand = vscode.commands.registerCommand('issueManager.createIssueFromOverview', async () => {
            await smartCreateIssue(null, true);
        });
        this.context.subscriptions.push(createIssueFromOverviewCommand);

        // 从关注创建问题
        const createIssueFromFocusedCommand = vscode.commands.registerCommand('issueManager.createIssueFromFocused', async (node?: IssueTreeNode) => {
            await smartCreateIssue(null, true, true);
        });
        this.context.subscriptions.push(createIssueFromFocusedCommand);
    }

    /**
     * 注册工具命令
     */
    private registerUtilityCommands(): void {
        // 复制文件名命令
        const copyFilenameCommand = vscode.commands.registerCommand('issueManager.copyFilename', async (treeItemOrResourceUri?: vscode.TreeItem | vscode.Uri) => {
            let resourceUri: vscode.Uri | undefined;

            if (treeItemOrResourceUri instanceof vscode.Uri) {
                resourceUri = treeItemOrResourceUri;
            } else if (treeItemOrResourceUri?.resourceUri) {
                resourceUri = treeItemOrResourceUri.resourceUri;
            } else if (vscode.window.activeTextEditor) {
                const doc = vscode.window.activeTextEditor.document;
                const issueDir = getIssueDir();
                if (doc.languageId === 'markdown' && issueDir && doc.uri.fsPath.startsWith(issueDir)) {
                    resourceUri = doc.uri;
                }
            }

            if (resourceUri) {
                const fileName = path.basename(resourceUri.fsPath);
                try {
                    await vscode.env.clipboard.writeText(fileName);
                    vscode.window.showInformationMessage(`已复制文件名: ${fileName}`);
                } catch (e) {
                    console.error('复制文件名到剪贴板失败:', e);
                    vscode.window.showErrorMessage('复制文件名失败。');
                }
            } else {
                vscode.window.showWarningMessage('未找到有效的文件路径，无法复制文件名。');
            }
        });
        this.context.subscriptions.push(copyFilenameCommand);

        // 注意：问题结构视图刷新命令由ViewRegistry中的结构视图直接处理
    }

    /**
     * 注册展开/折叠状态同步
     */
    private registerExpandCollapseSync(
        overviewView: vscode.TreeView<IssueTreeNode>,
        focusedView: vscode.TreeView<IssueTreeNode>
    ): void {
        const registerExpandCollapseSync = (treeView: vscode.TreeView<IssueTreeNode>, viewName: string) => {
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
        };

        registerExpandCollapseSync(overviewView, 'overview');
        registerExpandCollapseSync(focusedView, 'focused');
    }
}