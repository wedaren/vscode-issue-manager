import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { DiagramBlock, DiagramType } from './types';

// 支持的 fenced 语言 → diagram 类型
const FENCE_LANG_MAP: Record<string, DiagramType> = {
    mermaid: 'mermaid',
    math: 'math',
    latex: 'math',
};

/** 哈希源码以作缓存 key（带类型前缀防冲突） */
function hashSource(type: DiagramType, source: string): string {
    return crypto.createHash('sha256').update(`${type}\n${source}`).digest('hex').slice(0, 32);
}

/**
 * 扫描 Markdown 文档中的图表块（mermaid fenced、math fenced、$$..$$）。
 *
 * 用基于行的状态机而不是单一正则，对嵌套缩进、CRLF、不闭合 fence 更鲁棒。
 */
export function scanDiagrams(document: vscode.TextDocument): DiagramBlock[] {
    if (document.languageId !== 'markdown') { return []; }

    const blocks: DiagramBlock[] = [];
    const lineCount = document.lineCount;

    let i = 0;
    while (i < lineCount) {
        const line = document.lineAt(i).text;

        // ---- fenced code block: ```mermaid / ```math / ```latex ----
        const fenceMatch = line.match(/^([ \t]*)(`{3,}|~{3,})\s*([a-zA-Z][\w-]*)\s*$/);
        if (fenceMatch) {
            const [, indent, fence, lang] = fenceMatch;
            const type = FENCE_LANG_MAP[lang.toLowerCase()];
            if (!type) { i++; continue; }

            const closeRe = new RegExp(`^${indent}${fence[0]}{${fence.length},}\\s*$`);
            const startLine = i;
            const sourceStart = i + 1;
            let j = sourceStart;
            let closed = false;
            while (j < lineCount) {
                if (closeRe.test(document.lineAt(j).text)) { closed = true; break; }
                j++;
            }
            if (!closed) {
                // 不闭合，跳过当前 fence 行继续扫
                i++;
                continue;
            }
            const sourceEnd = j;
            const sourceText = document
                .getText(new vscode.Range(sourceStart, 0, sourceEnd, 0))
                .replace(/\n$/, '');
            blocks.push({
                type,
                source: sourceText,
                fullRange: new vscode.Range(startLine, 0, j, document.lineAt(j).text.length),
                hash: hashSource(type, sourceText),
            });
            i = j + 1;
            continue;
        }

        // ---- $$ ... $$ math display block ----
        if (/^[ \t]*\$\$\s*$/.test(line)) {
            const startLine = i;
            const sourceStart = i + 1;
            let j = sourceStart;
            let closed = false;
            while (j < lineCount) {
                if (/^[ \t]*\$\$\s*$/.test(document.lineAt(j).text)) { closed = true; break; }
                j++;
            }
            if (closed) {
                const sourceText = document
                    .getText(new vscode.Range(sourceStart, 0, j, 0))
                    .replace(/\n$/, '');
                blocks.push({
                    type: 'math',
                    source: sourceText,
                    fullRange: new vscode.Range(startLine, 0, j, document.lineAt(j).text.length),
                    hash: hashSource('math', sourceText),
                });
                i = j + 1;
                continue;
            }
        }

        i++;
    }

    return blocks;
}

/** 给定位置，返回命中的 block（若有） */
export function findBlockAt(blocks: DiagramBlock[], position: vscode.Position): DiagramBlock | undefined {
    return blocks.find(b => b.fullRange.contains(position));
}
