import * as vscode from 'vscode';
import { IssueTreeNode, stripFocusedId } from '../data/treeManager';
import { isIssueTreeNode } from '../utils/treeUtils';
import { smartCreateIssue } from './smartCreateIssue';
import { Logger } from '../core/utils/Logger';

export function registerCreateSubIssueCommand(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.createSubIssue', async (...args: unknown[]) => {
            const node = args[0];
            if (node && isIssueTreeNode(node)) {
                const id = stripFocusedId(node.id);
                await smartCreateIssue(id, true);
            } else {
                Logger.getInstance().warn('createSubIssue 没有接收到有效的树节点参数。');
                vscode.window.showWarningMessage('请从视图中选择一个有效的问题节点来创建子问题。');
            }
        })
    );
}
