import * as vscode from 'vscode';
import { isIssueTreeNode } from '../utils/treeUtils';
import { readTree, findNodeById, stripFocusedId } from '../data/issueTreeManager';
import { getIssueIdFromUri } from '../utils/uriUtils';

/**
 * 返回用于注册的命令处理器：在活动编辑器旁边打开问题文件
 *
 * @param logger 可选 logger，用于记录错误（来自 BaseCommandRegistry.logger）
 */
export function createOpenIssueBesideEditorHandler(logger?: { error?: (...args: any[]) => void }) {
    return async (...args: unknown[]) => {
        try {
            let sourceUri: vscode.Uri | undefined;
            let issueId: string | undefined;
            const first = args && args.length > 0 ? args[0] : undefined;

            if (first) {
                if (isIssueTreeNode(first)) {
                    const node = first as any;
                    issueId = stripFocusedId(node.id);
                    sourceUri = node.resourceUri;
                } else if (typeof first === 'string') {
                    try {
                        const parsed = vscode.Uri.parse(first as string);
                        sourceUri = parsed;
                        issueId = getIssueIdFromUri(parsed) || undefined;
                    } catch (e) {
                        // ignore
                    }
                } else if (typeof first === 'object' && first !== null && ('fsPath' in first || 'scheme' in first)) {
                    sourceUri = first as vscode.Uri;
                    issueId = getIssueIdFromUri(sourceUri) || undefined;
                }
            }

            const editor = vscode.window.activeTextEditor;
            if ((!sourceUri || !issueId) && editor) {
                const uri = editor.document.uri;
                const idFromEditor = getIssueIdFromUri(uri);
                if (!sourceUri) sourceUri = uri;
                if (!issueId && idFromEditor) issueId = idFromEditor;
            }

            if (!sourceUri && !issueId) {
                vscode.window.showInformationMessage('请提供问题的 URL 或从视图中选择问题，或激活包含 issueId 的编辑器。');
                return;
            }

            let targetUri: vscode.Uri | undefined = sourceUri;
            if (issueId && !targetUri) {
                const tree = await readTree();
                const found = findNodeById(tree.rootNodes, issueId);
                if (found && found.node && found.node.resourceUri) {
                    targetUri = found.node.resourceUri;
                }
            }

            if (!targetUri) {
                vscode.window.showWarningMessage('无法确定要打开的目标问题文件。');
                return;
            }

            const viewColumn = vscode.ViewColumn.Beside;
            const finalUri = issueId ? targetUri.with({ query: `issueId=${encodeURIComponent(issueId)}` }) : targetUri;
            await vscode.window.showTextDocument(finalUri, { preview: false, viewColumn });

        } catch (error) {
            logger?.error && logger.error('在编辑器旁边打开问题失败', error);
            vscode.window.showErrorMessage('在编辑器旁边打开问题失败');
        }
    };
}
