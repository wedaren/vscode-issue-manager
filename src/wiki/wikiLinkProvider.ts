import * as vscode from 'vscode';
import { extractFrontmatterAndBody } from '../data/IssueMarkdowns';
import type { WikiBacklinkIndex } from './wikiBacklinkIndex';

/**
 * 处理 [[wiki/...]] 和 [[raw/...]] 的 DocumentLinkProvider。
 *
 * 与既有 IssueDocumentLinkProvider 共存:那一个走 frontmatter.issue_type === 'wiki' 的旧约定,
 * 这一个走 frontmatter.issue_title 以 wiki/ 或 raw/ 开头的 Karpathy 风格新约定。
 *
 * 命中时直接打开对应的 .md 文件;未命中(target 不存在)则不创建链接,留给老 provider 走 openOrCreateWiki。
 */
export class WikiLinkProvider implements vscode.DocumentLinkProvider {
    constructor(private readonly index: WikiBacklinkIndex) {}

    async provideDocumentLinks(
        document: vscode.TextDocument,
        token: vscode.CancellationToken,
    ): Promise<vscode.DocumentLink[]> {
        if (document.languageId !== 'markdown') { return []; }
        await this.index.ensureBuilt();
        if (token.isCancellationRequested) { return []; }

        const text = document.getText();
        const links: vscode.DocumentLink[] = [];
        const pattern = /\[\[((?:wiki|raw)\/[^\]]+)\]\]/g;
        for (const match of text.matchAll(pattern)) {
            if (token.isCancellationRequested) { return links; }
            const target = match[1];
            const found = this.index.findByTitle(target);
            if (!found) { continue; } // 让其它 provider 处理(创建命令)

            const start = match.index! + 2; // 跳过 '[['
            const end = start + target.length;
            const range = new vscode.Range(
                document.positionAt(start),
                document.positionAt(end),
            );
            const link = new vscode.DocumentLink(range, found.uri);
            link.tooltip = `打开 ${target}`;
            links.push(link);
        }
        return links;
    }
}

/**
 * 处理 [[wiki/...]] / [[raw/...]] 的 hover,展示标题 + 摘要预览 + 反向链接计数。
 */
export class WikiHoverProvider implements vscode.HoverProvider {
    constructor(private readonly index: WikiBacklinkIndex) {}

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
    ): Promise<vscode.Hover | undefined> {
        if (document.languageId !== 'markdown') { return; }

        // 先在当前行就地匹配 [[wiki/...]] / [[raw/...]],不需要全文扫描
        const line = document.lineAt(position.line).text;
        const pattern = /\[\[((?:wiki|raw)\/[^\]]+)\]\]/g;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(line)) !== null) {
            const start = match.index;
            const end = start + match[0].length;
            const range = new vscode.Range(
                new vscode.Position(position.line, start),
                new vscode.Position(position.line, end),
            );
            if (!range.contains(position)) { continue; }

            await this.index.ensureBuilt();
            if (token.isCancellationRequested) { return; }

            const target = match[1];
            const found = this.index.findByTitle(target);
            const backlinks = this.index.getBacklinks(target);
            const md = new vscode.MarkdownString('', true);
            md.isTrusted = true;

            md.appendMarkdown(`**${target}**\n\n`);

            if (!found) {
                md.appendMarkdown(`_⚠️ 这个 wiki/raw 还不存在_\n\n`);
            } else {
                md.appendMarkdown(`📁 \`${vscode.workspace.asRelativePath(found.uri)}\`\n\n`);
                // 正文预览(最多 400 字)
                try {
                    const bytes = await vscode.workspace.fs.readFile(found.uri);
                    const { body } = extractFrontmatterAndBody(Buffer.from(bytes).toString('utf8'));
                    const preview = body.trim().slice(0, 400);
                    if (preview) {
                        md.appendMarkdown('---\n\n');
                        md.appendMarkdown(preview);
                        if (body.trim().length > 400) { md.appendMarkdown('…'); }
                        md.appendMarkdown('\n\n');
                    }
                } catch { /* skip */ }
            }

            // 反向链接计数 + 列表(最多 5 条)
            md.appendMarkdown('---\n\n');
            md.appendMarkdown(`🔗 入链: **${backlinks.length}**`);
            if (backlinks.length > 0) {
                md.appendMarkdown('\n\n');
                for (const b of backlinks.slice(0, 5)) {
                    const openCmd = `command:vscode.open?${encodeURIComponent(JSON.stringify([b.uri.toString()]))}`;
                    md.appendMarkdown(`- [${b.title}](${openCmd})\n`);
                }
                if (backlinks.length > 5) {
                    md.appendMarkdown(`- _…还有 ${backlinks.length - 5} 个_\n`);
                }
            }

            return new vscode.Hover(md, range);
        }
        return;
    }
}
