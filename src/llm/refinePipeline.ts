/**
 * 简要描述：实现多轮 refine 的 LLM 生成流水线。
 * 原理：先生成大纲，再逐节扩展，最后进行一次整体润色/校验，返回最终 Markdown 正文。
 */
import * as vscode from 'vscode';
import { LLMService } from './LLMService';
import { applyGeneratedIssueContent } from './backgroundFill';
import { Logger } from '../core/utils/Logger';
import { getAllIssueMarkdowns, getIssueMarkdownContent } from '../data/IssueMarkdowns';
import { getIssueDir } from '../config';
import * as path from 'path';
import fs from 'fs/promises';

interface RefineOptions {
    timeoutMs?: number;
}

export async function backgroundFillIssueRefine(
    uri: vscode.Uri,
    title: string,
    selection: string,
    issueId?: string,
    options?: RefineOptions
): Promise<{ success: boolean; message?: string }> {
    const timeoutMs = options?.timeoutMs ?? 120000;
    const controller = new AbortController();
    const { signal } = controller;
    const { clear, controller: _c } = createAbortHelper(timeoutMs);

    try {
        const result = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: '生成 Wiki（多轮）…', cancellable: true },
            async (progress, token) => {
                token.onCancellationRequested(() => {
                    try { controller.abort(); } catch {}
                });

                progress.report({ message: '检索本地相关文档...' });
                const sources = await localSearchRelevant(title, selection, 5);

                progress.report({ message: '生成大纲...' });
                const outline = await generateOutline(title, selection, sources, { signal });
                if (!outline) {
                    return { success: false, message: '未生成大纲' };
                }

                progress.report({ message: '扩展各节内容...' });
                const sections = await expandSections(title, selection, outline, sources, { signal });

                progress.report({ message: '合并并润色...' });
                const draft = buildDocument(title, sections);

                progress.report({ message: '调用 LLM 进行整体润色与校验...' });
                const refined = await refineDraftWithTemplate(draft, selection, sources, { signal });

                // 在写回前附加参考资料列表（若存在检索到的本地文档）
                let finalContent = refined;
                if (sources && sources.length > 0) {
                    const refs: string[] = [];
                    for (const s of sources) {
                        // 使用 IssueDir 相对链接形式
                        const issueDir = getIssueDir();
                        let link = s.relPath;
                        if (issueDir) {
                            link = `IssueDir/${s.relPath.replace(/\\/g, '/')}`;
                        }
                        refs.push(`- [${s.title}](${link})`);
                    }
                    finalContent = finalContent + `\n\n---\n**参考资料**\n` + refs.join('\n') + '\n';
                }

                const applyResult = await applyGeneratedIssueContent(uri, finalContent, issueId);
                return applyResult;
            }
        );

        return result;
    } catch (error: any) {
        if (error?.message === '请求已取消' || error?.name === 'AbortError') {
            return { success: false, message: '请求已取消或超时' };
        }
        Logger.getInstance().error('backgroundFillIssueRefine error:', error);
        return { success: false, message: String(error) };
    } finally {
        clear();
    }
}

function createAbortHelper(timeoutMs: number) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    return { controller, clear: () => clearTimeout(id) };
}

