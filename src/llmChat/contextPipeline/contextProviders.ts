/**
 * 上下文 Provider 集合
 *
 * 每个 provider 返回 ContextItem | null，携带优先级和 token 估算。
 * 复用已有 templateProviders 中的数据获取逻辑，
 * 但包装为结构化 ContextItem（而非原始字符串）。
 */
import * as cp from 'child_process';
import * as vscode from 'vscode';
import type { ContextItem, ContextSourceId, ProviderContext } from './types';
import { readPlanForInjection, readAutoMemoryForInjection, getAllChatRoles, getConversationsForRole } from '../llmChatDataManager';
import {
    extractFrontmatterAndBody,
    getIssueMarkdown,
} from '../../data/IssueMarkdowns';
import { getIssueDir } from '../../config';
import { parseFileLink } from '../../utils/fileLinkFormatter';

/** 粗略 token 估算：1 token ≈ 2 中文字符 或 4 英文字符 */
function estimateTokensRough(text: string): number {
    // 简单混合估算：中文按 2 字/token，ASCII 按 4 字符/token
    let cjk = 0, ascii = 0;
    for (const ch of text) {
        if (ch.charCodeAt(0) > 0x7F) { cjk++; } else { ascii++; }
    }
    return Math.ceil(cjk / 2 + ascii / 4);
}

/** 构造 ContextItem 的辅助函数 */
function makeItem(
    source: ContextSourceId,
    content: string,
    priority: number,
    opts?: { compressible?: boolean; compressedContent?: string },
): ContextItem {
    const tokens = estimateTokensRough(content);
    const item: ContextItem = { source, priority, tokens, content, compressible: opts?.compressible ?? false };
    if (opts?.compressedContent) {
        item.compressedContent = opts.compressedContent;
        item.compressedTokens = estimateTokensRough(opts.compressedContent);
    }
    return item;
}

/** Provider 函数签名 */
export type ContextProviderFn = (ctx: ProviderContext) => Promise<ContextItem | null>;

// ━━━ 内置 Provider ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** 意图锚点 — priority 95 */
export const intentProvider: ContextProviderFn = async (ctx) => {
    const intent = ctx.convoConfig?.intent;
    if (!intent) { return null; }
    return makeItem('intent', `[当前任务] ${intent}`, 95);
};

/** 执行计划 — priority 85 */
export const planProvider: ContextProviderFn = async (ctx) => {
    if (!ctx.role.toolSets.includes('planning')) { return null; }
    const planContext = await readPlanForInjection(ctx.conversationUri, ctx.autonomous);
    if (!planContext) { return null; }
    // 压缩版：只保留标题和当前步骤
    const lines = planContext.split('\n');
    const titleLine = lines[0] || '';
    const currentStep = lines.find(l => /▶|→|当前/.test(l)) || '';
    const compressed = [titleLine, currentStep].filter(Boolean).join('\n');
    return makeItem('plan', planContext, 85, { compressible: true, compressedContent: compressed });
};

/** 执行模式 — priority 90（行为约束，几乎必须） */
export const modeProvider: ContextProviderFn = async (ctx) => {
    const content = ctx.autonomous
        ? '[执行模式: 自主] 当前为自主执行模式，用户不在场。'
            + '你应该独立思考、主动调用工具完成任务，不要等待用户确认。'
            + '遇到不明确的地方自行做出合理决策，完成后在回复中说明你的决策和理由。'
        : '[执行模式: 交互] 当前为交互对话模式，用户在场。'
            + '执行破坏性操作（修改角色配置、删除笔记、大规模变更）前应征求用户确认。'
            + '常规的信息查询、笔记创建、分析建议等可直接执行。';
    return makeItem('mode', content, 90);
};

/** 自动提取记忆 — priority 70 */
export const memoryProvider: ContextProviderFn = async (ctx) => {
    const autoMemory = await readAutoMemoryForInjection(ctx.role.id);
    if (!autoMemory) { return null; }
    // 压缩版：只保留最近 3 条
    const lines = autoMemory.split('\n').filter(l => l.startsWith('- '));
    const compressed = lines.slice(0, 3).join('\n');
    return makeItem('memory', autoMemory, 70, {
        compressible: true,
        compressedContent: compressed || autoMemory.slice(0, 200),
    });
};

