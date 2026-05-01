import * as path from "node:path";
import * as fs from "node:fs/promises";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { IssueToolContext, IssueToolHandler } from "./issueTools";
import { issueLink } from "./render";

// ─── Schemas ──────────────────────────────────────────────────

export const KB_TOOLS: Tool[] = [
    {
        name: "kb_ingest",
        description: "将外部内容导入到知识库的 raw/ 原始素材树中。支持三种模式:url(抓取网页)、text(直接文本)、file(读取本地文件)。注意:file 模式仅允许读取 issueDir 内的文件。",
        inputSchema: {
            type: "object",
            properties: {
                mode: { type: "string", enum: ["url", "text", "file"], description: "导入模式" },
                source: { type: "string", description: "URL 地址、文本内容或本地文件绝对路径" },
                category: { type: "string", description: "分类(如 articles, papers, notes, repos)" },
                title: { type: "string", description: "素材标题" },
            },
            required: ["mode", "source", "category", "title"],
        },
    },
    {
        name: "kb_compile",
        description: "触发知识编译:扫描 raw/ 中的素材,提取概念并编译到 wiki/ 中。可指定 targetFile 进行定向编译,或留空返回所有未编译素材清单。",
        inputSchema: {
            type: "object",
            properties: {
                targetFile: { type: "string", description: "可选:指定编译的 raw 素材文件名" },
            },
        },
    },
    {
        name: "kb_link_scan",
        description: "扫描 wiki/ 文章中的交叉引用链接,检查完整性。",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "kb_health_check",
        description: "对知识库进行健康检查,返回桩文章、过时文章、潜在重复、覆盖率等问题。",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "kb_query",
        description: "在 wiki/ 知识库中搜索文章。支持关键词匹配标题和正文。",
        inputSchema: {
            type: "object",
            properties: {
                query: { type: "string", description: "搜索关键词(空格分隔,全部匹配)" },
                category: { type: "string", description: "可选:限定分类" },
                limit: { type: "number", description: "最大返回条数,默认 10" },
            },
            required: ["query"],
        },
    },
];

// ─── Handlers ─────────────────────────────────────────────────

