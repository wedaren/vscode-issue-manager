import * as vscode from 'vscode';
import { scanDiagrams } from './scanner';

export class DiagramFoldingProvider implements vscode.FoldingRangeProvider {
    provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
        if (!isEnabled()) { return []; }
        if (document.languageId !== 'markdown') { return []; }

        const cfg = vscode.workspace.getConfiguration('issueManager.diagramPreview');
        const foldMermaid = cfg.get<boolean>('foldMermaidByDefault', true);
        const foldMath = cfg.get<boolean>('foldMathByDefault', false);

        const ranges: vscode.FoldingRange[] = [];
        for (const block of scanDiagrams(document)) {
            const start = block.fullRange.start.line;
            const end = block.fullRange.end.line;
            if (end <= start) { continue; }
            const wantFold =
                (block.type === 'mermaid' && foldMermaid) ||
                (block.type === 'math' && foldMath);
            if (!wantFold) { continue; }
            ranges.push(new vscode.FoldingRange(start, end, vscode.FoldingRangeKind.Region));
        }
        return ranges;
    }
}

function isEnabled(): boolean {
    return vscode.workspace.getConfiguration('issueManager.diagramPreview').get<boolean>('enabled', true);
}
