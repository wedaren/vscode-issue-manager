import * as vscode from 'vscode';
import { LLMService } from '../llm/LLMService';

type LLMMethod = (content: string, options: { signal?: AbortSignal }) => Promise<Array<{ name: string; description?: string }>>;

async function generateAndShow(
    content: string,
    progressTitle: string,
    llmMethod: LLMMethod,
    placeholder: string,
    successMessage: string,
    emptyMessage = '未生成建议。'
) {
    const items = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: progressTitle, cancellable: true }, async (progress, token) => {
        const abortController = new AbortController();
        token.onCancellationRequested(() => abortController.abort());
        try {
            const results = await llmMethod(content, { signal: abortController.signal });
            return results.map(r => ({ label: r.name, description: r.description } as vscode.QuickPickItem));
        } catch (e) {
            return [];
        }
    });

    if (!items || items.length === 0) {
        vscode.window.showInformationMessage(emptyMessage);
        return;
    }

    const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { label: string }>();
    qp.items = items;
    qp.placeholder = placeholder;
    qp.onDidHide(() => qp.dispose());
    qp.onDidAccept(async () => {
        const sel = qp.selectedItems[0];
        if (sel) {
            await vscode.env.clipboard.writeText(sel.label);
            vscode.window.showInformationMessage(successMessage);
        }
        qp.hide();
    });
    qp.show();
}

export function registerGenerateProjectNameCommand(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.generateProjectName', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('请在活动编辑器中运行此命令以基于内容生成项目名。');
                return;
            }

            const content = editor.document.getText();

            await generateAndShow(
                content,
                '正在生成项目名...',
                LLMService.generateProjectNames,
                '选择一个项目名，将会复制到剪贴板',
                '已将项目名复制到剪贴板',
                '未生成项目名建议。'
            );
        })
    );
}

export function registerGenerateGitBranchCommand(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.generateGitBranchName', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('请在活动编辑器中运行此命令以基于内容生成分支名。');
                return;
            }

            const content = editor.document.getText();

            await generateAndShow(
                content,
                '正在生成 Git 分支名...',
                LLMService.generateGitBranchNames,
                '选择一个分支名，将会复制到剪贴板',
                '已将分支名复制到剪贴板',
                '未生成 Git 分支名建议。'
            );
        })
    );
}
