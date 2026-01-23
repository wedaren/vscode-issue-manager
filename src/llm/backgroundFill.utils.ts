import * as vscode from 'vscode';
import { LLMService } from './LLMService';

export function createAbortControllerWithTimeout(timeoutMs: number | undefined) {
    const controller = new AbortController();
    let timeoutId: NodeJS.Timeout | undefined;
    if (timeoutMs && timeoutMs > 0) {
        timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    }
    return {
        controller,
        clear: () => { if (timeoutId) clearTimeout(timeoutId); }
    };
}

export async function readFileStatSafe(uri: vscode.Uri): Promise<vscode.FileStat | undefined> {
    try {
        return await vscode.workspace.fs.stat(uri);
    } catch (e) {
        return undefined;
    }
}

export async function callLLMGenerateDocument(prompt: string, signal?: AbortSignal) {
    try {
        // LLMService may accept an options object with signal
        // Keep this thin so it can be mocked in tests
        return await LLMService.generateDocument(prompt, { signal });
    } catch (e) {
        // Let caller handle errors (including Abort)
        throw e;
    }
}

export async function savePendingFile(targetUri: vscode.Uri, content: string): Promise<vscode.Uri> {
    const pendingPath = `${targetUri.fsPath}.pending.${Date.now()}.md`;
    const pendingUri = vscode.Uri.file(pendingPath);
    await vscode.workspace.fs.writeFile(pendingUri, Buffer.from(content, 'utf8'));
    return pendingUri;
}

export async function atomicWriteFile(uri: vscode.Uri, content: string): Promise<void> {
    // For now just write directly; encapsulated for future atomic strategies
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
}

export async function updateOpenEditorIfCleanOrSavePending(uri: vscode.Uri, content: string): Promise<{ updated: boolean; pendingUri?: vscode.Uri }> {
    try {
        const openEditors = vscode.window.visibleTextEditors.filter(e => e.document.uri.fsPath === uri.fsPath);
        if (openEditors.length === 0) return { updated: false };

        const editor = openEditors[0];
        if (!editor.document.isDirty) {
            const newDoc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(newDoc, { viewColumn: editor.viewColumn, preview: false, preserveFocus: true });
            return { updated: true };
        }

        const pendingUri = await savePendingFile(uri, content);
        try { await vscode.commands.executeCommand('issueManager.refreshAllViews'); } catch (e) {}
        return { updated: false, pendingUri };
    } catch (e) {
        // Bubble up to caller
        throw e;
    }
}

