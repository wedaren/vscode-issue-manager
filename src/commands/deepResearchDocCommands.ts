import * as vscode from 'vscode';
import { DeepResearchDocNode } from '../views/DeepResearchIssuesProvider';

function isDeepResearchDocNode(value: unknown): value is DeepResearchDocNode {
    return value instanceof DeepResearchDocNode;
}

export function registerDeepResearchDocCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.deepResearch.deleteDoc', async (...args: unknown[]) => {
            const node = args[0];
            if (!isDeepResearchDocNode(node)) {
                vscode.window.showWarningMessage('删除失败：未选择有效的深度调研文档节点。');
                return;
            }

            const uri = node.meta.uri;
            const picked = await vscode.window.showWarningMessage(
                `确认删除深度调研文档？\n${uri.fsPath}`,
                { modal: true },
                '删除'
            );

            if (picked !== '删除') {
                return;
            }

            try {
                await vscode.workspace.fs.delete(uri, { useTrash: true });
                void vscode.commands.executeCommand('issueManager.refreshAllViews');
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                vscode.window.showErrorMessage(`删除失败：${msg}`);
            }
        })
    );
}
