import * as vscode from 'vscode';
import { scanDiagrams, findBlockAt } from './scanner';
import { DiagramRenderer } from './DiagramRenderer';
import type { DiagramBlock } from './types';

const MAX_HOVER_BYTES = 1.5 * 1024 * 1024; // ~1.5MB SVG 上限，避免 hover 卡顿

export class DiagramHoverProvider implements vscode.HoverProvider {
    async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
        if (!isEnabled()) { return; }
        if (document.languageId !== 'markdown') { return; }

        const block = findBlockAt(scanDiagrams(document), position);
        if (!block) { return; }

        if (block.type === 'mermaid') {
            return this.mermaidHover(block);
        }
        return this.mathHover(block);
    }

    private async mermaidHover(block: DiagramBlock): Promise<vscode.Hover> {
        const renderer = DiagramRenderer.get();
        // 内存→磁盘 双层查，磁盘 hit 也不会触发 webview，避免误开面板
        const cached = renderer.peekCache(block.hash) ?? await renderer.getCached(block.hash);

        const md = new vscode.MarkdownString();
        md.isTrusted = true;
        md.supportHtml = true;

        const openArgs = encodeURIComponent(JSON.stringify([block.hash]));
        const openCmd = `command:issueManager.diagramPreview.openInPanel?${openArgs}`;

        if (cached && cached.length <= MAX_HOVER_BYTES) {
            // cache 中已是 normalizeSvg() 处理过的（带显式像素尺寸）；img width:100% 顶满 hover 容器
            // 整张图作为「点开看大图」的入口 → 单击进 ImageLightbox（缩放/拖拽 UX 在那里）
            const dataUri = svgToDataUri(cached);
            md.appendMarkdown(
                `<a href="${openCmd}" title="点击在 Image Lightbox 打开（支持缩放/拖拽）">` +
                `<img src="${dataUri}" style="width:100%;display:block;background:white;border-radius:4px;cursor:zoom-in">` +
                `</a>\n\n`,
            );
        } else if (cached) {
            md.appendMarkdown(`*（渲染产物较大，已折叠以避免 hover 卡顿，使用「在面板查看」打开）*\n\n`);
        } else {
            md.appendMarkdown(`*未渲染。点击下方「在面板查看」会打开渲染面板。*\n\n`);
        }

        md.appendMarkdown(
            `<div style="text-align:right;font-size:11px">` +
            `<a href="${openCmd}">⊕ 大图查看（带缩放/拖拽/复制）</a>` +
            `</div>`,
        );
        return new vscode.Hover(md, block.fullRange);
    }

    private mathHover(block: DiagramBlock): vscode.Hover {
        // Phase 1：仅展示源码 + 入口（Phase 2 接渲染）
        const md = new vscode.MarkdownString();
        md.isTrusted = true;
        md.appendCodeblock(block.source, 'latex');
        const openCmd = `command:issueManager.diagramPreview.openInPanel?${encodeURIComponent(JSON.stringify([block.hash]))}`;
        md.appendMarkdown(`\n*Math 渲染将在 Phase 2 启用，目前只显示源码。*  [在面板渲染](${openCmd})`);
        return new vscode.Hover(md, block.fullRange);
    }
}

function svgToDataUri(svg: string): string {
    return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

function isEnabled(): boolean {
    return vscode.workspace.getConfiguration('issueManager.diagramPreview').get<boolean>('enabled', true);
}
