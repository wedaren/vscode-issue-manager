/**
 * 知识库工具：kb_ingest, kb_compile, kb_link_scan, kb_health_check, kb_query
 *
 * 两层知识体系：
 *   - raw/  原始素材（用户/导入工具写入，编译员只读）
 *   - wiki/ LLM 编译的结构化知识百科（编译员维护，所有角色可查）
 *
 * 实现已迁移到 src/services/issue-core/KnowledgeBase.ts;本文件仅保留 schema 与
 * 扩展端的 markdown 渲染包装,通过 getIssueCoreServices() 调用 service。
 */
import * as vscode from 'vscode';
import type { ToolCallResult, ToolExecContext } from './types';
import { getIssueCoreServices } from '../../services/issue-core/extensionInstance';

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

// ─── 工具实现(渲染层,算法走 service) ──────────────────────────

async function executeKbIngest(input: Record<string, unknown>): Promise<ToolCallResult> {
    const services = getIssueCoreServices();
    if (!services) { return { success: false, content: '笔记目录未配置' }; }

    const mode = String(input.mode || '').trim() as 'url' | 'text' | 'file';
    const source = String(input.source || '').trim();
    const category = String(input.category || 'uncategorized').trim();
    const title = String(input.title || '').trim();

    if (!mode || !source || !title) {
        return { success: false, content: '必须提供 mode、source 和 title' };
    }
    if (!['url', 'text', 'file'].includes(mode)) {
        return { success: false, content: `未知模式: ${mode}，支持 url/text/file` };
    }

    // 扩展端 file 模式信任所有路径(用户已经在自己机器上,无 MCP 远程调用风险)
    const fileReader = mode === 'file'
        ? async (absPath: string): Promise<string> => {
            const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(absPath));
            return Buffer.from(bytes).toString('utf-8');
        }
        : undefined;

    try {
        const r = await services.kb.ingest({ mode, source, category, title, fileReader });
        vscode.commands.executeCommand('issueManager.refreshViews');
        return {
            success: true,
            content: `已导入素材到 raw/ 树：\n- 标题: raw/${category}/${title}\n- 文件: ${r.fileName}\n- 来源: ${r.sourceLabel}\n- 内容长度: ${r.contentLength} 字符\n\n编译员将在下次 timer 触发时自动编译此素材。`,
        };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { success: false, content: `导入失败: ${msg}` };
    }
}

async function executeKbCompile(input: Record<string, unknown>): Promise<ToolCallResult> {
    const services = getIssueCoreServices();
    if (!services) { return { success: false, content: '笔记目录未配置' }; }

    const targetFile = input.targetFile ? String(input.targetFile).trim() : undefined;
    const r = await services.kb.compile(targetFile);

    if (targetFile) {
        if (!r.target) {
            return { success: false, content: `未找到 raw 素材: ${targetFile}` };
        }
        const wikiIndex = r.wikiTitles.length > 0
            ? r.wikiTitles.map(t => `  - ${t}`).join('\n')
            : '  （暂无）';
        return {
            success: true,
            content: [
                `## 编译目标`,
                `- 标题: ${r.target.title}`,
                `- 文件: ${r.target.fileName}`,
                '',
                `## 素材内容`,
                r.target.body.slice(0, 15000),
                r.target.body.length > 15000 ? '\n...[内容已截断]' : '',
                '',
                `## 现有 wiki 文章索引（${r.wikiTitles.length} 篇）`,
                wikiIndex,
                '',
                '## 编译指示',
                '请根据素材内容：',
                '1. 提取核心概念，用 create_issue 或 update_issue 写入 wiki/',
                '2. 维护 [[wiki/...]] 交叉链接',
                '3. 在 wiki 文章的"来源"中引用 [[' + r.target.title + ']]',
            ].join('\n'),
        };
    }

    if (r.rawIssues.length === 0) {
        return { success: true, content: 'raw/ 树中没有素材，无需编译。' };
    }

    const lines: string[] = [`## raw/ 素材清单（共 ${r.rawIssues.length} 条）`, ''];
    for (const raw of r.rawIssues) {
        const status = raw.compiled ? '✓ 已编译' : '✗ 未编译';
        lines.push(`- [${status}] ${raw.title} (${raw.fileName})`);
    }
    lines.push('', `## 概览`);
    lines.push(`- wiki/ 文章数: ${r.wikiTitles.length}`);
    lines.push(`- raw/ 素材数: ${r.rawIssues.length}`);
    lines.push(`- 未编译素材: ${r.uncompiledCount}`);
    if (r.uncompiledCount > 0) {
        lines.push('', '## 建议');
        lines.push('对未编译的素材逐一调用 kb_compile(targetFile=文件名) 进行定向编译。');
    }
    return { success: true, content: lines.join('\n') };
}

