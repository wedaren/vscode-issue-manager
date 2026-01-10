import * as vscode from 'vscode';
import { isIssueNode, stripFocusedId } from '../data/issueTreeManager';
import { smartCreateIssue } from './smartCreateIssue';
import { Logger } from '../core/utils/Logger';

export function registerCreateSubIssueCommand(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.createSubIssue', async (...args: unknown[]) => {
            const node = args[0];
                if (node && isIssueNode(node)) {
                const id = stripFocusedId(node.id);
                await smartCreateIssue(id, { addToTree: true });
            } else {
                Logger.getInstance().warn('createSubIssue 没有接收到有效的树节点参数。');
                vscode.window.showWarningMessage('请从视图中选择一个有效的问题节点来创建子问题。');
            }
        })
    );
}
