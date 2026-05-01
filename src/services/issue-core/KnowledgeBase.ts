import * as https from "node:https";
import * as http from "node:http";
import type { IssueRepository } from "./IssueRepository";
import type { IssueMarkdownCore } from "./types";
import { extractFrontmatterAndBody } from "./frontmatter";

// ─── 类型 ─────────────────────────────────────────────────────

export type IngestMode = "url" | "text" | "file";

export interface IngestOptions {
    mode: IngestMode;
    /** URL / 文本内容 / 文件绝对路径 */
    source: string;
    /** 分类(如 articles, papers, notes, repos) */
    category: string;
    /** 素材标题 */
    title: string;
    /**
     * 当 mode=file 时,用于读取本地文件的回调。
     * 调用方负责安全策略(例如限制 source 路径在白名单内)。
     * 不提供则 file 模式抛错。
     */
    fileReader?: (absPath: string) => Promise<string>;
}

export interface IngestResult {
    fileName: string;
    sourceLabel: string;
    contentLength: number;
}

export interface CompileReport {
    targetFile?: string;
    target?: { title: string; fileName: string; body: string };
    rawIssues: Array<{ title: string; fileName: string; compiled: boolean }>;
    wikiTitles: string[];
    uncompiledCount: number;
}

export interface LinkScanReport {
    totalArticles: number;
    brokenLinks: Array<{ from: string; to: string }>;
    orphans: string[];
    missingBacklinks: Array<{ from: string; to: string }>;
}

export interface HealthReport {
    rawCount: number;
    wikiCount: number;
    /** wiki 文章总数 / raw 素材总数(百分比),raw 数量为 0 时返回 null */
    coverage: number | null;
    /** 桩文章(正文 < 200 字) */
    stubs: string[];
    /** 30 天未更新的文章 */
    stale: Array<{ title: string; ageDays: number }>;
    /** 标题相似度 > 0.6 的潜在重复 */
    duplicates: Array<{ a: string; b: string; sim: number }>;
}

export interface KbQueryHit {
    title: string;
    fileName: string;
    score: number;
    snippet: string;
}

// ─── 辅助函数 ────────────────────────────────────────────────

function httpGet(url: string, timeoutMs = 15000): Promise<string> {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith("https") ? https : http;
        const req = mod.get(url, { timeout: timeoutMs }, res => {
            if (
                (res.statusCode === 301 || res.statusCode === 302
                || res.statusCode === 307 || res.statusCode === 308)
                && res.headers.location
            ) {
                req.destroy();
                httpGet(res.headers.location, timeoutMs).then(resolve).catch(reject);
                return;
            }
            if (res.statusCode && res.statusCode >= 400) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => chunks.push(chunk));
            res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
            res.on("error", reject);
        });
        req.on("timeout", () => { req.destroy(); reject(new Error("请求超时")); });
        req.on("error", reject);
    });
}

function stripHtml(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function extractWikiLinks(body: string): string[] {
    const matches = body.match(/\[\[(wiki\/[^\]]+|raw\/[^\]]+)\]\]/g) || [];
    return matches.map(m => m.slice(2, -2));
}

function titleSimilarity(a: string, b: string): number {
    const bigrams = (s: string): Set<string> => {
        const set = new Set<string>();
        const lower = s.toLowerCase();
        for (let i = 0; i < lower.length - 1; i++) {
            set.add(lower.slice(i, i + 2));
        }
        return set;
    };
    const ba = bigrams(a);
    const bb = bigrams(b);
    let intersection = 0;
    for (const bg of ba) { if (bb.has(bg)) { intersection++; } }
    const union = ba.size + bb.size - intersection;
    return union === 0 ? 0 : intersection / union;
}

// ─── KnowledgeBaseService ────────────────────────────────────

export class KnowledgeBaseService {
    constructor(private readonly repo: IssueRepository) {}

    /** 获取所有标题以指定前缀开头的 issue */
    private async getIssuesByTitlePrefix(prefix: string): Promise<IssueMarkdownCore[]> {
        const all = await this.repo.getAll();
        return all.filter(i => i.title.startsWith(prefix));
    }

