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
import { readPlanForInjection, readAutoMemoryForInjection, readRoleMemoryForInjection, getAllChatRoles, getConversationsForRole } from '../llmChatDataManager';
import { SkillManager } from '../SkillManager';
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
    if (!ctx.autonomous) {
        return makeItem('mode',
            '[执行模式: 交互] 当前为交互对话模式，用户在场。'
            + '执行破坏性操作（修改角色配置、删除笔记、大规模变更）前应征求用户确认。'
            + '常规的信息查询、笔记创建、分析建议等可直接执行。',
            90);
    }

    const hasPlanning = ctx.role.toolSets.includes('planning');
    const lines = [
        '[执行模式: 自主] 当前为自主执行模式，用户不在场。',
        '你应该独立思考、主动调用工具完成任务，不要等待用户确认。',
        '遇到不明确的地方自行做出合理决策，完成后在回复中说明你的决策和理由。',
    ];
    if (hasPlanning) {
        lines.push(
            '',
            '[自主执行协议]',
            '1. 收到需要多步骤才能完成的任务时，第一步必须调用 create_plan 将任务分解为可执行步骤。',
            '2. 每完成一步立即调用 check_step 标记进度。',
            '3. 系统会根据计划进度自动驱动后续执行，计划全部完成时自动停止。',
            '4. 每次 run 专注完成 1-2 个步骤，不要试图一次做完所有事。',
            '5. 最后一步完成后，输出最终总结。',
        );
    }
    return makeItem('mode', lines.join('\n'), 90);
};

/**
 * 角色记忆（LLM 主动写入）— priority 72
 *
 * 自动注入替代 read_memory 工具调用：
 * - 启用 memory 工具集的角色，在每次对话前自动读取并注入
 * - 无需 LLM 主动调用 read_memory，节省一轮工具往返
 * - 压缩版只保留 ## State 区块（最常变动的当前状态）
 */
export const roleMemoryProvider: ContextProviderFn = async (ctx) => {
    if (!ctx.role.toolSets.includes('memory')) { return null; }
    const body = await readRoleMemoryForInjection(ctx.role.id);
    if (!body || body === '（暂无，将在对话中逐步积累）') { return null; }

    // 压缩版：只取 ## State 区块（若存在），否则取前 300 字符
    const stateMatch = /^## State\s*\n([\s\S]*?)(?=^## |\z)/m.exec(body);
    const compressedContent = stateMatch
        ? `[角色记忆 · State]\n${stateMatch[1].trim()}`
        : `[角色记忆]\n${body.slice(0, 300)}${body.length > 300 ? '\n...(截断)' : ''}`;

    return makeItem('role_memory', `[角色记忆]\n${body}`, 72, {
        compressible: true,
        compressedContent,
    });
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

/** 当前编辑器内容 — priority 60（跳过对话文件，避免重复注入） */
export const activeEditorProvider: ContextProviderFn = async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return null; }

    const doc = editor.document;

    // 跳过对话文件 — 对话内容已通过聊天历史注入，不需要重复
    if (doc.languageId === 'markdown') {
        const head = doc.getText(new vscode.Range(0, 0, 10, 0));
        if (/chat_conversation:\s*true/.test(head)) { return null; }
    }

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

