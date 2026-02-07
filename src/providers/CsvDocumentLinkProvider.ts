import * as vscode from 'vscode';

export class CsvDocumentLinkProvider implements vscode.DocumentLinkProvider {
    public provideDocumentLinks(document: vscode.TextDocument): vscode.ProviderResult<vscode.DocumentLink[]> {
        const config = vscode.workspace.getConfiguration('issueManager');
        const enabledColumns = config.get<string[]>('csvSearch.enabledColumns', []);
        if (!enabledColumns || enabledColumns.length === 0) {
            return [];
        }

        const links: vscode.DocumentLink[] = [];
        const lineCount = document.lineCount;

        // Parse header to map column names -> indices
        const headerLine = lineCount > 0 ? document.lineAt(0).text : '';
        const headerCols = this.splitWithPositions(headerLine).map(c => c.text.trim());

        const enabledIndices = new Set<number>();
        for (const raw of enabledColumns) {
            const s = (raw || '').trim();
            if (!s) continue;
            if (/^\d+$/.test(s)) {
                enabledIndices.add(Number.parseInt(s, 10));
            } else {
                const idx = headerCols.findIndex(h => h === s);
                if (idx >= 0) enabledIndices.add(idx);
            }
        }

        if (enabledIndices.size === 0) return [];

        for (let i = 1; i < lineCount; i++) {
            const line = document.lineAt(i).text;
            const cols = this.splitWithPositions(line);
            for (const idx of enabledIndices) {
                if (idx < 0 || idx >= cols.length) continue;
                const col = cols[idx];
                const startPos = new vscode.Position(i, col.start);
                const endPos = new vscode.Position(i, Math.max(col.start, col.end));
                const range = new vscode.Range(startPos, endPos);
                const value = col.text;
                // Create command uri to trigger search
                const args = encodeURIComponent(JSON.stringify([value]));
                const target = vscode.Uri.parse(`command:issueManager.csvSearch?${args}`);
                const link = new vscode.DocumentLink(range, target);
                links.push(link);
            }
        }

        return links;
    }

    // Split a CSV line into columns with start/end offsets. Simple parser handling quoted values and escaped quotes.
    private splitWithPositions(line: string): Array<{ text: string; start: number; end: number }> {
        const res: Array<{ text: string; start: number; end: number }> = [];
        let i = 0;
        let start = 0;
        let inQuotes = false;
        while (i <= line.length) {
            const ch = i < line.length ? line[i] : '\n';
            if (ch === '"') {
                // handle quote and escaped quote
                if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
                    i += 2; // skip escaped quote
                    continue;
                }
                inQuotes = !inQuotes;
                i++;
                continue;
            }
            if ((ch === ',' || ch === '\n') && !inQuotes) {
                const end = i;
                let raw = line.substring(start, end);
                raw = this.unquote(raw);
                res.push({ text: raw, start, end });
                start = i + 1;
                i++;
                continue;
            }
            i++;
        }
        // If line ends with a trailing comma, ensure an empty column is accounted for
        if (line.endsWith(',')) {
            const idx = res.length;
            res.push({ text: '', start: line.length, end: line.length });
        }
        return res;
    }

    private unquote(raw: string): string {
        let s = raw.trim();
        if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
            s = s.substring(1, s.length - 1).replace(/""/g, '"');
        }
        return s;
    }
}

export default CsvDocumentLinkProvider;