// ━━━ 编辑器 Provider ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const MAX_EDITOR_CHARS = 4000;
const MAX_SELECTION_CHARS = 4000;

/** 当前编辑器内容 — priority 60 */
export const activeEditorProvider: ContextProviderFn = async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return null; }

    const doc = editor.document;
    const lang = doc.languageId;
    const fileName = doc.fileName.split('/').pop() || doc.fileName;
    let content = doc.getText();

    // 压缩版：仅前 800 字符 + 文件信息
    const compressedSnippet = content.slice(0, 800) + (content.length > 800 ? '\n... (截断)' : '');
    const compressedContent = `[当前编辑器: ${fileName}] (${lang}, ${doc.lineCount} 行)\n\`\`\`${lang}\n${compressedSnippet}\n\`\`\``;

    if (content.length > MAX_EDITOR_CHARS) {
        content = content.slice(0, MAX_EDITOR_CHARS) + `\n... (截断，共 ${doc.lineCount} 行)`;
    }

    const fullContent = `[当前编辑器: ${fileName}] (${lang})\n\`\`\`${lang}\n${content}\n\`\`\``;
    return makeItem('active_editor', fullContent, 60, { compressible: true, compressedContent });
};

/** 编辑器选中文本 — priority 75（用户主动选中 = 高意图信号） */
export const selectionProvider: ContextProviderFn = async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) { return null; }

    let text = editor.document.getText(editor.selection);
    if (!text.trim()) { return null; }

    if (text.length > MAX_SELECTION_CHARS) {
        text = text.slice(0, MAX_SELECTION_CHARS) + '\n... (截断)';
    }

    const lang = editor.document.languageId;
    return makeItem('selection', `[选中文本] (${lang})\n\`\`\`${lang}\n${text}\n\`\`\``, 75);
};

// ━━━ 工作区 Provider ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const MAX_DIFF_CHARS = 4000;

/** Git diff — priority 55 */
export const gitDiffProvider: ContextProviderFn = async () => {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) { return null; }

    try {
        let detail = await execGit(['diff', '--cached'], cwd);
        if (!detail.trim()) {
            detail = await execGit(['diff'], cwd);
        }
        if (!detail.trim()) { return null; }

        // 压缩版：仅 stat 摘要
        const stat = await execGit(['diff', '--stat'], cwd).catch(() => '');
        const compressedContent = stat.trim() ? `[Git 变更摘要]\n${stat.trim()}` : undefined;

        if (detail.length > MAX_DIFF_CHARS) {
            detail = detail.slice(0, MAX_DIFF_CHARS) + '\n... (截断)';
        }

        return makeItem('git_diff', `[Git 变更]\n\`\`\`diff\n${detail}\n\`\`\``, 55, {
            compressible: true,
            compressedContent,
        });
    } catch {
        return null;
    }
};

/** 当前时间 — priority 20（信息量低但便宜） */
export const datetimeProvider: ContextProviderFn = async () => {
    const now = new Date();
    const p = (n: number) => n.toString().padStart(2, '0');
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    const dateStr = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
    const timeStr = `${p(now.getHours())}:${p(now.getMinutes())}`;
    return makeItem('datetime', `当前时间: ${dateStr} ${timeStr} 星期${weekdays[now.getDay()]}`, 20);
};

// ━━━ Issue 生态 Provider ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const MAX_LINKED_CHARS = 4000;
const MAX_PER_FILE_CHARS = 1500;

