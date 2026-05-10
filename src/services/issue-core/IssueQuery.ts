import type { IssueRepository } from "./IssueRepository";
import type { IssueMarkdownCore } from "./types";
import {
    countOccurrences,
    extractSnippet,
    isSystemTypedFrontmatter,
    TYPE_FILTER_MAP,
} from "./searchUtils";

export interface SearchHit {
    issue: IssueMarkdownCore;
    score: number;
    snippet?: string;
}

export interface SearchResult {
    matches: SearchHit[];
    totalCandidates: number;
    /** 实际使用的类型过滤器(透传调用方),便于上层渲染 */
    typeFilter?: string;
}

export interface LibraryStats {
    totalFiles: number;
    /**
     * 各类型计数。键名为 TYPE_FILTER_MAP 的键(`role`、`conversation` 等)
     * 加上 `note`(用户笔记 = 总数 - 系统类型总和)。
     */
    typeCounts: Record<string, number>;
    /** 最近修改的用户笔记列表(已按 mtime 降序) */
    recentUserNotes: IssueMarkdownCore[];
}

export type SearchScope = "all" | "title" | "body";

/**
 * Issue 查询服务:搜索、按类型列出、统计。
 *
 * 与扩展端工具的核心区别:**返回结构化数据,不返回 markdown 文本**。
 * 上层 wrapper(扩展端工具 / MCP server)负责把结果渲染为各自约定的格式。
 */
export class IssueQuery {
    constructor(private readonly repo: IssueRepository) {}

    /**
     * 按 frontmatter 系统类型列出笔记,按 mtime 降序。
     * 类型说明:
     *   - `note`: 用户笔记(不带任何系统类型标记)
     *   - `role`/`conversation`/`log`/`tool_call`/`group`/`memory`/`chrome_chat`: 系统类型(对应 TYPE_FILTER_MAP)
     */
    async listByType(typeFilter: string, limit: number): Promise<{
        items: IssueMarkdownCore[];
        totalCandidates: number;
    }> {
        const all = await this.repo.getAll({ sortBy: "mtime" });
        let candidates: IssueMarkdownCore[];
        if (typeFilter === "note") {
            candidates = all.filter(i => !isSystemTypedFrontmatter(i.frontmatter));
        } else if (typeFilter === "board") {
            candidates = all.filter(i => i.frontmatter?.board_type === "survey");
        } else if (TYPE_FILTER_MAP[typeFilter]) {
            const typeKey = TYPE_FILTER_MAP[typeFilter];
            candidates = all.filter(i => i.frontmatter && i.frontmatter[typeKey] === true);
        } else {
            return { items: [], totalCandidates: 0 };
        }
        return {
            items: candidates.slice(0, limit),
            totalCandidates: candidates.length,
        };
    }

    /**
     * 多关键词加权搜索。算法与扩展端 `runKeywordSearch` 一致。
     * - 标题命中权重 10,frontmatter 命中权重 5,正文命中权重 1
     * - 每个关键词都必须命中(全部匹配),否则该笔记不计分
     */
    async searchByKeyword(
        query: string,
        opts: { limit?: number; type?: string; scope?: SearchScope } = {},
    ): Promise<SearchResult> {
        const limit = opts.limit ?? 20;
        const scope = opts.scope ?? "all";
        const typeFilter = opts.type;

        // 候选集
        const all = await this.repo.getAll({ sortBy: "mtime" });
        let candidates: IssueMarkdownCore[];
        if (typeFilter === "note") {
            candidates = all.filter(i => !isSystemTypedFrontmatter(i.frontmatter));
        } else if (typeFilter === "board") {
            candidates = all.filter(i => i.frontmatter?.board_type === "survey");
        } else if (typeFilter && TYPE_FILTER_MAP[typeFilter]) {
            const typeKey = TYPE_FILTER_MAP[typeFilter];
            candidates = all.filter(i => i.frontmatter && i.frontmatter[typeKey] === true);
        } else {
            candidates = all;
        }

        const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
        if (keywords.length === 0) {
            return { matches: [], totalCandidates: candidates.length, typeFilter };
        }

        const hits: SearchHit[] = [];

        for (const issue of candidates) {
            const titleLower = issue.title.toLowerCase();
            const fmStr = issue.frontmatter ? JSON.stringify(issue.frontmatter).toLowerCase() : "";

            let score = 0;
            let allMatched = true;
            let snippet: string | undefined;
            let needBody = false;

            for (const kw of keywords) {
                const titleCount = countOccurrences(titleLower, kw);
                const fmCount = countOccurrences(fmStr, kw);

                if (titleCount > 0) {
                    score += 10 + Math.min(titleCount - 1, 3) * 2;
                } else if (fmCount > 0) {
                    score += 5 + Math.min(fmCount - 1, 3);
                } else if (scope !== "title") {
                    needBody = true;
                    break;
                } else {
                    allMatched = false;
                    break;
                }
            }

            if (allMatched && score > 0 && !needBody) {
                hits.push({ issue, score });
                continue;
            }

            if (needBody && scope !== "title") {
                try {
                    const body = await this.repo.getContent(issue.fileName);
                    const bodyLower = body.toLowerCase();
                    let bodyScore = 0;
                    let bodyAllMatched = true;

                    for (const kw of keywords) {
                        const titleCount = countOccurrences(titleLower, kw);
                        const fmCount = countOccurrences(fmStr, kw);
                        const bodyCount = countOccurrences(bodyLower, kw);

                        if (titleCount > 0) { bodyScore += 10 + Math.min(titleCount - 1, 3) * 2; }
                        else if (fmCount > 0) { bodyScore += 5 + Math.min(fmCount - 1, 3); }
                        else if (bodyCount > 0) {
                            bodyScore += 1 + Math.min(bodyCount - 1, 3);
                            if (!snippet) { snippet = extractSnippet(body, kw) ?? undefined; }
                        } else { bodyAllMatched = false; break; }
                    }

                    if (bodyAllMatched && bodyScore > 0) {
                        hits.push({ issue, score: bodyScore, snippet });
                    }
                } catch {
                    // 读取失败跳过
                }
            }
        }

        hits.sort((a, b) => b.score - a.score || b.issue.mtime - a.issue.mtime);
        return {
            matches: hits.slice(0, limit),
            totalCandidates: candidates.length,
            typeFilter,
        };
    }

    /**
     * 笔记库统计概览。返回结构化数据,上层负责渲染。
     */
    async getStats(opts: { recentLimit?: number } = {}): Promise<LibraryStats> {
        const recentLimit = Math.min(opts.recentLimit ?? 15, 50);
        const all = await this.repo.getAll({ sortBy: "mtime" });

        const typeCounts: Record<string, number> = {};
        let systemTotal = 0;
        for (const [label, typeKey] of Object.entries(TYPE_FILTER_MAP)) {
            const count = all.filter(i => i.frontmatter && i.frontmatter[typeKey] === true).length;
            typeCounts[label] = count;
            systemTotal += count;
        }
        const boardCount = all.filter(i => i.frontmatter?.board_type === "survey").length;
        typeCounts["board"] = boardCount;
        typeCounts["note"] = all.length - systemTotal - boardCount;

        const userNotes = all.filter(i => !isSystemTypedFrontmatter(i.frontmatter));
        const recentUserNotes = userNotes.slice(0, recentLimit);

        return {
            totalFiles: all.length,
            typeCounts,
            recentUserNotes,
        };
    }
}
