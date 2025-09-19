import * as vscode from 'vscode';
import * as path from 'path';
import { moveToCommand } from '../commands/moveTo';
import { registerSearchIssuesCommand } from '../commands/searchIssues';
import { registerOpenIssueDirCommand } from '../commands/openIssueDir';
import { registerDeleteIssueCommand } from '../commands/deleteIssue';
import { registerFocusCommands } from '../commands/focusCommands';
import { smartCreateIssue } from '../commands/smartCreateIssue';
import { addIssueToTree } from '../commands/issueFileUtils';
import { getIssueDir } from '../config';
import { IssueTreeNode, readTree, writeTree, removeNode, stripFocusedId } from '../data/treeManager';
import { IssueOverviewProvider } from '../views/IssueOverviewProvider';
import { FocusedIssuesProvider } from '../views/FocusedIssuesProvider';
import { RecentIssuesProvider } from '../views/RecentIssuesProvider';

/**
 * 命令注册器
 * 负责注册所有的VSCode命令
 */
export class CommandRegistrar {
    /**
     * 注册所有命令
     */
    static register(
        context: vscode.ExtensionContext,
        providers: {
            issueOverviewProvider: IssueOverviewProvider;
            focusedIssuesProvider: FocusedIssuesProvider;
            recentIssuesProvider: RecentIssuesProvider;
            overviewView: vscode.TreeView<IssueTreeNode>;
            focusedView: vscode.TreeView<IssueTreeNode>;
        }
    ): void {
        // 注册基础功能命令
        registerSearchIssuesCommand(context);
        registerOpenIssueDirCommand(context);
        registerDeleteIssueCommand(context);
        registerFocusCommands(context);

        // 注册移动相关命令
        this.registerMoveCommands(context);

        // 注册创建问题相关命令
        this.registerCreateIssueCommands(context, providers);

        // 注册视图相关命令
        this.registerViewCommands(context, providers);

        // 注册工具命令
        this.registerUtilityCommands(context);

        // 注册问题结构视图刷新命令
        context.subscriptions.push(vscode.commands.registerCommand('issueManager.structure.refresh', () => {
            // 这个命令在视图注册时已经绑定到对应的provider
            vscode.commands.executeCommand('issueManager.refreshAllViews');
        }));
    }

