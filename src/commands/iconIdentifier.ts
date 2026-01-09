import * as vscode from 'vscode';
import { IconService } from '../llm/IconService';

export function registerGetIconIdentifierCommand(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.getIconIdentifier', async () => {
            const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { identifier?: string }>();
            qp.placeholder = '输入想法（例如：保存、警告），等待建议';
            qp.matchOnDescription = true;
            qp.matchOnDetail = true;
            qp.items = [];
            qp.busy = false;

            let debounceTimer: NodeJS.Timeout | undefined;
            let currentAbort: AbortController | undefined;

            qp.onDidHide(() => {
                if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = undefined; }
                if (currentAbort) { currentAbort.abort(); currentAbort = undefined; }
                qp.dispose();
            });

            qp.onDidChangeValue(value => {
                if (debounceTimer) { clearTimeout(debounceTimer); }
                if (!value || value.trim().length === 0) {
                    qp.items = [];
                    qp.busy = false;
                    return;
                }
                qp.busy = true;
                debounceTimer = setTimeout(async () => {
                    if (currentAbort) { currentAbort.abort(); }
                    currentAbort = new AbortController();
                    try {
                        const results = await IconService.generateIconIdentifiers(value, { signal: currentAbort.signal });
                        qp.items = results.map(r => ({
                            label: r.identifier || r.identifier,
                            description: r.label || r.description || '',
                            detail: r.description || '',
                            identifier: r.identifier,
                            iconPath: new vscode.ThemeIcon(r.identifier || '') as any,
                        } as vscode.QuickPickItem & { identifier?: string }));
                    } catch (e) {
                        // ignore
                        qp.items = [];
                    } finally {
                        qp.busy = false;
                    }
                }, 400);
            });

            qp.onDidAccept(async () => {
                const sel = qp.selectedItems[0] as (vscode.QuickPickItem & { identifier?: string }) | undefined;
                if (sel && sel.identifier) {
                    try {
                        await vscode.env.clipboard.writeText(sel.identifier);
                        vscode.window.showInformationMessage('已将 icon identifier 复制到剪贴板');
                    } catch (e) {
                        vscode.window.showErrorMessage('复制到剪贴板失败');
                    }
                }
                qp.hide();
            });

            qp.show();
        })
    );
}
