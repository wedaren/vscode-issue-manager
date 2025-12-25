import * as vscode from 'vscode';
import { stripFocusedId } from '../data/issueTreeManager';
import { getIssueIdFromUri } from '../utils/uriUtils';
import { smartCreateIssue } from './smartCreateIssue';
import { Logger } from '../core/utils/Logger';

export function registerCreateSubIssueFromEditorCommand(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.createSubIssueFromEditor', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('没有激活的编辑器可创建子问题。');
                return;
            }

            const id = getIssueIdFromUri(editor.document.uri);
            if (!id) {
                vscode.window.showWarningMessage('当前文档不包含有效的问题 ID，无法创建子问题。');
                return;
            }

            try {
                const parentId = stripFocusedId(id);
                await smartCreateIssue(parentId, { addToTree: true, open: true, reveal: true });
            } catch (error) {
                // 使用统一 Logger 记录错误
                Logger.getInstance().error('通过编辑器创建子问题失败:', error);
                vscode.window.showErrorMessage('创建子问题失败');
            }
        })
    );
}
