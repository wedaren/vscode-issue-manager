import * as vscode from 'vscode';
import { getAllIssueMarkdowns, type IssueMarkdown, extractFrontmatterAndBody } from '../data/IssueMarkdowns';
import { perfMetrics } from '../services/PerfMetrics';

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
 *   - 失效策略简单粗暴:任何 wiki/raw 文件的 mtime 变化 → 全量重建;
 *     正文读取按批次并行，避免大库下串行读盘长时间阻塞事件循环
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
        const buildStart = Date.now();
        const all = await getAllIssueMarkdowns({});
        const wikiRaw = all.filter(i =>
            typeof i.title === 'string'
            && (i.title.startsWith('wiki/') || i.title.startsWith('raw/'))
        );

        const byTitle = new Map<string, IssueMarkdown>();
        for (const issue of wikiRaw) { byTitle.set(issue.title, issue); }

        // 扫描每个 wiki/raw 笔记的正文,收集 [[wiki/...]] 与 [[raw/...]] 引用
        // 分批并行读取正文（输出顺序与串行完全一致：先按文件收集，再按原顺序串行合并）
        const linkPattern = /\[\[((?:wiki|raw)\/[^\]]+)\]\]/g;
        const READ_BATCH_SIZE = 20;
        const perFileTargets: (string[] | null)[] = new Array(wikiRaw.length).fill(null);
        for (let i = 0; i < wikiRaw.length; i += READ_BATCH_SIZE) {
            const batch = wikiRaw.slice(i, i + READ_BATCH_SIZE);
            const batchResults = await Promise.all(batch.map(async (source) => {
                try {
                    const bytes = await vscode.workspace.fs.readFile(source.uri);
                    const { body } = extractFrontmatterAndBody(Buffer.from(bytes).toString('utf8'));
                    const seenInThisFile = new Set<string>();
                    const targets: string[] = [];
                    for (const m of body.matchAll(linkPattern)) {
                        const target = m[1];
                        if (seenInThisFile.has(target)) { continue; }
                        seenInThisFile.add(target);
                        targets.push(target);
                    }
                    return targets;
                } catch {
                    return null; /* skip */
                }
            }));
            for (let j = 0; j < batchResults.length; j++) {
                perFileTargets[i + j] = batchResults[j];
            }
        }

        // 串行合并，保证 backlinks 数组顺序与原先的串行扫描一致
        const backlinks = new Map<string, IssueMarkdown[]>();
        for (let i = 0; i < wikiRaw.length; i++) {
            const targets = perFileTargets[i];
            if (!targets) { continue; }
            const source = wikiRaw[i];
            for (const target of targets) {
                const arr = backlinks.get(target) ?? [];
                arr.push(source);
                backlinks.set(target, arr);
            }
        }

        perfMetrics.increment('wiki.backlinkBodyRead', wikiRaw.length);
        perfMetrics.recordTiming('wiki.backlinkBuild', Date.now() - buildStart);

        this.byTitle = byTitle;
        this.backlinks = backlinks;
        this.lastBuildAt = Date.now();
    }
}