    /**
     * 注册移动相关命令
     */
    private static registerMoveCommands(context: vscode.ExtensionContext): void {
        // 注册"移动到..."命令
        context.subscriptions.push(vscode.commands.registerCommand('issueManager.moveTo', async (node: IssueTreeNode, selectedNodes?: IssueTreeNode[]) => {
            // 支持多选，selectedNodes 优先，否则单节点
            const nodes = selectedNodes && selectedNodes.length > 0 ? selectedNodes : node ? [node] : [];
            await moveToCommand(nodes);
        }));

        // 为"最近问题"视图注册"添加到..."命令
        context.subscriptions.push(vscode.commands.registerCommand('issueManager.addTo', async (node: vscode.TreeItem, selectedNodes?: vscode.TreeItem[]) => {
            // 支持多选，selectedNodes 优先，否则单节点
            const nodes = selectedNodes && selectedNodes.length > 0 ? selectedNodes : node ? [node] : [];
            await moveToCommand(nodes);
        }));

        // 注册"解除关联"命令
        const disassociateIssueCommand = vscode.commands.registerCommand('issueManager.disassociateIssue', async (node: IssueTreeNode) => {
            if (!node || node.id === 'placeholder-no-issues') {
                return;
            }

            // 判断是否有子节点
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
        context.subscriptions.push(disassociateIssueCommand);
    }

    /**
     * 注册创建问题相关命令
     */
    private static registerCreateIssueCommands(
        context: vscode.ExtensionContext,
        providers: {
            overviewView: vscode.TreeView<IssueTreeNode>;
            focusedView: vscode.TreeView<IssueTreeNode>;
        }
    ): void {
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

        const createChildIssueCommandInOverview = vscode.commands.registerCommand(
            'issueManager.createChildIssueInOverview',
            createChildIssueHandler('overview')
        );

        const createChildIssueCommandInFocused = vscode.commands.registerCommand(
            'issueManager.createChildIssueInFocused',
            createChildIssueHandler('focused')
        );

        context.subscriptions.push(createChildIssueCommandInOverview, createChildIssueCommandInFocused);

        // 注册"创建问题"命令
        const createIssueCommand = vscode.commands.registerCommand('issueManager.createIssue', async () => {
            await smartCreateIssue(null);
        });
        context.subscriptions.push(createIssueCommand);

        const createIssueFromOverviewCommand = vscode.commands.registerCommand('issueManager.createIssueFromOverview', async () => {
            await smartCreateIssue(null, true);
        });
        context.subscriptions.push(createIssueFromOverviewCommand);

        const createIssueFromFocusedCommand = vscode.commands.registerCommand('issueManager.createIssueFromFocused', async (node?: IssueTreeNode) => {
            await smartCreateIssue(null, true, true);
        });
        context.subscriptions.push(createIssueFromFocusedCommand);

        // 注册addIssueToTree命令，供RSS视图使用
        const addIssueToTreeCommand = vscode.commands.registerCommand('issueManager.addIssueToTree', async (issueUris: vscode.Uri[], parentId: string | null, isAddToFocused: boolean) => {
            await addIssueToTree(issueUris, parentId, isAddToFocused);
        });
        context.subscriptions.push(addIssueToTreeCommand);
    }

    /**
     * 注册视图相关命令
     */
    private static registerViewCommands(
        context: vscode.ExtensionContext,
        providers: {
            issueOverviewProvider: IssueOverviewProvider;
            focusedIssuesProvider: FocusedIssuesProvider;
            recentIssuesProvider: RecentIssuesProvider;
            overviewView: vscode.TreeView<IssueTreeNode>;
            focusedView: vscode.TreeView<IssueTreeNode>;
        }
    ): void {
        // 注册"问题总览"视图定位命令
        context.subscriptions.push(vscode.commands.registerCommand('issueManager.views.overview.reveal', async (targetNode: IssueTreeNode, options?: { select?: boolean; focus?: boolean; expand?: boolean }) => {
            if (targetNode) {
                await providers.overviewView.reveal(targetNode, options || { select: true, focus: true, expand: true });
            }
        }));

        // 注册"关注问题"视图定位命令
        context.subscriptions.push(vscode.commands.registerCommand('issueManager.views.focused.reveal', async (targetNode: IssueTreeNode, options?: { select?: boolean; focus?: boolean; expand?: boolean }) => {
            await providers.focusedView.reveal(targetNode, options || { select: true, focus: true, expand: true });
        }));

        context.subscriptions.push(vscode.commands.registerCommand('issueManager.searchIssuesInFocused', async () => {
            vscode.commands.executeCommand('issueManager.searchIssues', 'focused');
        }));
        
        context.subscriptions.push(vscode.commands.registerCommand('issueManager.searchIssuesInOverview', async () => {
            vscode.commands.executeCommand('issueManager.searchIssues', 'overview');
        }));

        // 注册命令：打开并在问题总览或关注问题中定位
        context.subscriptions.push(vscode.commands.registerCommand('issueManager.openAndRevealIssue', async (node: IssueTreeNode, type: 'focused' | 'overview') => {
            if (!node || !node.resourceUri) { return; }
            // 打开文件
            await vscode.window.showTextDocument(node.resourceUri, { preview: false });
            if (type === 'overview') {
                await vscode.commands.executeCommand('issueManager.views.overview.reveal', node, { select: true, focus: true, expand: true });
            } else if (type === 'focused') {
                const { node: target } = providers.focusedIssuesProvider.findFirstFocusedNodeById(node.id) || {};
                if (target) {
                    await vscode.commands.executeCommand('issueManager.views.focused.reveal', target, { select: true, focus: true, expand: true });
                } else {
                    await vscode.commands.executeCommand('issueManager.views.overview.reveal', node, { select: true, focus: true, expand: true });
                }
            }
        }));

        // 可根据需要注册命令刷新关注视图
        context.subscriptions.push(vscode.commands.registerCommand('issueManager.focusedIssues.refresh', () => {
            providers.focusedIssuesProvider.loadData();
        }));

        context.subscriptions.push(vscode.commands.registerCommand('issueManager.recentIssues.refresh', () => {
            providers.recentIssuesProvider.refresh();
        }));

        context.subscriptions.push(vscode.commands.registerCommand('issueManager.refreshAllViews', () => {
            providers.focusedIssuesProvider.refresh();
            providers.issueOverviewProvider.refresh();
            providers.recentIssuesProvider.refresh();
        }));

        // 注册统一的刷新视图命令，用于Language Model Tool等功能
        context.subscriptions.push(vscode.commands.registerCommand('issueManager.refreshViews', () => {
            providers.focusedIssuesProvider.refresh();
            providers.issueOverviewProvider.refresh();
            providers.recentIssuesProvider.refresh();
        }));

        const openFocusedViewCommand = vscode.commands.registerCommand('issueManager.openFocusedView', async () => {
            try {
                // 激活问题管理扩展的活动栏  
                await vscode.commands.executeCommand('workbench.view.extension.issue-manager');
                // 聚焦到关注问题视图  
                await vscode.commands.executeCommand('issueManager.views.focused.focus');
                vscode.window.showInformationMessage('已打开关注问题视图');
            } catch (error) {
                console.error('打开关注问题视图失败:', error);
                vscode.window.showErrorMessage('无法打开关注问题视图，请检查扩展是否正确安装。');
            }
        });
        context.subscriptions.push(openFocusedViewCommand);
    }

    /**
     * 注册工具命令
     */
    private static registerUtilityCommands(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.copyFilename', async (treeItemOrResourceUri?: vscode.TreeItem | vscode.Uri) => {
                // 优先获取 resourceUri，其次尝试使用当前激活编辑器的文件路径
                let resourceUri: vscode.Uri | undefined;

                if (treeItemOrResourceUri instanceof vscode.Uri) {
                    resourceUri = treeItemOrResourceUri;
                } else if (treeItemOrResourceUri?.resourceUri) {
                    resourceUri = treeItemOrResourceUri.resourceUri;
                } else if (vscode.window.activeTextEditor) {
                    // 命令面板调用时，回退到当前激活的编辑器
                    const doc = vscode.window.activeTextEditor.document;
                    const issueDir = getIssueDir();
                    // 仅当激活文件为问题目录下的 Markdown 文件时才继续
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
            })
        );
    }
}