/** 关联文件 — priority 50 */
export const linkedFilesProvider: ContextProviderFn = async (ctx) => {
    const md = await getIssueMarkdown(ctx.conversationUri);
    const linked = md?.frontmatter?.issue_linked_files as string[] | undefined;
    if (!linked || linked.length === 0) { return null; }

    const issueDir = getIssueDir();
    if (!issueDir) { return null; }

    const parts: string[] = [];
    const compressedParts: string[] = [];
    let totalChars = 0;

    for (const raw of linked) {
        if (totalChars >= MAX_LINKED_CHARS) { break; }
        const parsed = parseFileLink(raw, issueDir);
        if (!parsed) { continue; }

        try {
            const fileUri = vscode.Uri.file(parsed.filePath);
            const content = Buffer.from(
                await vscode.workspace.fs.readFile(fileUri),
            ).toString('utf8');

            const fileName = parsed.filePath.split('/').pop() || parsed.filePath;
            let snippet = content;
            if (snippet.length > MAX_PER_FILE_CHARS) {
                snippet = snippet.slice(0, MAX_PER_FILE_CHARS) + '\n... (截断)';
            }

            parts.push(`### ${fileName}\n\`\`\`\n${snippet}\n\`\`\``);
            compressedParts.push(`- ${fileName} (${content.length} 字符)`);
            totalChars += snippet.length;
        } catch {
            // 跳过
        }
    }

    if (parts.length === 0) { return null; }

    return makeItem('linked_files', parts.join('\n\n'), 50, {
        compressible: true,
        compressedContent: `[关联文件]\n${compressedParts.join('\n')}`,
    });
};

/** 术语表 — priority 45 */
export const termsProvider: ContextProviderFn = async (ctx) => {
    try {
        const raw = Buffer.from(
            await vscode.workspace.fs.readFile(ctx.role.uri),
        ).toString('utf8');
        const { frontmatter } = extractFrontmatterAndBody(raw);
        const terms = frontmatter?.terms as Array<{ name: string; definition?: string }> | undefined;
        if (!terms || terms.length === 0) { return null; }

        const lines = terms.map(t =>
            t.definition ? `- **${t.name}**: ${t.definition}` : `- **${t.name}**`,
        );
        return makeItem('terms', `[术语表]\n${lines.join('\n')}`, 45);
    } catch {
        return null;
    }
};

/** 子问题摘要 — priority 40 */
export const childrenProvider: ContextProviderFn = async (ctx) => {
    const md = await getIssueMarkdown(ctx.conversationUri);
    const children = md?.frontmatter?.issue_children_files as string[] | undefined;
    if (!children || children.length === 0) { return null; }

    const issueDir = getIssueDir();
    if (!issueDir) { return null; }

    const parts: string[] = [];
    for (const raw of children.slice(0, 10)) {
        const parsed = parseFileLink(raw, issueDir);
        if (!parsed) { continue; }

        try {
            const childUri = vscode.Uri.file(parsed.filePath);
            const childMd = await getIssueMarkdown(childUri);
            const title = childMd?.title || parsed.filePath.split('/').pop() || '未命名';
            const summary = childMd?.frontmatter?.issue_brief_summary;
            const summaryText = Array.isArray(summary) ? summary.join(' ') : (summary || '');
            parts.push(summaryText ? `- **${title}**: ${summaryText}` : `- **${title}**`);
        } catch {
            // 跳过
        }
    }

    if (parts.length === 0) { return null; }
    return makeItem('children', `[子问题]\n${parts.join('\n')}`, 40, { compressible: true });
};

// ━━━ 最近活动 Provider ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** 用户最近活动（跨角色对话） — priority 35 */
export const recentActivityProvider: ContextProviderFn = async () => {
    const allRoles = getAllChatRoles();
    const allConvos: { title: string; roleName: string; mtime: number }[] = [];
    for (const role of allRoles) {
        for (const c of getConversationsForRole(role.id)) {
            allConvos.push({ title: c.title, roleName: role.name, mtime: c.mtime });
        }
    }
    allConvos.sort((a, b) => b.mtime - a.mtime);
    const recent = allConvos.slice(0, 8);

    if (recent.length === 0) { return null; }

    const lines = recent.map(c => {
        const d = new Date(c.mtime);
        const dateStr = `${d.getMonth() + 1}/${d.getDate()}`;
        return `- ${c.title} (${c.roleName}, ${dateStr})`;
    });

    return makeItem('recent_activity', `[最近活动]\n${lines.join('\n')}`, 35, {
        compressible: true,
        compressedContent: `[最近活动] ${recent.length} 个近期对话`,
    });
};