async function generateOutline(title: string, selection: string, sources: Array<{ title: string; relPath: string; snippet: string }>, opts: { signal?: AbortSignal }): Promise<string[]> {
    const system = `你是文档结构化专家：返回一个清晰的大纲（只列出序号和章节标题）。不要输出任何额外解释。`;
        // 从模板加载用户提示（若存在）
        let userTpl = await loadPromptFile('generate-outline-prompt.md');
        const sourcesText = (sources || []).map(s => `- ${s.title} (来源: IssueDir/${s.relPath})\n片段:\n${s.snippet}`).join('\n\n');
        let user: string;
        if (userTpl) {
            user = interpolate(userTpl, { title, selection, sources: sourcesText });
        } else {
            user = `标题：${title}\n上下文：\n${selection}\n\n` + (sourcesText ? `参考文档：\n${sourcesText}\n\n` : '') + `\n请仅返回一个有序列号的大纲，例如：\n1. 背景\n2. 问题要点\n3. 解决方案\n`;
        }
        const resp = await LLMService.chat([
            vscode.LanguageModelChatMessage.User(system),
            vscode.LanguageModelChatMessage.User(user),
        ], { signal: opts.signal });
    if (!resp) return [];
    const text = resp.text;
    // 解析大纲行：采用简单的行解析
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const headings: string[] = [];
    for (const ln of lines) {
        // 匹配 '1. 标题' 或 '1) 标题' 或 '- 标题'
        const m = ln.match(/^(?:\d+\.|\d+\)|[-•])\s*(.+)$/);
        if (m) headings.push(m[1].trim());
        else if (ln.length <= 60 && ln.split(' ').length <= 6) headings.push(ln);
    }
    return headings;
}

async function expandSections(title: string, selection: string, outline: string[], sources: Array<{ title: string; relPath: string; snippet: string }>, opts: { signal?: AbortSignal }): Promise<Array<{ heading: string; body: string }>> {
    // 并行扩展每个小节内容
    const tasks = outline.map(async (heading) => {
        const system = `你是中文技术文档写手，针对给定章节标题输出该节的 Markdown 内容（不包含章节编号，只输出二级或三级标题与段落）。`;
            let userTpl = await loadPromptFile('expand-section-prompt.md');
            const sourcesText = (sources || []).map(s => `- ${s.title} (来源: IssueDir/${s.relPath})\n片段:\n${s.snippet}`).join('\n\n');
            let user: string;
            if (userTpl) {
                user = interpolate(userTpl, { title, heading, selection, sources: sourcesText });
            } else {
                user = `文档标题：${title}\n章节：${heading}\n上下文：\n${selection}\n\n` + (sourcesText ? `参考文档：\n${sourcesText}\n\n` : '') + `\n请生成该章节的 Markdown 内容，包含小结与要点，长度控制在合理范围（3-8 段）。`;
            }
        try {
            const resp = await LLMService.chat([
                vscode.LanguageModelChatMessage.User(system),
                vscode.LanguageModelChatMessage.User(user),
            ], { signal: opts.signal });
            const body = resp ? resp.text.trim() : '';
            return { heading, body };
        } catch (e) {
            return { heading, body: '' };
        }
    });

    const results = await Promise.all(tasks);
    return results;
}

function buildDocument(title: string, sections: Array<{ heading: string; body: string }>): string {
    const parts: string[] = [];
    parts.push(`# ${title}\n`);
    for (const s of sections) {
        parts.push(`## ${s.heading}\n`);
        parts.push(s.body + '\n');
    }
    return parts.join('\n');
}

async function refineDraft(draft: string, selection: string, sources: Array<{ title: string; relPath: string; snippet: string }>, opts: { signal?: AbortSignal }): Promise<string> {
    const system = `你是文档编辑与校验专家。请根据用户上下文与参考片段对下面的 Markdown 草稿进行润色、补充遗漏要点，并返回完整的 Markdown 正文（不要输出任何解释）。如果使用了参考文档中的内容，请在文中明确以脚注或引用形式标注来源。`;
    let user = `上下文：\n${selection}\n\n草稿：\n${draft}\n\n`;
    if (sources && sources.length > 0) {
        user += `下面为本地参考文档（带片段），你可以引用它们：\n`;
        for (const s of sources) {
            user += `- ${s.title} (来源: IssueDir/${s.relPath})\n片段:\n${s.snippet}\n`;
        }
    }
    user += `\n请返回润色后的完整 Markdown 正文。`;
    const resp = await LLMService.chat([
        vscode.LanguageModelChatMessage.User(system),
        vscode.LanguageModelChatMessage.User(user),
    ], { signal: opts.signal });
    return resp ? resp.text : draft;
}

