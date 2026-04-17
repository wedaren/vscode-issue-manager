/**
 * 知识库工具：kb_ingest, kb_compile, kb_link_scan, kb_health_check, kb_query
 *
 * 两层知识体系：
 *   - raw/  原始素材（用户/导入工具写入，编译员只读）
 *   - wiki/ LLM 编译的结构化知识百科（编译员维护，所有角色可查）
 */
import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import * as path from 'path';
import { Logger } from '../../core/utils/Logger';
import { getIssueDir } from '../../config';
import {
    getAllIssueMarkdowns,
    getIssueMarkdown,
    createIssueMarkdown,
    extractFrontmatterAndBody,
} from '../../data/IssueMarkdowns';
import type { ToolCallResult, ToolExecContext } from './types';

const logger = Logger.getInstance();

// ─── 工具 schema ─────────────────────────────────────────────

export const KNOWLEDGE_BASE_TOOLS: vscode.LanguageModelChatTool[] = [
    {
        name: 'kb_ingest',
        description:
            '将外部内容导入到知识库的 raw/ 原始素材树中。' +
            '支持三种模式：url（抓取网页转 Markdown）、text（直接存储文本）、file（读取本地文件）。' +
            '导入后编译员会自动将其编译到 wiki/ 中。',
        inputSchema: {
            type: 'object',
            properties: {
                mode: {
                    type: 'string',
                    enum: ['url', 'text', 'file'],
                    description: '导入模式：url=抓取网页, text=直接文本, file=本地文件',
                },
                source: {
                    type: 'string',
                    description: '来源：URL 地址、文本内容、或本地文件路径',
                },
                category: {
                    type: 'string',
                    description: '分类（如 articles, papers, notes, repos）。将存为 raw/{category}/标题',
                },
                title: {
                    type: 'string',
                    description: '素材标题（必填）',
                },
            },
            required: ['mode', 'source', 'category', 'title'],
        },
    },
    {
        name: 'kb_compile',
        description:
            '触发知识编译：扫描 raw/ 中的素材，提取概念并编译到 wiki/ 中。' +
            '可指定特定 raw 素材文件名进行定向编译，或留空扫描所有未编译的素材。' +
            '返回 raw/ 素材列表及其编译状态，供 LLM 逐条处理。',
        inputSchema: {
            type: 'object',
            properties: {
                targetFile: {
                    type: 'string',
                    description: '可选：指定编译的 raw 素材文件名。留空则返回所有未编译素材的清单。',
                },
            },
        },
    },
    {
        name: 'kb_link_scan',
        description:
            '扫描 wiki/ 文章中的交叉引用链接，检查完整性。' +
            '找出：断裂链接（引用了不存在的文章）、孤立文章（没有被任何文章引用）、' +
            '缺失的反向链接（A 引用了 B 但 B 没有引用 A）。',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'kb_health_check',
        description:
            '对知识库进行健康检查，返回需要关注的问题列表。' +
            '检查项：桩文章（只有定义缺少详述）、过时文章（长时间未更新）、' +
            '潜在重复（标题相似的文章）、raw/ 与 wiki/ 的覆盖率。',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'kb_query',
        description:
            '在 wiki/ 知识库中搜索文章。支持关键词匹配标题和正文。' +
            '返回匹配的文章列表及其摘要，适合任何角色在对话中快速查询知识。',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: '搜索关键词（多个词用空格分隔，全部匹配）',
                },
                category: {
                    type: 'string',
                    description: '可选：限定分类（如 concepts, tools, people）',
                },
                limit: {
                    type: 'number',
                    description: '最大返回条数，默认 10',
                },
            },
            required: ['query'],
        },
    },
];

// ─── 辅助函数 ────────────────────────────────────────────────

/** 获取所有标题以指定前缀开头的 issue */
async function getIssuesByTitlePrefix(prefix: string) {
    const all = await getAllIssueMarkdowns({});
    return all.filter(issue => issue.title.startsWith(prefix));
}

/** 简单 HTTP GET（复用 browsingTools 的模式） */
function httpGet(url: string, timeoutMs = 15000): Promise<string> {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? https : http;
        const req = mod.get(url, { timeout: timeoutMs }, (res) => {
            if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308)
                && res.headers.location) {
                req.destroy();
                httpGet(res.headers.location, timeoutMs).then(resolve).catch(reject);
                return;
            }
            if (res.statusCode && res.statusCode >= 400) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
            res.on('error', reject);
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
        req.on('error', reject);
    });
}