    /**
     * 导入素材到 raw/ 树。
     * - mode='url': 抓取网页并 stripHtml
     * - mode='text': 直接存储
     * - mode='file': 调用 opts.fileReader(source);未提供 fileReader 则抛错
     *
     * 安全提示:对于 mode='file',调用方负责传入合规的 fileReader(例如限制路径白名单)。
     */
    async ingest(opts: IngestOptions): Promise<IngestResult> {
        const { mode, source, category, title } = opts;
        if (!mode || !source || !title) {
            throw new Error("mode、source、title 都是必需的");
        }

        let body: string;
        let sourceLabel: string;

        switch (mode) {
            case "url": {
                if (!/^https?:\/\//i.test(source)) {
                    throw new Error("URL 必须以 http:// 或 https:// 开头");
                }
                const html = await httpGet(source);
                body = stripHtml(html);
                if (body.length > 30000) {
                    body = body.slice(0, 30000) + "\n\n...[内容已截断]";
                }
                sourceLabel = source;
                break;
            }
            case "text": {
                body = source;
                sourceLabel = "直接输入";
                break;
            }
            case "file": {
                if (!opts.fileReader) {
                    throw new Error("mode=file 需要调用方传入 fileReader 回调");
                }
                body = await opts.fileReader(source);
                sourceLabel = source;
                break;
            }
            default:
                throw new Error(`未知模式: ${mode}`);
        }

        const issueTitle = `raw/${(category || "uncategorized").trim()}/${title}`;
        const fullBody = `> 来源: ${sourceLabel}\n> 导入时间: ${new Date().toISOString()}\n\n${body}`;
        const { fileName } = await this.repo.create({
            frontmatter: { issue_title: issueTitle },
            body: fullBody,
        });
        return { fileName, sourceLabel, contentLength: body.length };
    }

    /**
     * 触发知识编译,返回 raw/ 素材清单及编译状态。
     * 当传入 targetFile 时,返回针对该文件的详细编译指示数据。
     */
    async compile(targetFile?: string): Promise<CompileReport> {
        const rawIssues = await this.getIssuesByTitlePrefix("raw/");
        const wikiIssues = await this.getIssuesByTitlePrefix("wiki/");
        const wikiTitles = wikiIssues.map(w => w.title);

        // 检查每个 raw 是否被 wiki 引用过
        const referencedRaw = new Set<string>();
        for (const wiki of wikiIssues) {
            try {
                const content = await this.repo.getRaw(wiki.fileName);
                const links = extractWikiLinks(content);
                for (const link of links) {
                    if (link.startsWith("raw/")) { referencedRaw.add(link); }
                }
            } catch { /* skip */ }
        }

        const rawList = rawIssues.map(r => ({
            title: r.title,
            fileName: r.fileName,
            compiled: referencedRaw.has(r.title),
        }));
        const uncompiledCount = rawList.filter(r => !r.compiled).length;

        if (targetFile) {
            const target = rawIssues.find(i => i.fileName === targetFile);
            if (!target) {
                return { targetFile, rawIssues: rawList, wikiTitles, uncompiledCount };
            }
            const raw = await this.repo.getRaw(target.fileName);
            const { body } = extractFrontmatterAndBody(raw);
            return {
                targetFile,
                target: { title: target.title, fileName: target.fileName, body },
                rawIssues: rawList,
                wikiTitles,
                uncompiledCount,
            };
        }

        return { rawIssues: rawList, wikiTitles, uncompiledCount };
    }

    /** 扫描 wiki/ 中的链接,返回断裂、孤立、缺失反链报告。 */
    async linkScan(): Promise<LinkScanReport> {
        const wikiIssues = await this.getIssuesByTitlePrefix("wiki/");
        if (wikiIssues.length === 0) {
            return { totalArticles: 0, brokenLinks: [], orphans: [], missingBacklinks: [] };
        }

        const articleLinks = new Map<string, string[]>();
        const allTitles = new Set(wikiIssues.map(w => w.title));

        for (const wiki of wikiIssues) {
            try {
                const content = await this.repo.getRaw(wiki.fileName);
                const links = extractWikiLinks(content).filter(l => l.startsWith("wiki/"));
                articleLinks.set(wiki.title, links);
            } catch {
                articleLinks.set(wiki.title, []);
            }
        }

        const brokenLinks: Array<{ from: string; to: string }> = [];
        const incomingCount = new Map<string, number>();
        const missingBacklinks: Array<{ from: string; to: string }> = [];
        for (const t of allTitles) { incomingCount.set(t, 0); }

        for (const [from, links] of articleLinks) {
            for (const to of links) {
                if (!allTitles.has(to)) {
                    brokenLinks.push({ from, to });
                } else {
                    incomingCount.set(to, (incomingCount.get(to) || 0) + 1);
                    const reverseLinks = articleLinks.get(to) || [];
                    if (!reverseLinks.includes(from)) {
                        missingBacklinks.push({ from, to });
                    }
                }
            }
        }

        const orphans = [...incomingCount.entries()]
            .filter(([, count]) => count === 0)
            .map(([title]) => title)
            .filter(t => !t.includes("index/"));

        return {
            totalArticles: wikiIssues.length,
            brokenLinks,
            orphans,
            missingBacklinks,
        };
    }