async function executeKbLinkScan(): Promise<ToolCallResult> {
    const services = getIssueCoreServices();
    if (!services) { return { success: false, content: '笔记目录未配置' }; }

    const r = await services.kb.linkScan();
    if (r.totalArticles === 0) {
        return { success: true, content: 'wiki/ 中没有文章，无需扫描链接。' };
    }

    const lines: string[] = [`## 链接扫描报告（wiki/ ${r.totalArticles} 篇文章）`, ''];

    if (r.brokenLinks.length > 0) {
        lines.push(`### 断裂链接（${r.brokenLinks.length} 个）`);
        for (const { from, to } of r.brokenLinks.slice(0, 20)) {
            lines.push(`- ${from} → [[${to}]]（目标不存在）`);
        }
        lines.push('');
    }

    if (r.orphans.length > 0) {
        lines.push(`### 孤立文章（${r.orphans.length} 篇，无入链）`);
        for (const title of r.orphans.slice(0, 20)) {
            lines.push(`- ${title}`);
        }
        lines.push('');
    }

    if (r.missingBacklinks.length > 0) {
        lines.push(`### 缺失反向链接（${r.missingBacklinks.length} 对）`);
        for (const { from, to } of r.missingBacklinks.slice(0, 20)) {
            lines.push(`- ${from} → ${to}（${to} 未回链 ${from}）`);
        }
        lines.push('');
    }

    if (r.brokenLinks.length === 0 && r.orphans.length === 0 && r.missingBacklinks.length === 0) {
        lines.push('所有链接健康，无问题。');
    }

    return { success: true, content: lines.join('\n') };
}

async function executeKbHealthCheck(): Promise<ToolCallResult> {
    const services = getIssueCoreServices();
    if (!services) { return { success: false, content: '笔记目录未配置' }; }

    const r = await services.kb.healthCheck();
    const lines: string[] = [`## 知识库健康检查`, ''];
    const problems: string[] = [];

    if (r.stubs.length > 0) {
        problems.push(`### 桩文章（正文 < 200 字，共 ${r.stubs.length} 篇）`);
        for (const t of r.stubs.slice(0, 15)) { problems.push(`- ${t}`); }
        problems.push('');
    }
    if (r.stale.length > 0) {
        problems.push(`### 过时文章（30天+ 未更新，共 ${r.stale.length} 篇）`);
        for (const s of r.stale.slice(0, 15)) {
            problems.push(`- ${s.title}（${s.ageDays} 天前）`);
        }
        problems.push('');
    }
    if (r.duplicates.length > 0) {
        problems.push(`### 潜在重复（${r.duplicates.length} 对）`);
        for (const d of r.duplicates.slice(0, 10)) {
            problems.push(`- ${d.a} ↔ ${d.b}（相似度 ${(d.sim * 100).toFixed(0)}%）`);
        }
        problems.push('');
    }

    lines.push('### 覆盖率');
    lines.push(`- raw/ 素材: ${r.rawCount} 条`);
    lines.push(`- wiki/ 文章: ${r.wikiCount} 篇`);
    if (r.coverage !== null) {
        lines.push(`- 编译比: ${r.coverage}%（wiki 文章数 / raw 素材数）`);
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
    const services = getIssueCoreServices();
    if (!services) { return { success: false, content: '笔记目录未配置' }; }

    const query = String(input.query || '').trim();
    const category = input.category ? String(input.category).trim() : undefined;
    const limit = typeof input.limit === 'number' ? Math.min(input.limit, 30) : 10;
    if (!query) { return { success: false, content: '请提供搜索关键词' }; }

    const r = await services.kb.query(query, { category, limit });
    if (r.totalMatched === 0) {
        return {
            success: true,
            content: r.category
                ? `wiki/${r.category}/ 中没有匹配 "${query}" 的文章。`
                : `未找到匹配"${query}"的 wiki 文章。`,
        };
    }

    const lines = [
        `## 搜索结果（"${query}"，共 ${r.totalMatched} 条，显示前 ${r.hits.length} 条）`,
        '',
    ];
    for (const hit of r.hits) {
        lines.push(`### ${hit.title}`);
        lines.push(`文件: ${hit.fileName}`);
        lines.push(`> ${hit.snippet}`);
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