/** 基本 HTML → 纯文本（轻量级，不依赖 cheerio） */
function stripHtml(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** 从 issue 正文中提取 [[wiki/...]] 和 [[raw/...]] 链接 */
function extractWikiLinks(body: string): string[] {
    const matches = body.match(/\[\[(wiki\/[^\]]+|raw\/[^\]]+)\]\]/g) || [];
    return matches.map(m => m.slice(2, -2));
}

/** 计算两个字符串的相似度（简单 bigram Jaccard） */
function titleSimilarity(a: string, b: string): number {
    const bigrams = (s: string) => {
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
    for (const b of ba) { if (bb.has(b)) { intersection++; } }
    const union = ba.size + bb.size - intersection;
    return union === 0 ? 0 : intersection / union;
}

// ─── 工具实现 ────────────────────────────────────────────────

async function executeKbIngest(input: Record<string, unknown>): Promise<ToolCallResult> {
    const mode = String(input.mode || '').trim();
    const source = String(input.source || '').trim();
    const category = String(input.category || 'uncategorized').trim();
    const title = String(input.title || '').trim();

    if (!mode || !source || !title) {
        return { success: false, content: '必须提供 mode、source 和 title' };
    }

    const issueDir = getIssueDir();
    if (!issueDir) {
        return { success: false, content: '笔记目录未配置' };
    }

    let body: string;
    let sourceLabel: string;

    switch (mode) {
        case 'url': {
            if (!/^https?:\/\//i.test(source)) {
                return { success: false, content: 'URL 必须以 http:// 或 https:// 开头' };
            }
            try {
                const html = await httpGet(source);
                body = stripHtml(html);
                if (body.length > 30000) {
                    body = body.slice(0, 30000) + '\n\n...[内容已截断]';
                }
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                return { success: false, content: `抓取失败: ${msg}` };
            }
            sourceLabel = source;
            break;
        }
        case 'text': {
            body = source;
            sourceLabel = '直接输入';
            break;
        }
        case 'file': {
            try {
                const fileUri = vscode.Uri.file(source);
                const content = Buffer.from(await vscode.workspace.fs.readFile(fileUri)).toString('utf8');
                body = content;
                sourceLabel = source;
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                return { success: false, content: `读取文件失败: ${msg}` };
            }
            break;
        }
        default:
            return { success: false, content: `未知模式: ${mode}，支持 url/text/file` };
    }

    // 创建 raw/ issue
    const issueTitle = `raw/${category}/${title}`;
    const fullBody = `> 来源: ${sourceLabel}\n> 导入时间: ${new Date().toISOString()}\n\n${body}`;

    try {
        const uri = await createIssueMarkdown({
            frontmatter: { issue_title: issueTitle },
            markdownBody: fullBody,
        });
        if (!uri) {
            return { success: false, content: '创建素材文件失败' };
        }
        const fileName = path.basename(uri.fsPath);
        return {
            success: true,
            content: `已导入素材到 raw/ 树：\n- 标题: ${issueTitle}\n- 文件: ${fileName}\n- 内容长度: ${body.length} 字符\n\n编译员将在下次 timer 触发时自动编译此素材。`,
        };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { success: false, content: `创建素材失败: ${msg}` };
    }
}

async function executeKbCompile(input: Record<string, unknown>): Promise<ToolCallResult> {
    const targetFile = input.targetFile ? String(input.targetFile).trim() : '';

    // 获取所有 raw/ 和 wiki/ 文章
    const rawIssues = await getIssuesByTitlePrefix('raw/');
    const wikiIssues = await getIssuesByTitlePrefix('wiki/');

    if (targetFile) {
        // 定向编译：读取指定 raw 素材的完整内容
        const target = rawIssues.find(i => path.basename(i.uri.fsPath) === targetFile);
        if (!target) {
            return { success: false, content: `未找到 raw 素材: ${targetFile}` };
        }
        const md = await getIssueMarkdown(target.uri);
        if (!md) {
            return { success: false, content: `无法读取素材内容: ${targetFile}` };
        }
        const { body } = extractFrontmatterAndBody(
            Buffer.from(await vscode.workspace.fs.readFile(target.uri)).toString('utf8'),
        );

        // 列出当前 wiki 文章索引，帮助 LLM 判断哪些概念已有文章
        const wikiIndex = wikiIssues.map(w => `  - ${w.title}`).join('\n');

        return {
            success: true,
            content: [
                `## 编译目标`,
                `- 标题: ${target.title}`,
                `- 文件: ${targetFile}`,
                '',
                `## 素材内容`,
                body.slice(0, 15000),
                body.length > 15000 ? '\n...[内容已截断]' : '',
                '',
                `## 现有 wiki 文章索引（${wikiIssues.length} 篇）`,
                wikiIndex || '  （暂无）',
                '',
                '## 编译指示',
                '请根据素材内容：',
                '1. 提取核心概念，用 create_issue 或 update_issue 写入 wiki/',
                '2. 维护 [[wiki/...]] 交叉链接',
                '3. 在 wiki 文章的"来源"中引用 [[' + target.title + ']]',
            ].join('\n'),
        };
    }

    // 全量扫描：返回 raw/ 素材清单及编译状态
    if (rawIssues.length === 0) {
        return { success: true, content: 'raw/ 树中没有素材，无需编译。' };
    }

    // 检查哪些 raw 素材已被 wiki 引用
    const referencedRaw = new Set<string>();
    for (const wiki of wikiIssues) {
        try {
            const content = Buffer.from(await vscode.workspace.fs.readFile(wiki.uri)).toString('utf8');
            const links = extractWikiLinks(content);
            for (const link of links) {
                if (link.startsWith('raw/')) { referencedRaw.add(link); }
            }
        } catch { /* skip */ }
    }

    const lines: string[] = [
        `## raw/ 素材清单（共 ${rawIssues.length} 条）`,
        '',
    ];

    let uncompiled = 0;
    for (const raw of rawIssues) {
        const fileName = path.basename(raw.uri.fsPath);
        const compiled = referencedRaw.has(raw.title);
        const status = compiled ? '✓ 已编译' : '✗ 未编译';
        if (!compiled) { uncompiled++; }
        lines.push(`- [${status}] ${raw.title} (${fileName})`);
    }

    lines.push('', `## 概览`);
    lines.push(`- wiki/ 文章数: ${wikiIssues.length}`);
    lines.push(`- raw/ 素材数: ${rawIssues.length}`);
    lines.push(`- 未编译素材: ${uncompiled}`);

    if (uncompiled > 0) {
        lines.push('', '## 建议');
        lines.push('对未编译的素材逐一调用 kb_compile(targetFile=文件名) 进行定向编译。');
    }

    return { success: true, content: lines.join('\n') };
}

async function executeKbLinkScan(): Promise<ToolCallResult> {
    const wikiIssues = await getIssuesByTitlePrefix('wiki/');

    if (wikiIssues.length === 0) {
        return { success: true, content: 'wiki/ 中没有文章，无需扫描链接。' };
    }

    // 收集所有文章及其链接
    const articleLinks = new Map<string, string[]>(); // title → outgoing links
    const allTitles = new Set(wikiIssues.map(w => w.title));

    for (const wiki of wikiIssues) {
        try {
            const content = Buffer.from(await vscode.workspace.fs.readFile(wiki.uri)).toString('utf8');
            const links = extractWikiLinks(content).filter(l => l.startsWith('wiki/'));
            articleLinks.set(wiki.title, links);
        } catch {
            articleLinks.set(wiki.title, []);
        }
    }

    // 分析
    const brokenLinks: Array<{ from: string; to: string }> = [];
    const incomingCount = new Map<string, number>();
    const missingBacklinks: Array<{ from: string; to: string }> = [];

    for (const title of allTitles) { incomingCount.set(title, 0); }

    for (const [from, links] of articleLinks) {
        for (const to of links) {
            if (!allTitles.has(to)) {
                brokenLinks.push({ from, to });
            } else {
                incomingCount.set(to, (incomingCount.get(to) || 0) + 1);
                // 检查反向链接
                const reverseLinks = articleLinks.get(to) || [];
                if (!reverseLinks.includes(from)) {
                    missingBacklinks.push({ from, to });
                }
            }
        }
    }

    const orphans = [...incomingCount.entries()]
        .filter(([_, count]) => count === 0)
        .map(([title]) => title)
        .filter(t => !t.includes('index/')); // index 类文章通常不被引用

    // 输出报告
    const lines: string[] = [`## 链接扫描报告（wiki/ ${wikiIssues.length} 篇文章）`, ''];

    if (brokenLinks.length > 0) {
        lines.push(`### 断裂链接（${brokenLinks.length} 个）`);
        for (const { from, to } of brokenLinks.slice(0, 20)) {
            lines.push(`- ${from} → [[${to}]]（目标不存在）`);
        }
        lines.push('');
    }

    if (orphans.length > 0) {
        lines.push(`### 孤立文章（${orphans.length} 篇，无入链）`);
        for (const title of orphans.slice(0, 20)) {
            lines.push(`- ${title}`);
        }
        lines.push('');
    }

    if (missingBacklinks.length > 0) {
        lines.push(`### 缺失反向链接（${missingBacklinks.length} 对）`);
        for (const { from, to } of missingBacklinks.slice(0, 20)) {
            lines.push(`- ${from} → ${to}（${to} 未回链 ${from}）`);
        }
        lines.push('');
    }

    if (brokenLinks.length === 0 && orphans.length === 0 && missingBacklinks.length === 0) {
        lines.push('所有链接健康，无问题。');
    }

    return { success: true, content: lines.join('\n') };
}

async function executeKbHealthCheck(): Promise<ToolCallResult> {
    const rawIssues = await getIssuesByTitlePrefix('raw/');
    const wikiIssues = await getIssuesByTitlePrefix('wiki/');

    const lines: string[] = [`## 知识库健康检查`, ''];
    const problems: string[] = [];

    // 1. 桩文章检测（正文过短）
    const stubs: string[] = [];
    for (const wiki of wikiIssues) {
        try {
            const content = Buffer.from(await vscode.workspace.fs.readFile(wiki.uri)).toString('utf8');
            const { body } = extractFrontmatterAndBody(content);
            if (body.length < 200) {
                stubs.push(wiki.title);
            }
        } catch { /* skip */ }
    }
    if (stubs.length > 0) {
        problems.push(`### 桩文章（正文 < 200 字，共 ${stubs.length} 篇）`);
        for (const t of stubs.slice(0, 15)) { problems.push(`- ${t}`); }
        problems.push('');
    }

    // 2. 过时文章（30天未更新）
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const stale = wikiIssues.filter(w => w.mtime < thirtyDaysAgo);
    if (stale.length > 0) {
        problems.push(`### 过时文章（30天+ 未更新，共 ${stale.length} 篇）`);
        for (const w of stale.slice(0, 15)) {
            const age = Math.floor((Date.now() - w.mtime) / (24 * 60 * 60 * 1000));
            problems.push(`- ${w.title}（${age} 天前）`);
        }
        problems.push('');
    }

    // 3. 潜在重复（标题相似度 > 0.6）
    const duplicates: Array<{ a: string; b: string; sim: number }> = [];
    const wikiTitles = wikiIssues.map(w => w.title);
    for (let i = 0; i < wikiTitles.length; i++) {
        for (let j = i + 1; j < wikiTitles.length; j++) {
            // 只比较最后一段（概念名）
            const nameA = wikiTitles[i].split('/').pop() || '';
            const nameB = wikiTitles[j].split('/').pop() || '';
            const sim = titleSimilarity(nameA, nameB);
            if (sim > 0.6) {
                duplicates.push({ a: wikiTitles[i], b: wikiTitles[j], sim });
            }
        }
    }
    if (duplicates.length > 0) {
        duplicates.sort((a, b) => b.sim - a.sim);
        problems.push(`### 潜在重复（${duplicates.length} 对）`);
        for (const d of duplicates.slice(0, 10)) {
            problems.push(`- ${d.a} ↔ ${d.b}（相似度 ${(d.sim * 100).toFixed(0)}%）`);
        }
        problems.push('');
    }

    // 4. 覆盖率
    lines.push('### 覆盖率');
    lines.push(`- raw/ 素材: ${rawIssues.length} 条`);
    lines.push(`- wiki/ 文章: ${wikiIssues.length} 篇`);
    if (rawIssues.length > 0) {
        const ratio = (wikiIssues.length / rawIssues.length * 100).toFixed(0);
        lines.push(`- 编译比: ${ratio}%（wiki 文章数 / raw 素材数）`);
    }
    lines.push('');

    if (problems.length > 0) {
        lines.push(...problems);
    } else {
        lines.push('知识库状态良好，无问题。');
    }

    return { success: true, content: lines.join('\n') };
}

async function executeKbQuery(input: Record<string, unknown>): Promise<ToolCallResult> {
    const query = String(input.query || '').trim();
    const category = input.category ? String(input.category).trim() : '';
    const limit = typeof input.limit === 'number' ? Math.min(input.limit, 30) : 10;

    if (!query) {
        return { success: false, content: '请提供搜索关键词' };
    }

    // 获取 wiki 文章
    let wikiIssues = await getIssuesByTitlePrefix('wiki/');

    // 按分类过滤
    if (category) {
        wikiIssues = wikiIssues.filter(w => w.title.startsWith(`wiki/${category}/`));
    }

    if (wikiIssues.length === 0) {
        return { success: true, content: category ? `wiki/${category}/ 中没有文章。` : 'wiki/ 中没有文章。' };
    }

    // 关键词匹配（空格分隔，全部匹配）
    const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);

    interface SearchResult {
        title: string;
        fileName: string;
        score: number;
        snippet: string;
    }

    const results: SearchResult[] = [];

    for (const wiki of wikiIssues) {
        try {
            const content = Buffer.from(await vscode.workspace.fs.readFile(wiki.uri)).toString('utf8');
            const { body } = extractFrontmatterAndBody(content);
            const searchText = `${wiki.title} ${body}`.toLowerCase();

            // 所有关键词都必须匹配
            const allMatch = keywords.every(kw => searchText.includes(kw));
            if (!allMatch) { continue; }

            // 计算分数（标题匹配权重更高）
            let score = 0;
            const titleLower = wiki.title.toLowerCase();
            for (const kw of keywords) {
                if (titleLower.includes(kw)) { score += 10; }
                // 正文中出现次数
                let pos = 0;
                let count = 0;
                while ((pos = searchText.indexOf(kw, pos)) !== -1) { count++; pos += kw.length; }
                score += Math.min(count, 5); // cap at 5 per keyword
            }

            // 提取匹配片段（第一个关键词周围的上下文）
            const firstKw = keywords[0];
            const idx = body.toLowerCase().indexOf(firstKw);
            let snippet: string;
            if (idx >= 0) {
                const start = Math.max(0, idx - 60);
                const end = Math.min(body.length, idx + firstKw.length + 100);
                snippet = (start > 0 ? '...' : '') + body.slice(start, end).replace(/\n/g, ' ').trim() + (end < body.length ? '...' : '');
            } else {
                snippet = body.slice(0, 150).replace(/\n/g, ' ').trim() + (body.length > 150 ? '...' : '');
            }

            results.push({
                title: wiki.title,
                fileName: path.basename(wiki.uri.fsPath),
                score,
                snippet,
            });
        } catch { /* skip */ }
    }

    if (results.length === 0) {
        return { success: true, content: `未找到匹配"${query}"的 wiki 文章。` };
    }

    // 按分数排序
    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, limit);

    const lines = [
        `## 搜索结果（"${query}"，共 ${results.length} 条，显示前 ${topResults.length} 条）`,
        '',
    ];
    for (const r of topResults) {
        lines.push(`### ${r.title}`);
        lines.push(`文件: ${r.fileName}`);
        lines.push(`> ${r.snippet}`);
        lines.push('');
    }

    return { success: true, content: lines.join('\n') };
}

// ─── 导出 ────────────────────────────────────────────────────

export const KNOWLEDGE_BASE_HANDLERS: Record<
    string,
    (input: Record<string, unknown>, ctx?: ToolExecContext) => Promise<ToolCallResult>
> = {
    kb_ingest: executeKbIngest,
    kb_compile: executeKbCompile,
    kb_link_scan: executeKbLinkScan,
    kb_health_check: executeKbHealthCheck,
    kb_query: executeKbQuery,
};
