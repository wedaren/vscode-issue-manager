import * as vscode from 'vscode';
import { getAllIssueMarkdowns, type IssueMarkdown, extractFrontmatterAndBody } from '../data/IssueMarkdowns';

/**
 * Wiki/Raw 笔记的反向链接索引。
 *
 * 数据形态:
 *   forward:  title (e.g. "wiki/concepts/ACP")  →  IssueMarkdown
 *   backlinks: target title  →  来源 IssueMarkdown 列表(正文中含 [[target]])
 *
 * 由于 issueDir 可能有 19000+ 文件,索引构建是异步增量的:
 *   - 首次 ensureBuilt() 后,内存中保留全量映射
 *   - onTitleUpdate 事件触发时只重建受影响的 wiki/raw 文件
 *   - 失效策略简单粗暴:任何 wiki/raw 文件的 mtime 变化 → 全量重建(这种数据规模 < 几千,毫秒级)
 */
export class WikiBacklinkIndex {
    /** title → IssueMarkdown */
    private byTitle = new Map<string, IssueMarkdown>();
    /** target title → 引用它的笔记列表 */
    private backlinks = new Map<string, IssueMarkdown[]>();
    private lastBuildAt = 0;
    /** 防止并发重建 */
    private buildingPromise: Promise<void> | null = null;

    /** 确保索引已经构建(或在 staleness 超过阈值时重建) */
    async ensureBuilt(): Promise<void> {
        const STALE_MS = 30_000;
        if (this.lastBuildAt > 0 && Date.now() - this.lastBuildAt < STALE_MS) {
            return;
        }
        if (this.buildingPromise) {
            return this.buildingPromise;
        }
        this.buildingPromise = this.build().finally(() => { this.buildingPromise = null; });
        return this.buildingPromise;
    }

    invalidate(): void { this.lastBuildAt = 0; }

    findByTitle(title: string): IssueMarkdown | undefined {
        return this.byTitle.get(title);
    }

    getBacklinks(targetTitle: string): IssueMarkdown[] {
        return this.backlinks.get(targetTitle) ?? [];
    }

    private async build(): Promise<void> {
        const all = await getAllIssueMarkdowns({});
        const wikiRaw = all.filter(i =>
            typeof i.title === 'string'
            && (i.title.startsWith('wiki/') || i.title.startsWith('raw/'))
        );

        const byTitle = new Map<string, IssueMarkdown>();
        for (const issue of wikiRaw) { byTitle.set(issue.title, issue); }

        // 扫描每个 wiki/raw 笔记的正文,收集 [[wiki/...]] 与 [[raw/...]] 引用
        const backlinks = new Map<string, IssueMarkdown[]>();
        const linkPattern = /\[\[((?:wiki|raw)\/[^\]]+)\]\]/g;
        for (const source of wikiRaw) {
            try {
                const bytes = await vscode.workspace.fs.readFile(source.uri);
                const { body } = extractFrontmatterAndBody(Buffer.from(bytes).toString('utf8'));
                const seenInThisFile = new Set<string>();
                for (const m of body.matchAll(linkPattern)) {
                    const target = m[1];
                    if (seenInThisFile.has(target)) { continue; }
                    seenInThisFile.add(target);
                    const arr = backlinks.get(target) ?? [];
                    arr.push(source);
                    backlinks.set(target, arr);
                }
            } catch { /* skip */ }
        }

        this.byTitle = byTitle;
        this.backlinks = backlinks;
        this.lastBuildAt = Date.now();
    }
}