// ━━━ 关联笔记 Provider ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** 中文停用词（高频无意义词） */
const STOP_WORDS = new Set([
    '的', '了', '在', '是', '我', '你', '他', '她', '它', '们', '这', '那',
    '有', '和', '与', '或', '但', '也', '都', '就', '还', '会', '要', '能',
    '可以', '不', '没', '很', '太', '把', '被', '让', '给', '到', '从', '对',
    '吗', '呢', '吧', '啊', '哦', '嗯', '好', '上', '下', '中', '里', '一个',
    '什么', '怎么', '如何', '为什么', '哪', '哪个', '哪些', '多少', '几',
    '想', '觉得', '认为', '知道', '看', '说', '用', '做', '请', '帮',
]);

/** 从消息中提取关键词 */
function extractKeywords(message: string): string[] {
    // 分词：按非字母/非中文字符切割，或按单个中文字符
    const words: string[] = [];

    // 提取中文词组（2-6 字连续中文）
    const chineseMatches = message.match(/[\u4e00-\u9fff]{2,6}/g) || [];
    words.push(...chineseMatches);

    // 提取英文单词（3+ 字母）
    const englishMatches = message.match(/[a-zA-Z_]{3,}/gi) || [];
    words.push(...englishMatches.map(w => w.toLowerCase()));

    // 去重 + 去停用词
    const seen = new Set<string>();
    return words.filter(w => {
        if (seen.has(w) || STOP_WORDS.has(w)) { return false; }
        seen.add(w);
        return true;
    });
}

/** 与当前话题相关的过往对话 — priority 65 */
export const relatedNotesProvider: ContextProviderFn = async (ctx) => {
    const message = ctx.latestUserMessage;
    if (!message || message.length < 5) { return null; }

    const keywords = extractKeywords(message);
    if (keywords.length === 0) { return null; }

    // 收集所有对话（带标题和意图）
    const allRoles = getAllChatRoles();
    const candidates: { title: string; roleName: string; intent?: string; score: number; mtime: number }[] = [];

    for (const role of allRoles) {
        const convos = getConversationsForRole(role.id);
        for (const c of convos) {
            // 跳过当前对话
            if (c.uri.fsPath === ctx.conversationUri.fsPath) { continue; }

            // 读取 intent（从 frontmatter）
            const md = await getIssueMarkdown(c.uri);
            const intent = md?.frontmatter?.chat_intent as string | undefined;
            const searchText = `${c.title} ${intent || ''}`.toLowerCase();

            // 计算关键词匹配分数
            let score = 0;
            for (const kw of keywords) {
                if (searchText.includes(kw.toLowerCase())) {
                    score += kw.length; // 长词匹配权重更高
                }
            }

            if (score > 0) {
                candidates.push({ title: c.title, roleName: role.name, intent, score, mtime: c.mtime });
            }
        }
    }

    if (candidates.length === 0) { return null; }

    // 按分数降序，取 top 5
    candidates.sort((a, b) => b.score - a.score || b.mtime - a.mtime);
    const top = candidates.slice(0, 5);

    const lines = top.map(c => {
        const d = new Date(c.mtime);
        const dateStr = `${d.getMonth() + 1}/${d.getDate()}`;
        const intentHint = c.intent ? ` — ${c.intent}` : '';
        return `- ${c.title}${intentHint} (${c.roleName}, ${dateStr})`;
    });

    return makeItem('related_notes',
        `[相关过往]\n以下是与当前话题可能相关的过往对话，可以参考或主动提及：\n${lines.join('\n')}`,
        65, { compressible: true },
    );
};

// ━━━ Provider 注册表 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** 所有 provider 的映射表 */
export const allProviders: Record<ContextSourceId, ContextProviderFn> = {
    identity: async () => null, // identity 由 promptAssembler 直接处理，不走 provider
    intent: intentProvider,
    plan: planProvider,
    mode: modeProvider,
    memory: memoryProvider,
    active_editor: activeEditorProvider,
    selection: selectionProvider,
    git_diff: gitDiffProvider,
    datetime: datetimeProvider,
    linked_files: linkedFilesProvider,
    terms: termsProvider,
    children: childrenProvider,
    recent_activity: recentActivityProvider,
    related_notes: relatedNotesProvider,
};

// ━━━ 工具函数 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function execGit(args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
        cp.execFile('git', args, { cwd, maxBuffer: 512 * 1024, timeout: 5000 }, (err, stdout) => {
            if (err) { reject(err); } else { resolve(stdout); }
        });
    });
}