/** Git diff — priority 40（大多数聊天场景不重要，可压缩） */
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

        return makeItem('git_diff', `[Git 变更]\n\`\`\`diff\n${detail}\n\`\`\``, 40, {
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

// ━━━ 对话上下文 Provider（合并 相关过往 + 最近对话） ━━━━━━━━━

/** 中文停用词（高频无意义词） */
const STOP_WORDS = new Set([
    '的', '了', '在', '是', '我', '你', '他', '她', '它', '们', '这', '那',
    '有', '和', '与', '或', '但', '也', '都', '就', '还', '会', '要', '能',
    '可以', '不', '没', '很', '太', '把', '被', '让', '给', '到', '从', '对',
    '吗', '呢', '吧', '啊', '哦', '嗯', '好', '上', '下', '中', '里', '一个',
    '什么', '怎么', '如何', '为什么', '哪', '哪个', '哪些', '多少', '几',
    '想', '觉得', '认为', '知道', '看', '说', '用', '做', '请', '帮',
]);

/** 泛英文词（在 URL 中高频出现但缺乏区分度） */
const GENERIC_ENGLISH = new Set([
    'https', 'http', 'www', 'com', 'org', 'net', 'github', 'google', 'index',
]);

/**
 * 从消息中提取关键词。
 * URL 只取路径末段（如 VibeVoice），避免 https/github 等泛词污染匹配。
 */
function extractKeywords(message: string): string[] {
    // 1. 先提取 URL 并替换为路径末段关键词
    const urls = message.match(/https?:\/\/[^\s)]+/gi) || [];
    let cleaned = message;
    for (const url of urls) {
        cleaned = cleaned.replace(url, '');
        // 取 URL 路径中有意义的末段（跳过空段和纯数字段）
        try {
            const pathname = new URL(url).pathname;
            const segments = pathname.split('/').filter(s => s && !/^\d+$/.test(s));
            // 取最后 1-2 段（通常是项目名/仓库名）
            for (const seg of segments.slice(-2)) {
                if (seg.length >= 3 && !GENERIC_ENGLISH.has(seg.toLowerCase())) {
                    cleaned += ` ${seg}`;
                }
            }
        } catch { /* invalid URL, ignore */ }
    }

    const words: string[] = [];

    // 2. 提取中文词组（2-6 字连续中文）
    const chineseMatches = cleaned.match(/[\u4e00-\u9fff]{2,6}/g) || [];
    words.push(...chineseMatches);

    // 3. 提取英文单词（3+ 字母），过滤泛词
    const englishMatches = cleaned.match(/[a-zA-Z_]{3,}/gi) || [];
    for (const w of englishMatches) {
        const lower = w.toLowerCase();
        if (!GENERIC_ENGLISH.has(lower)) { words.push(lower); }
    }

    // 去重 + 去停用词
    const seen = new Set<string>();
    return words.filter(w => {
        if (seen.has(w) || STOP_WORDS.has(w)) { return false; }
        seen.add(w);
        return true;
    });
}

interface ConvoCandidate {
    title: string;
    roleName: string;
    intent?: string;
    mtime: number;
    /** 关键词匹配分数，0 = 仅靠时间入选 */
    relevanceScore: number;
}

/**
 * 对话上下文 — priority 55
 *
 * 合并原 related_notes + recent_activity：
 *   1. 按关键词匹配找话题相关的对话，排在前面
 *   2. 按时间补充近期对话，填满配额
 *   3. 全程去重，总共 cap 8 条
 *
 * 范围策略：
 *   - generous: 跨角色（个人助理需要全局视野）
 *   - focused:  仅当前角色的对话
 */
export const conversationContextProvider: ContextProviderFn = async (ctx) => {
    const strategy = ctx.role.contextStrategy ?? 'generous';
    const currentRoleId = ctx.role.id;

    // 收集候选对话
    const allRoles = getAllChatRoles();
    const candidates: ConvoCandidate[] = [];

    // 提取关键词用于相关性评分
    const keywords = ctx.latestUserMessage?.length >= 5
        ? extractKeywords(ctx.latestUserMessage)
        : [];

    for (const role of allRoles) {
        // focused 策略只看当前角色
        if (strategy === 'focused' && role.id !== currentRoleId) { continue; }

        const convos = getConversationsForRole(role.id);
        for (const c of convos) {
            // 跳过当前对话
            if (c.uri.fsPath === ctx.conversationUri.fsPath) { continue; }

            // 计算关键词匹配分数
            let relevanceScore = 0;
            if (keywords.length > 0) {
                const md = await getIssueMarkdown(c.uri);
                const intent = md?.frontmatter?.chat_intent as string | undefined;
                const searchText = `${c.title} ${intent || ''}`.toLowerCase();
                for (const kw of keywords) {
                    if (searchText.includes(kw.toLowerCase())) {
                        relevanceScore += kw.length;
                    }
                }
            }

            candidates.push({
                title: c.title,
                roleName: role.name,
                intent: undefined, // lazy — 只在需要时再读
                mtime: c.mtime,
                relevanceScore,
            });
        }
    }

    if (candidates.length === 0) { return null; }

    // 分两组：相关的 + 仅按时间的
    const related = candidates.filter(c => c.relevanceScore > 0);
    related.sort((a, b) => b.relevanceScore - a.relevanceScore || b.mtime - a.mtime);

    const recency = candidates.slice().sort((a, b) => b.mtime - a.mtime);

    // 合并去重：相关的在前，时间补位
    const CAP = 8;
    const result: ConvoCandidate[] = [];
    const seen = new Set<string>();

    for (const c of related) {
        if (result.length >= CAP) { break; }
        const key = `${c.title}|${c.roleName}`;
        if (seen.has(key)) { continue; }
        seen.add(key);
        result.push(c);
    }
    for (const c of recency) {
        if (result.length >= CAP) { break; }
        const key = `${c.title}|${c.roleName}`;
        if (seen.has(key)) { continue; }
        seen.add(key);
        result.push(c);
    }

    if (result.length === 0) { return null; }

    const lines = result.map(c => {
        const d = new Date(c.mtime);
        const dateStr = `${d.getMonth() + 1}/${d.getDate()}`;
        const tag = c.relevanceScore > 0 ? ' ★' : '';
        return `- ${c.title} (${c.roleName}, ${dateStr})${tag}`;
    });

    const header = strategy === 'focused'
        ? '[对话上下文]'
        : '[对话上下文]\n以下是相关或近期的对话，可参考或主动提及：';

    return makeItem('conversation_context', `${header}\n${lines.join('\n')}`, 55, {
        compressible: true,
        compressedContent: `[对话上下文] ${result.length} 个对话`,
    });
};

/** 对话目标 — priority 96（高于 intent，明确的完成条件） */
export const goalProvider: ContextProviderFn = async (ctx) => {
    const goal = ctx.convoConfig?.goal;
    if (!goal) { return null; }
    return makeItem('goal', `[对话目标] ${goal}\n系统会在每次执行结束后自动检查计划完成状态。计划全部完成即视为目标达成，届时你应输出最终总结。`, 96);
};

/**
 * Agent Skills — priority 88
 *
 * 渐进式披露策略（agentskills.io 规范）：
 *   - 角色只配了 1 个 skill → 直接注入完整指令（Tier 2 inline），省去 activate_skill 调用
 *   - 角色配了多个 skills → Tier 1 Catalog（name + description），LLM 按需 activate_skill
 */
export const skillsProvider: ContextProviderFn = async (ctx) => {
    const mgr = SkillManager.getInstance();

    // skills 未配置 → 全部可用；配置了 → 展开 vendor 前缀后过滤
    const whitelist = ctx.role.skills;
    const allSkills = mgr.getAllSkills();
    let visible: typeof allSkills;
    if (whitelist && whitelist.length > 0) {
        const resolved = new Set(mgr.resolveNames(whitelist));
        visible = allSkills.filter(s => resolved.has(s.name));
    } else {
        visible = allSkills;
    }

    if (visible.length === 0) { return null; }

    // 单 skill 角色：直接注入完整指令，不需要 activate_skill 工具调用
    if (visible.length === 1) {
        const skill = visible[0];
        const dirPath = require('path').dirname(skill.filePath);
        const content = [
            '[Agent Skill — 已激活]',
            `以下是 **${skill.name}** 的完整操作指令，可直接使用，无需再调用 activate_skill。`,
            '',
            skill.body,
            '',
            `Skill 目录: ${dirPath}`,
            '如果指令中引用了相对路径（如 scripts/xxx），请基于上述目录解析为绝对路径。',
        ].join('\n');
        return makeItem('skills', content, 88);
    }

    // 多 skill 角色：Tier 1 Catalog，按需 activate
    const catalog = visible.map(s => `- **${s.name}**: ${s.description}`);
    const content = [
        '[Agent Skills]',
        '以下技能可用。当任务匹配某个技能的描述时，调用 activate_skill 工具加载详细指令后再执行。',
        '',
        ...catalog,
    ].join('\n');

    return makeItem('skills', content, 88);
};

// ━━━ Provider 注册表 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** 所有 provider 的映射表 */
export const allProviders: Record<ContextSourceId, ContextProviderFn> = {
    identity: async () => null, // identity 由 promptAssembler 直接处理，不走 provider
    goal: goalProvider,
    intent: intentProvider,
    plan: planProvider,
    mode: modeProvider,
    skills: skillsProvider,
    role_memory: roleMemoryProvider,
    memory: memoryProvider,
    active_editor: activeEditorProvider,
    selection: selectionProvider,
    git_diff: gitDiffProvider,
    datetime: datetimeProvider,
    linked_files: linkedFilesProvider,
    terms: termsProvider,
    children: childrenProvider,
    conversation_context: conversationContextProvider,
};

// ━━━ 工具函数 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function execGit(args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
        cp.execFile('git', args, { cwd, maxBuffer: 512 * 1024, timeout: 5000 }, (err, stdout) => {
            if (err) { reject(err); } else { resolve(stdout); }
        });
    });
}
