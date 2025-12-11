import * as vscode from 'vscode';
import { addFocus, pinFocus, removeFocus } from '../data/focusedManager';
import { IssueTreeNode, stripFocusedId, getFlatTree } from '../data/treeManager';
import { getIssueDir } from '../config';
import { addIssueToTree } from './issueFileUtils';
import { getIssueIdFromUri } from '../utils/uriUtils';
import { GitSyncService } from '../services/git-sync';

/**
 * 注册与"关注问题"相关的命令，包括添加、移除、置顶关注等。
 * @param context 扩展上下文
 */
export function registerFocusCommands(context: vscode.ExtensionContext) {
    // 注册"添加到关注"命令
    const focusIssueCommand = vscode.commands.registerCommand('issueManager.focusIssue', async (node: IssueTreeNode) => {
        const issueDir = getIssueDir();
        if (!issueDir) { return; }
        if (!node || !node.id) {
            vscode.window.showErrorMessage('未找到要关注的问题节点。');
            return;
        }
        const realId = stripFocusedId(node.id);
        await addFocus([realId]);
        vscode.commands.executeCommand('issueManager.refreshAllViews');
        vscode.window.showInformationMessage('已添加到关注问题。');
        // 触发同步
        GitSyncService.getInstance().triggerSync();
    });
    context.subscriptions.push(focusIssueCommand);

    const focusIssueFromIssueFileCommand = vscode.commands.registerCommand('issueManager.focusIssueFromIssueFile', async (node: vscode.TreeItem) => {
        if (!node || !node.resourceUri) {
            vscode.window.showErrorMessage('未找到要关注的问题文件。');
            return;
        }
        await addIssueToTree([node.resourceUri], null, true);
        vscode.window.showInformationMessage('已添加到关注问题。');
        // 触发同步
        GitSyncService.getInstance().triggerSync();
    });
    context.subscriptions.push(focusIssueFromIssueFileCommand);

    // 注册"从编辑器添加到关注视图"命令
    const addToFocusedViewFromEditorCommand = vscode.commands.registerCommand('issueManager.addToFocusedViewFromEditor', async () => {
        const issueDir = getIssueDir();
        if (!issueDir) { 
            vscode.window.showErrorMessage('请先配置问题目录。');
            return;
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('未找到活动的编辑器。');
            return;
        }

        const uri = editor.document.uri;
        const issueId = getIssueIdFromUri(uri);

        if (issueId) {
            // 如果有 issueId，直接添加到关注视图
            await addFocus([issueId]);
            vscode.commands.executeCommand('issueManager.refreshAllViews');
        } else {
            // 如果没有 issueId（孤立问题），先添加到问题总览再添加到关注视图
            await addIssueToTree([uri], null, true);
        }
        vscode.window.showInformationMessage('已添加到关注问题。');
        // 触发同步
        GitSyncService.getInstance().triggerSync();
    });
    context.subscriptions.push(addToFocusedViewFromEditorCommand);


    // 注册"移除关注"命令
    const removeFocusCommand = vscode.commands.registerCommand('issueManager.removeFocus', async (node: IssueTreeNode) => {
        if (!node?.id) {
            vscode.window.showErrorMessage('未找到要移除关注的问题节点。');
            return;
        }
        const realId = stripFocusedId(node.id);
        await removeFocus(realId);
        vscode.commands.executeCommand('issueManager.refreshAllViews');
        vscode.window.showInformationMessage('已移除关注。');
    });
    context.subscriptions.push(removeFocusCommand);

    // 注册"置顶关注"命令
    context.subscriptions.push(vscode.commands.registerCommand('issueManager.pinFocus', async (node: IssueTreeNode) => {
        if (node?.id) {
            const realId = stripFocusedId(node.id);
            await pinFocus(realId);
            vscode.commands.executeCommand('issueManager.focusedIssues.refresh');
        }
    }));

    // 注册从编辑器在问题总览中定位命令
    const revealInOverviewFromEditorCommand = vscode.commands.registerCommand('issueManager.revealInOverviewFromEditor', async () => {
        const issueDir = getIssueDir();
        if (!issueDir) {
            vscode.window.showErrorMessage('请先配置问题目录。');
            return;
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('未找到活动的编辑器。');
            return;
        }

        const uri = editor.document.uri;
        // 从 URI 中获取 issueId
        const issueId = getIssueIdFromUri(uri);
        if (!issueId) {
            vscode.window.showWarningMessage('当前文档不包含问题 ID，无法在问题总览中定位。');
            return;
        }

        try {
            // 获取扁平化的树结构
            const flatNodes = await getFlatTree();
            
            // 使用 issueId 查找匹配的节点
            const node = flatNodes.find(n => n.id === issueId);

            if (node) {
                // 在问题总览中定位该节点
                await vscode.commands.executeCommand('issueManager.openAndRevealIssue', node, 'overview');
            } else {
                vscode.window.showWarningMessage('未在问题总览中找到当前问题的节点。');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`定位失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
    });
    context.subscriptions.push(revealInOverviewFromEditorCommand);
}
