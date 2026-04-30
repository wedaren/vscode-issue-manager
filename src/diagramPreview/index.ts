import * as vscode from 'vscode';
import { DiagramRenderer } from './DiagramRenderer';
import { DiagramHoverProvider } from './hoverProvider';
import { DiagramCodeLensProvider } from './codeLensProvider';
import { DiagramFoldingProvider } from './foldingProvider';
import { registerDiagramPreviewCommands } from './commands';
import { scanDiagrams } from './scanner';

const MARKDOWN_SELECTOR: vscode.DocumentSelector = { language: 'markdown', scheme: 'file' };

export function activateDiagramPreview(context: vscode.ExtensionContext): void {
    DiagramRenderer.init(context);

    const hover = new DiagramHoverProvider();
    const codeLens = new DiagramCodeLensProvider();
    const folding = new DiagramFoldingProvider();

    context.subscriptions.push(
        vscode.languages.registerHoverProvider(MARKDOWN_SELECTOR, hover),
        vscode.languages.registerCodeLensProvider(MARKDOWN_SELECTOR, codeLens),
        vscode.languages.registerFoldingRangeProvider(MARKDOWN_SELECTOR, folding),
    );

    registerDiagramPreviewCommands(context);

    // 后台预热：激活/切换/编辑（防抖）markdown 文档时把 mermaid 块送去渲染缓存
    const warm = (doc: vscode.TextDocument | undefined) => {
        if (!doc || doc.languageId !== 'markdown') { return; }
        if (!vscode.workspace.getConfiguration('issueManager.diagramPreview').get<boolean>('enabled', true)) { return; }
        const blocks = scanDiagrams(doc);
        if (blocks.length === 0) { return; }
        void DiagramRenderer.get().warmCache(blocks);
    };

    if (vscode.window.activeTextEditor) {
        warm(vscode.window.activeTextEditor.document);
    }

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(ed => warm(ed?.document)),
    );

    let warmTimer: NodeJS.Timeout | undefined;
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.languageId !== 'markdown') { return; }
            if (warmTimer) { clearTimeout(warmTimer); }
            warmTimer = setTimeout(() => warm(e.document), 800);
        }),
    );

    // 配置变更：刷新 CodeLens / Folding 输出
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('issueManager.diagramPreview')) {
                codeLens.refresh();
            }
        }),
    );

    context.subscriptions.push({
        dispose: () => {
            if (warmTimer) { clearTimeout(warmTimer); }
            DiagramRenderer.get().dispose();
        },
    });
}