    /** 健康检查:桩文章、过时文章、潜在重复、覆盖率。 */
    async healthCheck(): Promise<HealthReport> {
        const rawIssues = await this.getIssuesByTitlePrefix("raw/");
        const wikiIssues = await this.getIssuesByTitlePrefix("wiki/");

        const stubs: string[] = [];
        for (const wiki of wikiIssues) {
            try {
                const content = await this.repo.getRaw(wiki.fileName);
                const { body } = extractFrontmatterAndBody(content);
                if (body.length < 200) {
                    stubs.push(wiki.title);
                }
            } catch { /* skip */ }
        }

        const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
        const stale = wikiIssues
            .filter(w => w.mtime < thirtyDaysAgo)
            .map(w => ({
                title: w.title,
                ageDays: Math.floor((Date.now() - w.mtime) / (24 * 60 * 60 * 1000)),
            }));

        const duplicates: Array<{ a: string; b: string; sim: number }> = [];
        const wikiTitles = wikiIssues.map(w => w.title);
        for (let i = 0; i < wikiTitles.length; i++) {
            for (let j = i + 1; j < wikiTitles.length; j++) {
                const nameA = wikiTitles[i].split("/").pop() || "";
                const nameB = wikiTitles[j].split("/").pop() || "";
                const sim = titleSimilarity(nameA, nameB);
                if (sim > 0.6) {
                    duplicates.push({ a: wikiTitles[i], b: wikiTitles[j], sim });
                }
            }
        }
        duplicates.sort((a, b) => b.sim - a.sim);

        return {
            rawCount: rawIssues.length,
            wikiCount: wikiIssues.length,
            coverage: rawIssues.length > 0
                ? Math.round((wikiIssues.length / rawIssues.length) * 100)
                : null,
            stubs,
            stale,
            duplicates,
        };
    }

    /** wiki/ 关键词搜索。 */
    async query(query: string, opts: { category?: string; limit?: number } = {}): Promise<{
        hits: KbQueryHit[];
        totalMatched: number;
        category?: string;
    }> {
        const limit = Math.min(opts.limit ?? 10, 30);
        let wikiIssues = await this.getIssuesByTitlePrefix("wiki/");
        if (opts.category) {
            wikiIssues = wikiIssues.filter(w => w.title.startsWith(`wiki/${opts.category}/`));
        }
        if (wikiIssues.length === 0) {
            return { hits: [], totalMatched: 0, category: opts.category };
        }

        const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
        const results: KbQueryHit[] = [];

        for (const wiki of wikiIssues) {
            try {
                const content = await this.repo.getRaw(wiki.fileName);
                const { body } = extractFrontmatterAndBody(content);
                const searchText = `${wiki.title} ${body}`.toLowerCase();
                if (!keywords.every(kw => searchText.includes(kw))) { continue; }

                let score = 0;
                const titleLower = wiki.title.toLowerCase();
                for (const kw of keywords) {
                    if (titleLower.includes(kw)) { score += 10; }
                    let pos = 0;
                    let count = 0;
                    while ((pos = searchText.indexOf(kw, pos)) !== -1) { count++; pos += kw.length; }
                    score += Math.min(count, 5);
                }

                const firstKw = keywords[0];
                const idx = body.toLowerCase().indexOf(firstKw);
                let snippet: string;
                if (idx >= 0) {
                    const start = Math.max(0, idx - 60);
                    const end = Math.min(body.length, idx + firstKw.length + 100);
                    snippet = (start > 0 ? "..." : "")
                        + body.slice(start, end).replace(/\n/g, " ").trim()
                        + (end < body.length ? "..." : "");
                } else {
                    snippet = body.slice(0, 150).replace(/\n/g, " ").trim()
                        + (body.length > 150 ? "..." : "");
                }

                results.push({ title: wiki.title, fileName: wiki.fileName, score, snippet });
            } catch { /* skip */ }
        }

        results.sort((a, b) => b.score - a.score);
        return {
            hits: results.slice(0, limit),
            totalMatched: results.length,
            category: opts.category,
        };
    }
}