// template-aware refine wrapper: prefer loading prompt templates from resources
async function refineDraftWithTemplate(draft: string, selection: string, sources: Array<{ title: string; relPath: string; snippet: string }>, opts: { signal?: AbortSignal }): Promise<string> {
    // try load template
    const userTpl = await loadPromptFile('refine-draft-prompt.md');
    const sourcesText = (sources || []).map(s => `- ${s.title} (来源: IssueDir/${s.relPath})\n片段:\n${s.snippet}`).join('\n\n');
    if (userTpl) {
        const system = `你是文档编辑与校验专家。请根据用户上下文与参考片段对下面的 Markdown 草稿进行润色、补充遗漏要点，并返回完整的 Markdown 正文（不要输出任何解释）。如果使用了参考文档中的内容，请在文中明确以脚注或引用形式标注来源。`;
        const user = interpolate(userTpl, { selection, draft, sources: sourcesText });
        const resp = await LLMService.chat([
            vscode.LanguageModelChatMessage.User(system),
            vscode.LanguageModelChatMessage.User(user),
        ], { signal: opts.signal });
        return resp ? resp.text : draft;
    }
    // fallback to existing refineDraft behavior
    return await refineDraft(draft, selection, sources, opts);
}

async function loadPromptFile(filename: string): Promise<string> {
    try {
        const p = path.resolve(__dirname, '../../resources/copilot-prompts', filename);
        let txt = await fs.readFile(p, 'utf8');
        return stripFrontMatter(txt);
    } catch (e) {
        return '';
    }
}

function stripFrontMatter(s: string): string {
    if (!s) return s;
    const t = s.trimStart();
    if (t.startsWith('---')) {
        const idx = t.indexOf('\n---', 3);
        if (idx !== -1) return t.slice(idx + 4).trim();
    }
    return s;
}

function interpolate(template: string, vars: Record<string, string | undefined>): string {
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] ?? ''));
}

async function localSearchRelevant(title: string, selection: string, topK = 5): Promise<Array<{ title: string; relPath: string; snippet: string }>> {
    try {
        const all = await getAllIssueMarkdowns({ sortBy: 'vtime' });
        if (!all || all.length === 0) return [];

        // 简单相关性评分：标题/正文包含关键词、词重叠
        const q = (title + '\n' + selection).toLowerCase();
        const qTokens = q.split(/\W+/).filter(Boolean);

        const scored: Array<{ md: typeof all[0]; score: number }> = [];
        for (const md of all) {
            const body = await getIssueMarkdownContent(md.uri).catch(() => '');
            const text = ((md.title || '') + '\n' + body).toLowerCase();
            let score = 0;
            for (const t of qTokens) {
                if (t.length < 2) continue;
                if (text.includes(t)) score += 1;
            }
            if (score > 0) scored.push({ md, score });
        }

        scored.sort((a, b) => b.score - a.score);
        const top = scored.slice(0, topK);
        const issueDir = getIssueDir();
        const results: Array<{ title: string; relPath: string; snippet: string }> = [];
        for (const s of top) {
            const body = await getIssueMarkdownContent(s.md.uri).catch(() => '');
            // extract snippet: find sentence containing first matched token
            const qtok = qTokens.find(t => t.length > 1 && body.toLowerCase().includes(t));
            let snippet = '';
            if (qtok) {
                const idx = body.toLowerCase().indexOf(qtok);
                const start = Math.max(0, idx - 120);
                const end = Math.min(body.length, idx + 120);
                snippet = body.substring(start, end).replace(/\r?\n+/g, ' ').trim();
            } else {
                snippet = body.substring(0, 200).replace(/\r?\n+/g, ' ').trim();
            }
            let rel = s.md.uri.fsPath;
            if (issueDir) {
                rel = path.relative(issueDir, s.md.uri.fsPath).replace(/\\/g, '/');
            }
            results.push({ title: s.md.title || path.basename(s.md.uri.fsPath), relPath: rel, snippet });
        }
        return results;
    } catch (e) {
        return [];
    }
}
