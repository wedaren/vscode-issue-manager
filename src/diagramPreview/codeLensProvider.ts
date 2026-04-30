import * as vscode from 'vscode';
import { scanDiagrams } from './scanner';

export class DiagramCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this._onDidChange.event;

    refresh(): void { this._onDidChange.fire(); }

    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        if (!isEnabled()) { return []; }
        if (document.languageId !== 'markdown') { return []; }

        const lenses: vscode.CodeLens[] = [];
        for (const block of scanDiagrams(document)) {
            const range = new vscode.Range(block.fullRange.start, block.fullRange.start);
            const label = block.type === 'mermaid' ? '$(eye) 查看图' : '$(eye) 渲染公式';
            lenses.push(new vscode.CodeLens(range, {
                title: label,
                command: 'issueManager.diagramPreview.openInPanel',
                arguments: [block.hash, document.uri.toString()],
            }));
        }
        return lenses;
    }
}

function isEnabled(): boolean {
    return vscode.workspace.getConfiguration('issueManager.diagramPreview').get<boolean>('enabled', true);
}
