import * as vscode from 'vscode';
import { scanDiagrams } from './scanner';
import { DiagramRenderer } from './DiagramRenderer';
import type { DiagramBlock } from './types';

/** 由 hash 反查文档中的块；未指定 docUri 时使用激活的 markdown 编辑器 */
async function resolveBlock(hash: string, docUriStr?: string): Promise<DiagramBlock | undefined> {
    const docs: vscode.TextDocument[] = [];
    if (docUriStr) {
        try {
            docs.push(await vscode.workspace.openTextDocument(vscode.Uri.parse(docUriStr)));
        } catch { /* fall through */ }
    }
    const active = vscode.window.activeTextEditor?.document;
    if (active && !docs.includes(active)) { docs.push(active); }
    for (const doc of docs) {
        const block = scanDiagrams(doc).find(b => b.hash === hash);
        if (block) { return block; }
    }
    return undefined;
}

export function registerDiagramPreviewCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'issueManager.diagramPreview.openInPanel',
            async (hash: string, docUriStr?: string) => {
                const block = await resolveBlock(hash, docUriStr);
                if (!block) { return; }
                await DiagramRenderer.get().showInPanel(block);
            },
        ),
    );
}