const handlers: Record<string, IssueToolHandler> = {
    async kb_ingest(args, ctx: IssueToolContext) {
        const mode = String(args.mode ?? "").trim() as "url" | "text" | "file";
        const source = String(args.source ?? "").trim();
        const category = String(args.category ?? "uncategorized").trim();
        const title = String(args.title ?? "").trim();

        if (!mode || !source || !title) {
            return "必须提供 mode、source 和 title";
        }

        // 安全策略:file 模式仅允许 issueDir 内的路径(决策 #3)
        const fileReader = mode === "file"
            ? async (absPath: string): Promise<string> => {
                const resolved = path.resolve(absPath);
                const dirResolved = path.resolve(ctx.issueDir);
                if (!resolved.startsWith(dirResolved + path.sep) && resolved !== dirResolved) {
                    throw new Error(`安全限制: file 模式仅允许读取 issueDir 内的文件 (${ctx.issueDir})。提供的路径 ${absPath} 不在范围内。`);
                }
                return fs.readFile(resolved, "utf-8");
            }
            : undefined;

        try {
            const r = await ctx.services.kb.ingest({ mode, source, category, title, fileReader });
            return `已导入素材到 raw/ 树:\n- 标题: raw/${category}/${title}\n- 文件: ${r.fileName}\n- 来源: ${r.sourceLabel}\n- 内容长度: ${r.contentLength} 字符\n\n编译员将在下次 timer 触发时自动编译此素材。`;
        } catch (err) {
            return `导入失败: ${err instanceof Error ? err.message : String(err)}`;
        }
    },

    async kb_compile(args, ctx) {
        const targetFile = args.targetFile ? String(args.targetFile).trim() : undefined;
        const r = await ctx.services.kb.compile(targetFile);

        if (targetFile && r.target) {
            const wikiIndex = r.wikiTitles.length > 0
                ? r.wikiTitles.map(t => `  - ${t}`).join("\n")
                : "  (暂无)";
            return [
                `## 编译目标`,
                `- 标题: ${r.target.title}`,
                `- 文件: ${r.target.fileName}`,
                "",
                `## 素材内容`,
                r.target.body.slice(0, 15000),
                r.target.body.length > 15000 ? "\n...[内容已截断]" : "",
                "",
                `## 现有 wiki 文章索引(${r.wikiTitles.length} 篇)`,
                wikiIndex,
                "",
                "## 编译指示",
                "请根据素材内容:",
                "1. 提取核心概念,用 create_issue 或 update_issue 写入 wiki/",
                "2. 维护 [[wiki/...]] 交叉链接",
                `3. 在 wiki 文章的"来源"中引用 [[${r.target.title}]]`,
            ].join("\n");
        }

        if (targetFile) {
            return `未找到 raw 素材: ${targetFile}`;
        }

        if (r.rawIssues.length === 0) {
            return "raw/ 树中没有素材,无需编译。";
        }

        const lines: string[] = [`## raw/ 素材清单(共 ${r.rawIssues.length} 条)`, ""];
        for (const item of r.rawIssues) {
            const status = item.compiled ? "✓ 已编译" : "✗ 未编译";
            lines.push(`- [${status}] ${item.title} (${item.fileName})`);
        }
        lines.push("", "## 概览");
        lines.push(`- wiki/ 文章数: ${r.wikiTitles.length}`);
        lines.push(`- raw/ 素材数: ${r.rawIssues.length}`);
        lines.push(`- 未编译素材: ${r.uncompiledCount}`);
        if (r.uncompiledCount > 0) {
            lines.push("", "## 建议");
            lines.push("对未编译的素材逐一调用 kb_compile(targetFile=文件名) 进行定向编译。");
        }
        return lines.join("\n");
    },

    async kb_link_scan(_args, ctx) {
        const r = await ctx.services.kb.linkScan();
        if (r.totalArticles === 0) {
            return "wiki/ 中没有文章,无需扫描链接。";
        }

        const lines: string[] = [`## 链接扫描报告(wiki/ ${r.totalArticles} 篇文章)`, ""];

        if (r.brokenLinks.length > 0) {
            lines.push(`### 断裂链接(${r.brokenLinks.length} 个)`);
            for (const { from, to } of r.brokenLinks.slice(0, 20)) {
                lines.push(`- ${from} → [[${to}]](目标不存在)`);
            }
            lines.push("");
        }
        if (r.orphans.length > 0) {
            lines.push(`### 孤立文章(${r.orphans.length} 篇,无入链)`);
            for (const t of r.orphans.slice(0, 20)) { lines.push(`- ${t}`); }
            lines.push("");
        }
        if (r.missingBacklinks.length > 0) {
            lines.push(`### 缺失反向链接(${r.missingBacklinks.length} 对)`);
            for (const { from, to } of r.missingBacklinks.slice(0, 20)) {
                lines.push(`- ${from} → ${to}(${to} 未回链 ${from})`);
            }
            lines.push("");
        }
        if (r.brokenLinks.length === 0 && r.orphans.length === 0 && r.missingBacklinks.length === 0) {
            lines.push("所有链接健康,无问题。");
        }
        return lines.join("\n");
    },

    async kb_health_check(_args, ctx) {
        const r = await ctx.services.kb.healthCheck();
        const lines: string[] = ["## 知识库健康检查", ""];
        const problems: string[] = [];

        if (r.stubs.length > 0) {
            problems.push(`### 桩文章(正文 < 200 字,共 ${r.stubs.length} 篇)`);
            for (const t of r.stubs.slice(0, 15)) { problems.push(`- ${t}`); }
            problems.push("");
        }
        if (r.stale.length > 0) {
            problems.push(`### 过时文章(30天+ 未更新,共 ${r.stale.length} 篇)`);
            for (const s of r.stale.slice(0, 15)) {
                problems.push(`- ${s.title}(${s.ageDays} 天前)`);
            }
            problems.push("");
        }
        if (r.duplicates.length > 0) {
            problems.push(`### 潜在重复(${r.duplicates.length} 对)`);
            for (const d of r.duplicates.slice(0, 10)) {
                problems.push(`- ${d.a} ↔ ${d.b}(相似度 ${(d.sim * 100).toFixed(0)}%)`);
            }
            problems.push("");
        }

        lines.push("### 覆盖率");
        lines.push(`- raw/ 素材: ${r.rawCount} 条`);
        lines.push(`- wiki/ 文章: ${r.wikiCount} 篇`);
        if (r.coverage !== null) {
            lines.push(`- 编译比: ${r.coverage}%(wiki 文章数 / raw 素材数)`);
        }
        lines.push("");

        if (problems.length > 0) {
            lines.push(...problems);
        } else {
            lines.push("知识库状态良好,无问题。");
        }
        return lines.join("\n");
    },

    async kb_query(args, ctx) {
        const query = String(args.query ?? "").trim();
        const category = args.category ? String(args.category).trim() : undefined;
        const limit = typeof args.limit === "number" ? Math.min(args.limit, 30) : 10;
        if (!query) { return "请提供搜索关键词"; }

        const r = await ctx.services.kb.query(query, { category, limit });
        if (r.totalMatched === 0) {
            return r.category
                ? `wiki/${r.category}/ 中没有匹配 "${query}" 的文章。`
                : `未找到匹配 "${query}" 的 wiki 文章。`;
        }

        const lines: string[] = [
            `## 搜索结果("${query}",共 ${r.totalMatched} 条,显示前 ${r.hits.length} 条)`,
            "",
        ];
        for (const hit of r.hits) {
            lines.push(`### ${hit.title}`);
            lines.push(`文件: ${issueLink(hit.fileName, hit.fileName)}`);
            lines.push(`> ${hit.snippet}`);
            lines.push("");
        }
        return lines.join("\n");
    },
};

// 编译期一致性检查
type ToolName = typeof KB_TOOLS[number]["name"];
const _check: Record<ToolName, IssueToolHandler> = handlers;
void _check;

export const KB_TOOL_HANDLERS = handlers;
