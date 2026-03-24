/**
 * LLM 聊天数据管理器
 *
 * 负责从 issueMarkdown 文件中读取/写入聊天角色和对话数据。
 */
import * as vscode from 'vscode';
import * as path from 'path';
import {
    getIssueMarkdownsByType,
    extractFrontmatterAndBody,
    createIssueMarkdown,
    updateIssueMarkdownFrontmatter,
    updateIssueMarkdownBody,
} from '../data/IssueMarkdowns';
import type { FrontmatterData } from '../data/IssueMarkdowns';
import { createIssueNodes, getSingleIssueNodeByUri } from '../data/issueTreeManager';
import { getIssueDir } from '../config';
import type {
    ChatRoleInfo,
    ChatConversationInfo,
    ChatMessage,
    ChatRoleFrontmatter,
    ChatConversationFrontmatter,
    ChatGroupFrontmatter,
    ChatGroupInfo,
    ChatGroupConversationFrontmatter,
    ChatGroupMessage,
    ChromeChatFrontmatter,
    ChromeChatInfo,
    ChatExecutionLogFrontmatter,
    ChatExecutionLogInfo,
    ChatToolCallFrontmatter,
    ExecutionRunRecord,
    ExecutionToolCall,
    RecentActivityEntry,
    RoleAutoMemoryFrontmatter,
    ChatPlanFrontmatter,
} from './types';
import { stripMarker, parseStateMarker } from './convStateMarker';
import { Logger } from '../core/utils/Logger';

const logger = Logger.getInstance();

/** YAML 值转有限数字，无效时返回 undefined */
function toFiniteNumber(v: unknown): number | undefined {
    if (v == null) { return undefined; }
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
}

// ─── 角色相关 ───────────────────────────────────────────────

/** 从类型索引中获取所有聊天角色（O(K)，K=角色数，无 findFiles） */
export function getAllChatRoles(): ChatRoleInfo[] {
    const all = getIssueMarkdownsByType('chat_role');
    const roles: ChatRoleInfo[] = [];
    for (const md of all) {
        if (!md.frontmatter || md.frontmatter.chat_role !== true) { continue; }
        const fm = md.frontmatter as unknown as ChatRoleFrontmatter & FrontmatterData;
        roles.push({
            id: extractId(md.uri),
            name: fm.chat_role_name || md.title || '未命名角色',
            avatar: fm.chat_role_avatar || 'hubot',
            modelFamily: fm.chat_role_model_family,
            uri: md.uri,
            timerEnabled: fm.timer_enabled === true,
            timerInterval: toFiniteNumber(fm.timer_interval),
            timerMaxConcurrent: toFiniteNumber(fm.timer_max_concurrent),
            timerTimeout: toFiniteNumber(fm.timer_timeout),
            timerMaxRetries: toFiniteNumber(fm.timer_max_retries),
            timerRetryDelay: toFiniteNumber(fm.timer_retry_delay),
            maxTokens: toFiniteNumber(fm.chat_role_max_tokens),
            toolSets: Array.isArray(fm.tool_sets) ? (fm.tool_sets as unknown[]).map(String) : [],
            mcpServers: Array.isArray(fm.mcp_servers) ? (fm.mcp_servers as unknown[]).map(String) : undefined,
            extraTools: Array.isArray(fm.extra_tools) ? (fm.extra_tools as unknown[]).map(String) : undefined,
            excludedTools: Array.isArray(fm.excluded_tools) ? (fm.excluded_tools as unknown[]).map(String) : undefined,
            roleStatus: fm.role_status as 'ready' | 'testing' | 'disabled' | undefined,
            autonomous: typeof fm.chat_autonomous === 'boolean' ? fm.chat_autonomous : undefined,
        });
    }
    return roles;
}

/** 根据 ID 获取单个角色 */
export function getChatRoleById(roleId: string): ChatRoleInfo | undefined {
    const roles = getAllChatRoles();
    return roles.find(r => r.id === roleId);
}

/**
 * 从角色文件的 markdown body 中读取系统提示词（懒加载，按需调用）。
 * body 格式约定：第一行为 `# 角色名`，其后内容即为 system prompt。
 * 向后兼容：若 body 为空但 frontmatter 中仍有 chat_role_system_prompt，则回退读取。
 */
export async function getRoleSystemPrompt(uri: vscode.Uri): Promise<string> {
    try {
        const raw = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
        const { frontmatter, body } = extractFrontmatterAndBody(raw);

        // 去掉第一行 # 标题
        const stripped = body.replace(/^#\s+.*\n?/, '').trim();
        if (stripped) { return stripped; }

        // 向后兼容：旧文件的 system prompt 可能还在 frontmatter 中
        const fm = frontmatter as Record<string, unknown> | null;
        if (fm?.chat_role_system_prompt && typeof fm.chat_role_system_prompt === 'string') {
            return fm.chat_role_system_prompt;
        }
        return '';
    } catch (e) {
        logger.warn('[llmChatDataManager] 读取角色 system prompt 失败', e);
        return '';
    }
}

/**
 * 更新角色文件的系统提示词（写入 markdown body，保留 frontmatter 不变）。
 */
export async function updateRoleSystemPrompt(uri: vscode.Uri, newPrompt: string): Promise<boolean> {
    try {
        const raw = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
        const { frontmatter } = extractFrontmatterAndBody(raw);
        const fm = frontmatter as Record<string, unknown> | null;
        const roleName = (fm?.chat_role_name as string) || '未命名角色';

        const newBody = newPrompt
            ? `# ${roleName}\n\n${newPrompt}\n`
            : `# ${roleName}\n`;
        return await updateIssueMarkdownBody(uri, newBody);
    } catch (e) {
        logger.error('[llmChatDataManager] 更新角色 system prompt 失败', e);
        return false;
    }
}

/** 创建新的聊天角色文件，返回角色 ID */
export async function createChatRole(
    name: string,
    systemPrompt: string,
    avatar?: string,
    modelFamily?: string,
    toolSets?: string[],
    mcpServers?: string[],
    options?: {
        timerEnabled?: boolean;
        timerInterval?: number;
        autonomous?: boolean;
    },
): Promise<string | null> {
    const defaultModelFamily = vscode.workspace.getConfiguration('issueManager').get<string>('llm.modelFamily') || 'gpt-5-mini';
    const fm: Partial<FrontmatterData> & ChatRoleFrontmatter = {
        chat_role: true,
        chat_role_name: name,
        chat_role_avatar: avatar || 'hubot',
        chat_role_model_family: modelFamily || defaultModelFamily,
        // ─── 定时器配置（默认关闭，按需开启） ────────────────
        timer_enabled: options?.timerEnabled ?? false,
        timer_interval: options?.timerInterval ?? 30000,
        timer_max_concurrent: 2,
        timer_timeout: 180000,
        timer_max_retries: 3,
        timer_retry_delay: 5000,
        // ─── 工具集配置（占位，按需填写） ────────────────────
        tool_sets: toolSets ?? [],
        mcp_servers: mcpServers ?? [],
        ...(options?.autonomous !== undefined ? { chat_autonomous: options.autonomous } : {}),
    } as Partial<FrontmatterData> & ChatRoleFrontmatter & { tool_sets: string[]; mcp_servers: string[] };

    const body = systemPrompt
        ? `# ${name}\n\n${systemPrompt}\n`
        : `# ${name}\n`;
    const uri = await createIssueMarkdown({ frontmatter: fm, markdownBody: body });
    if (!uri) {
        return null;
    }
    await createIssueNodes([uri]);
    return extractId(uri);
}

// ─── 对话相关 ───────────────────────────────────────────────

/** 获取某角色下的所有对话（从类型索引查询，O(K)） */
export function getConversationsForRole(roleId: string): ChatConversationInfo[] {
    const all = getIssueMarkdownsByType('chat_conversation');
    const convos: ChatConversationInfo[] = [];
    for (const md of all) {
        if (!md.frontmatter || md.frontmatter.chat_conversation !== true) { continue; }
        const fm = md.frontmatter as unknown as ChatConversationFrontmatter & FrontmatterData;
        if (fm.chat_role_id !== roleId) { continue; }
        convos.push({
            id: extractId(md.uri),
            roleId: fm.chat_role_id,
            title: fm.chat_title || md.title || '未命名对话',
            uri: md.uri,
            mtime: md.mtime,
            modelFamily: fm.chat_model_family,
            maxTokens: fm.chat_max_tokens,
            tokenUsed: fm.chat_token_used,
            logId: fm.chat_log_id,
        });
    }
    convos.sort((a, b) => b.mtime - a.mtime);
    return convos;
}

/** 创建新的对话文件 */
export async function createConversation(roleId: string, title?: string): Promise<vscode.Uri | null> {
    const role = getChatRoleById(roleId);
    const roleName = role?.name || '未知角色';
    const convoTitle = title || `与 ${roleName} 的对话`;

    // 对话级默认值：继承角色配置，若无则使用系统默认
    const defaultModelFamily = role?.modelFamily
        || vscode.workspace.getConfiguration('issueManager').get<string>('llm.modelFamily')
        || 'gpt-5-mini';

    const fm: Partial<FrontmatterData> & ChatConversationFrontmatter = {
        chat_conversation: true,
        chat_role_id: roleId,
        chat_title: convoTitle,
        chat_model_family: defaultModelFamily,
        chat_max_tokens: role?.maxTokens ?? 0,
        chat_token_used: 0,
    };

    const body = `# ${convoTitle}\n\n<!-- llm:ready -->\n`;
    const uri = await createIssueMarkdown({ frontmatter: fm, markdownBody: body });
    if (uri) {
        // 挂在角色的树节点下
        const roleNode = role?.uri ? await getSingleIssueNodeByUri(role.uri) : undefined;
        await createIssueNodes([uri], roleNode?.id);
    }
    return uri;
}

/** 从对话文件中解析所有消息（自动过滤末尾状态标记，不污染消息内容） */
export async function parseConversationMessages(uri: vscode.Uri): Promise<ChatMessage[]> {
    try {
        const content = Buffer.from(
            await vscode.workspace.fs.readFile(uri),
        ).toString('utf8');
        const { body } = extractFrontmatterAndBody(content);
        // 去掉末尾状态标记，防止被纳入最后一条消息的内容
        const cleanBody = stripMarker(body);
        return parseMessagesFromBody(cleanBody);
    } catch (e) {
        logger.error('parseConversationMessages 失败', e);
        return [];
    }
}

/** 向对话文件追加一条消息（不影响末尾状态标记） */
export async function appendMessageToConversation(
    uri: vscode.Uri,
    role: 'user' | 'assistant',
    content: string,
): Promise<void> {
    try {
        const raw = Buffer.from(
            await vscode.workspace.fs.readFile(uri),
        ).toString('utf8');

        const now = Date.now();
        const dateStr = formatTimestamp(now);
        const label = role === 'user' ? 'User' : 'Assistant';
        const block = `\n## ${label} (${dateStr})\n\n${content}\n`;

        const updated = raw + block;
        await vscode.workspace.fs.writeFile(uri, Buffer.from(updated, 'utf8'));
    } catch (e) {
        logger.error('appendMessageToConversation 失败', e);
        throw e;
    }
}

/**
 * 追加用户消息并在末尾写入 queued 标记（单次写入）。
 * 若文件末尾已有其他状态标记（如 error/retrying），先清除再追加。
 * 这是定时器模式下用户"提交消息"的入口。
 */
export async function appendUserMessageQueued(
    uri: vscode.Uri,
    content: string,
): Promise<void> {
    try {
        const raw = Buffer.from(
            await vscode.workspace.fs.readFile(uri),
        ).toString('utf8');

        // 防御性检查：如果文件已有 executing/queued 标记，说明上一轮尚未完成，拒绝写入
        const existingMarker = parseStateMarker(raw);
        if (existingMarker && (existingMarker.status === 'executing' || existingMarker.status === 'queued')) {
            throw new Error(`对话当前状态为 ${existingMarker.status}，无法追加新消息。请等待当前轮次完成。`);
        }

        // 清除旧状态标记（如 error/retrying）
        const stripped = stripMarker(raw);
        const dateStr = formatTimestamp(Date.now());
        const block = `\n## User (${dateStr})\n\n${content}\n\n<!-- llm:queued -->\n`;

        await vscode.workspace.fs.writeFile(uri, Buffer.from(stripped + block, 'utf8'));
    } catch (e) {
        logger.error('appendUserMessageQueued 失败', e);
        throw e;
    }
}

/** 更新对话文件的 chat_title frontmatter 字段 */
export async function updateConversationTitle(uri: vscode.Uri, newTitle: string): Promise<void> {
    await updateIssueMarkdownFrontmatter(uri, { chat_title: newTitle } as any);
}

// ─── 自动提取记忆（Auto Memory）───────────────────────────────
// hook 自动写入，LLM 只读不写。与 role_memory（LLM 主动管理）完全隔离。

const AUTO_MEMORY_MAX_ENTRIES = 100;

/** 查找或创建角色的自动提取记忆文件，返回 URI */
async function findOrCreateAutoMemoryFile(roleId: string): Promise<vscode.Uri | null> {
    const all = getIssueMarkdownsByType('role_auto_memory');
    for (const md of all) {
        if (md.frontmatter?.role_auto_memory_owner_id === roleId) {
            return md.uri;
        }
    }
    const fm: Partial<FrontmatterData> & RoleAutoMemoryFrontmatter = {
        role_auto_memory: true,
        role_auto_memory_owner_id: roleId,
    } as Partial<FrontmatterData> & RoleAutoMemoryFrontmatter;
    const body = '# 自动提取记忆\n\n';
    const uri = await createIssueMarkdown({ frontmatter: fm as Partial<FrontmatterData>, markdownBody: body });
    if (uri) {
        const role = getChatRoleById(roleId);
        const roleNode = role?.uri ? await getSingleIssueNodeByUri(role.uri) : undefined;
        await createIssueNodes([uri], roleNode?.id);
    }
    return uri ?? null;
}

/**
 * 向角色的自动提取记忆文件追加条目。
 * 按日期分节（## YYYY-MM-DD），超过 MAX_ENTRIES 时删除最旧条目。
 */
export async function appendAutoMemoryEntries(
    roleId: string,
    entries: string[],
    conversationId: string,
): Promise<void> {
    if (entries.length === 0) { return; }

    const uri = await findOrCreateAutoMemoryFile(roleId);
    if (!uri) { return; }

    const raw = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');

    const today = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const dateStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const entryLines = entries.map(e => `- [对话 ${conversationId}] ${e}`);

    // 重新构建 body：找到今日 section 追加，或新建 section
    const fmBlock = raw.slice(0, raw.indexOf('\n---\n', 4) + 5); // frontmatter block
    const bodyMatch = /^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/.exec(raw);
    let body = bodyMatch ? bodyMatch[1] : '# 自动提取记忆\n\n';

    const todaySectionRe = new RegExp(`(## ${dateStr}\\r?\\n)([\\s\\S]*?)(?=\\n## |$)`);
    if (todaySectionRe.test(body)) {
        body = body.replace(todaySectionRe, (_, header, content) =>
            `${header}${content.trimEnd()}\n${entryLines.join('\n')}\n`,
        );
    } else {
        body = body.trimEnd() + `\n\n## ${dateStr}\n\n${entryLines.join('\n')}\n`;
    }

    // 超限：删除最旧的条目行（以 "- [对话" 开头），保留结构
    const allEntryLines = body.match(/^- \[对话 .+$/gm) ?? [];
    if (allEntryLines.length > AUTO_MEMORY_MAX_ENTRIES) {
        const excess = allEntryLines.length - AUTO_MEMORY_MAX_ENTRIES;
        let removed = 0;
        body = body.replace(/^- \[对话 .+$\n?/gm, (line) => {
            if (removed < excess) { removed++; return ''; }
            return line;
        });
        // 清理因删除产生的空 section（只剩标题行的 ## 节）
        body = body.replace(/^## \d{4}-\d{2}-\d{2}\n+(?=## |\s*$)/gm, '');
    }

    await vscode.workspace.fs.writeFile(uri, Buffer.from(fmBlock + body, 'utf8'));
}

/**
 * 读取角色自动提取记忆，用于注入 system prompt。
 * 从最新条目开始取，直到累计字符数达到 maxChars（默认 3000）。
 */
export async function readAutoMemoryForInjection(
    roleId: string,
    maxChars = 3000,
): Promise<string> {
    const all = getIssueMarkdownsByType('role_auto_memory');
    const md = all.find(m => m.frontmatter?.role_auto_memory_owner_id === roleId);
    if (!md) { return ''; }

    try {
        const raw = Buffer.from(await vscode.workspace.fs.readFile(md.uri)).toString('utf8');
        const { body } = extractFrontmatterAndBody(raw);

        // 提取所有条目行（带所属日期），逆序后按预算截取
        const sections: Array<{ date: string; line: string }> = [];
        let currentDate = '';
        for (const line of body.split('\n')) {
            const dateMatch = /^## (\d{4}-\d{2}-\d{2})$/.exec(line);
            if (dateMatch) { currentDate = dateMatch[1]; continue; }
            if (line.startsWith('- [对话') && currentDate) {
                sections.push({ date: currentDate, line });
            }
        }

        // 最新在后 → 逆序取
        sections.reverse();
        const kept: Array<{ date: string; line: string }> = [];
        let total = 0;
        for (const s of sections) {
            const len = s.line.length + 1;
            if (total + len > maxChars) { break; }
            kept.push(s);
            total += len;
        }

        if (kept.length === 0) { return ''; }

        // 还原为按日期分组的格式（正序输出）
        kept.reverse();
        const grouped = new Map<string, string[]>();
        for (const s of kept) {
            if (!grouped.has(s.date)) { grouped.set(s.date, []); }
            grouped.get(s.date)!.push(s.line);
        }
        const lines: string[] = ['[自动提取记忆]'];
        for (const [date, entries] of grouped) {
            lines.push(`\n${date}`);
            lines.push(...entries);
        }
        return lines.join('\n');
    } catch {
        return '';
    }
}

/**
 * 更新对话文件 frontmatter 中的 token 使用量。
 * 请求前/后各调用一次以跟踪 token 消耗。
 */
export async function updateConversationTokenUsed(
    uri: vscode.Uri,
    tokenUsed: number,
    maxTokens?: number,
): Promise<void> {
    try {
        const updates: Partial<FrontmatterData> = { chat_token_used: tokenUsed };
        if (maxTokens && maxTokens > 0) {
            updates.chat_token_used_pct = Math.round((tokenUsed / maxTokens) * 100);
        }
        await updateIssueMarkdownFrontmatter(uri, updates);
    } catch (e) {
        logger.error('updateConversationTokenUsed 失败', e);
    }
}

/**
 * 估算消息列表的 token 数。
 * 优先使用 VS Code LanguageModelChat.countTokens()，不可用时按字符数粗估（1 token ≈ 2 字符）。
 */
export async function estimateTokens(messages: vscode.LanguageModelChatMessage[]): Promise<number> {
    try {
        const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
        if (models.length > 0) {
            let total = 0;
            for (const msg of messages) {
                total += await models[0].countTokens(msg);
            }
            return total;
        }
    } catch {
        // countTokens 不可用，回落到字符估算
    }
    const totalChars = messages.reduce((sum, m) => sum + String((m as any).content ?? '').length, 0);
    return Math.ceil(totalChars / 2);
}

/**
 * 从对话文件 frontmatter 读取对话级配置（model_family, max_tokens, token_used）。
 * 用于 RoleTimerManager 在执行前获取对话级覆盖配置。
 */
export async function getConversationConfig(uri: vscode.Uri): Promise<{
    modelFamily?: string;
    maxTokens?: number;
    tokenUsed?: number;
    autonomous?: boolean;
    intent?: string;
} | null> {
    try {
        const raw = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
        const { frontmatter } = extractFrontmatterAndBody(raw);
        if (!frontmatter) { return null; }
        const fm = frontmatter as Record<string, unknown>;
        return {
            modelFamily: fm.chat_model_family as string | undefined,
            maxTokens: fm.chat_max_tokens as number | undefined,
            tokenUsed: fm.chat_token_used as number | undefined,
            autonomous: typeof fm.chat_autonomous === 'boolean' ? fm.chat_autonomous : undefined,
            intent: typeof fm.chat_intent === 'string' ? fm.chat_intent : undefined,
        };
    } catch {
        return null;
    }
}

/** 写入或更新对话的意图锚点（chat_intent frontmatter 字段） */
export async function updateConversationIntent(uri: vscode.Uri, intent: string): Promise<void> {
    await updateIssueMarkdownFrontmatter(uri, { chat_intent: intent } as any);
}

// ─── 执行计划（Planning）──────────────────────────────────────
// chat_plan 文件绑定单个对话，LLM 通过 planning 工具集创建/读取/更新。
// 每次 buildMessages() 注入当前计划状态，辅助 LLM 跨 run 维持进度。

/** 解析计划 body，提取进度说明与步骤列表 */
function parsePlanBody(body: string): { note: string; steps: { text: string; done: boolean }[] } {
    const noteMatch = /## 进度说明\n+([\s\S]*?)(?=\n## |\s*$)/.exec(body);
    const note = noteMatch?.[1]?.trim() ?? '';

    const stepsMatch = /## 步骤\n+([\s\S]*)/.exec(body);
    const stepsRaw = stepsMatch?.[1] ?? '';
    const steps = stepsRaw
        .split('\n')
        .filter(l => /^- \[[ x]\]/.test(l))
        .map(l => ({
            done: l.startsWith('- [x]'),
            text: l.replace(/^- \[[ x]\]\s*/, '').replace(/\s*←\s*\*\*当前\*\*\s*$/, '').trim(),
        }));
    return { note, steps };
}

/** 序列化计划为 body markdown，自动为第一个未完成步骤标记「← **当前**」 */
function serializePlanBody(note: string, steps: { text: string; done: boolean }[]): string {
    const firstPendingIdx = steps.findIndex(s => !s.done);
    const stepsStr = steps.map((s, i) => {
        const check = s.done ? '[x]' : '[ ]';
        const current = !s.done && i === firstPendingIdx ? '  ← **当前**' : '';
        return `- ${check} ${s.text}${current}`;
    }).join('\n');
    return `## 进度说明\n\n${note || '（暂无说明）'}\n\n## 步骤\n\n${stepsStr}\n`;
}

/** 从对话 frontmatter 获取关联计划文件 URI，不存在返回 null */
async function getPlanUri(conversationUri: vscode.Uri): Promise<vscode.Uri | null> {
    try {
        const raw = Buffer.from(await vscode.workspace.fs.readFile(conversationUri)).toString('utf8');
        const { frontmatter } = extractFrontmatterAndBody(raw);
        const planId = (frontmatter as Record<string, unknown>)?.chat_plan_id as string | undefined;
        if (!planId) { return null; }
        const dir = getIssueDir();
        if (!dir) { return null; }
        return vscode.Uri.file(path.join(dir, `${planId}.md`));
    } catch {
        return null;
    }
}

/** 创建计划文件并链接到对话（已有计划时返回 null） */
export async function createPlanFile(
    conversationUri: vscode.Uri,
    title: string,
    steps: string[],
): Promise<{ uri: vscode.Uri; content: string } | null> {
    // 已有计划则拒绝重复创建
    const existing = await getPlanUri(conversationUri);
    if (existing) { return null; }

    const convoId = path.basename(conversationUri.fsPath, '.md');
    const fm: Partial<FrontmatterData> & ChatPlanFrontmatter = {
        chat_plan: true,
        chat_plan_conversation_id: convoId,
        chat_plan_title: title,
        chat_plan_status: 'in_progress',
    } as Partial<FrontmatterData> & ChatPlanFrontmatter;

    const initialSteps = steps.map(s => ({ text: s.trim(), done: false }));
    const body = serializePlanBody('', initialSteps);

    const planUri = await createIssueMarkdown({ frontmatter: fm as Partial<FrontmatterData>, markdownBody: body });
    if (!planUri) { return null; }

    const planId = path.basename(planUri.fsPath, '.md');
    await updateIssueMarkdownFrontmatter(conversationUri, { chat_plan_id: planId } as any);

    const convoNode = await getSingleIssueNodeByUri(conversationUri);
    if (convoNode) {
        await createIssueNodes([planUri], convoNode.id);
    }

    return { uri: planUri, content: body };
}

/** 读取计划文件，返回 body 字符串（供工具直接展示）；无计划返回 null */
export async function readPlanContent(conversationUri: vscode.Uri): Promise<string | null> {
    const planUri = await getPlanUri(conversationUri);
    if (!planUri) { return null; }
    try {
        const raw = Buffer.from(await vscode.workspace.fs.readFile(planUri)).toString('utf8');
        const { frontmatter, body } = extractFrontmatterAndBody(raw);
        const fm = frontmatter as Record<string, unknown>;
        const title = fm?.chat_plan_title as string ?? '（未命名计划）';
        const status = fm?.chat_plan_status as string ?? 'in_progress';
        const { note, steps } = parsePlanBody(body);
        const doneCount = steps.filter(s => s.done).length;
        return `**${title}**（${status === 'completed' ? '✅ 已完成' : '进行中'}，${doneCount}/${steps.length} 步）\n\n${serializePlanBody(note, steps)}`;
    } catch {
        return null;
    }
}

/** 读取计划供 context 注入（简洁格式，不展示 markdown 语法） */
/** 读取对话的自动续写计数（来自 frontmatter chat_auto_queue_count） */
export async function getAutoQueueCount(conversationUri: vscode.Uri): Promise<number> {
    try {
        const raw = Buffer.from(await vscode.workspace.fs.readFile(conversationUri)).toString('utf8');
        const { frontmatter } = extractFrontmatterAndBody(raw);
        const count = (frontmatter as Record<string, unknown>)?.chat_auto_queue_count;
        return typeof count === 'number' && count >= 0 ? count : 0;
    } catch {
        return 0;
    }
}

/** 更新对话的自动续写计数 */
export async function setAutoQueueCount(conversationUri: vscode.Uri, count: number): Promise<void> {
    await updateIssueMarkdownFrontmatter(conversationUri, { chat_auto_queue_count: count } as any);
}

// ─── 续写两阶段提交 ───────────────────────────────────────────
// queue_continuation 工具在 run 执行中无法直接写入（executing 状态限制），
// 故先暂存消息到 chat_pending_continuation frontmatter 字段，
// run 结束后由 RoleTimerManager 统一提升为 queued 消息。

/** 暂存待续写消息（由 queue_continuation 工具调用） */
export async function setPendingContinuation(conversationUri: vscode.Uri, message: string): Promise<void> {
    await updateIssueMarkdownFrontmatter(conversationUri, { chat_pending_continuation: message } as any);
}

/** 读取待续写消息，不存在时返回 null */
export async function getPendingContinuation(conversationUri: vscode.Uri): Promise<string | null> {
    try {
        const raw = Buffer.from(await vscode.workspace.fs.readFile(conversationUri)).toString('utf8');
        const { frontmatter } = extractFrontmatterAndBody(raw);
        const msg = (frontmatter as Record<string, unknown>)?.chat_pending_continuation;
        return typeof msg === 'string' && msg.trim() ? msg.trim() : null;
    } catch {
        return null;
    }
}

/** 清空待续写消息 */
export async function clearPendingContinuation(conversationUri: vscode.Uri): Promise<void> {
    await updateIssueMarkdownFrontmatter(conversationUri, { chat_pending_continuation: null } as any);
}

/**
 * 读取计划供 context 注入。
 * autonomous=true 时在末尾追加执行规范，引导 LLM 在计划未完成时调用 queue_continuation。
 */
export async function readPlanForInjection(conversationUri: vscode.Uri, autonomous?: boolean): Promise<string> {
    const planUri = await getPlanUri(conversationUri);
    if (!planUri) { return ''; }
    try {
        const raw = Buffer.from(await vscode.workspace.fs.readFile(planUri)).toString('utf8');
        const { frontmatter, body } = extractFrontmatterAndBody(raw);
        const fm = frontmatter as Record<string, unknown>;
        const title = fm?.chat_plan_title as string ?? '（未命名计划）';
        const status = fm?.chat_plan_status as string ?? 'in_progress';
        if (status === 'abandoned') { return ''; }

        const { note, steps } = parsePlanBody(body);
        const doneCount = steps.filter(s => s.done).length;
        const firstPendingIdx = steps.findIndex(s => !s.done);

        const stepsStr = steps.map((s, i) => {
            if (s.done) { return `✅ ${i + 1}. ${s.text}`; }
            if (i === firstPendingIdx) { return `▶ ${i + 1}. ${s.text}（当前）`; }
            return `□ ${i + 1}. ${s.text}`;
        }).join('\n');

        const parts = [`[执行计划] ${title}  进度: ${doneCount}/${steps.length} 步完成`];
        if (note && note !== '（暂无说明）') { parts.push(`进度说明: ${note}`); }
        parts.push('', stepsStr);

        // 自主模式 + 计划未完成时，注入执行规范，引导 LLM 正确使用 queue_continuation
        if (autonomous && status !== 'completed') {
            parts.push('', '[规划执行规范] 每完成一步立即调用 check_step 标记。计划未完成时，每次 run 结束前调用 queue_continuation 触发下一次执行（消息描述下一步具体行动）。计划全部完成后停止 queue，向用户汇报最终结果。');
        }

        return parts.join('\n');
    } catch {
        return '';
    }
}

/** 标记步骤完成/未完成（stepIndex 从 1 开始） */
export async function checkPlanStep(
    conversationUri: vscode.Uri,
    stepIndex: number,
    done: boolean,
): Promise<{ success: boolean; message: string }> {
    const planUri = await getPlanUri(conversationUri);
    if (!planUri) { return { success: false, message: '当前对话没有关联的执行计划' }; }
    try {
        const raw = Buffer.from(await vscode.workspace.fs.readFile(planUri)).toString('utf8');
        const { body } = extractFrontmatterAndBody(raw);
        const { note, steps } = parsePlanBody(body);

        const idx = stepIndex - 1;
        if (idx < 0 || idx >= steps.length) {
            return { success: false, message: `步骤序号 ${stepIndex} 超出范围（共 ${steps.length} 步）` };
        }
        steps[idx].done = done;

        const ok = await updateIssueMarkdownBody(planUri, serializePlanBody(note, steps));
        if (ok && steps.every(s => s.done)) {
            await updateIssueMarkdownFrontmatter(planUri, { chat_plan_status: 'completed' } as any);
        }
        const doneCount = steps.filter(s => s.done).length;
        return {
            success: ok,
            message: ok
                ? `✅ 步骤 ${stepIndex} 已标记为${done ? '完成' : '未完成'}（${doneCount}/${steps.length}）`
                : '更新失败',
        };
    } catch (e) {
        logger.error('[PlanTools] checkPlanStep 失败', e);
        return { success: false, message: '更新步骤失败' };
    }
}

/** 追加新步骤到计划末尾 */
export async function addPlanStep(
    conversationUri: vscode.Uri,
    step: string,
): Promise<{ success: boolean; message: string }> {
    const planUri = await getPlanUri(conversationUri);
    if (!planUri) { return { success: false, message: '当前对话没有关联的执行计划' }; }
    try {
        const raw = Buffer.from(await vscode.workspace.fs.readFile(planUri)).toString('utf8');
        const { body } = extractFrontmatterAndBody(raw);
        const { note, steps } = parsePlanBody(body);

        steps.push({ text: step.trim(), done: false });
        const ok = await updateIssueMarkdownBody(planUri, serializePlanBody(note, steps));
        return {
            success: ok,
            message: ok ? `✅ 已追加步骤 ${steps.length}: ${step}` : '追加失败',
        };
    } catch (e) {
        logger.error('[PlanTools] addPlanStep 失败', e);
        return { success: false, message: '追加步骤失败' };
    }
}

/** 更新进度说明 */
export async function updatePlanProgressNote(
    conversationUri: vscode.Uri,
    note: string,
): Promise<{ success: boolean; message: string }> {
    const planUri = await getPlanUri(conversationUri);
    if (!planUri) { return { success: false, message: '当前对话没有关联的执行计划' }; }
    try {
        const raw = Buffer.from(await vscode.workspace.fs.readFile(planUri)).toString('utf8');
        const { body } = extractFrontmatterAndBody(raw);
        const { steps } = parsePlanBody(body);
        const ok = await updateIssueMarkdownBody(planUri, serializePlanBody(note.trim(), steps));
        return { success: ok, message: ok ? '✅ 进度说明已更新' : '更新失败' };
    } catch (e) {
        logger.error('[PlanTools] updatePlanProgressNote 失败', e);
        return { success: false, message: '更新进度说明失败' };
    }
}

// ─── 群组相关 ───────────────────────────────────────────────

/** 获取所有群组（从类型索引查询，O(K)） */
export function getAllChatGroups(): ChatGroupInfo[] {
    const all = getIssueMarkdownsByType('chat_group');
    const groups: ChatGroupInfo[] = [];
    for (const md of all) {
        if (!md.frontmatter || md.frontmatter.chat_group !== true) { continue; }
        const fm = md.frontmatter as unknown as ChatGroupFrontmatter & FrontmatterData;
        groups.push({
            id: extractId(md.uri),
            name: fm.chat_group_name || md.title || '未命名群组',
            avatar: fm.chat_group_avatar || 'organization',
            memberIds: fm.chat_group_members || [],
            uri: md.uri,
        });
    }
    return groups;
}

/** 根据 ID 获取群组 */
export function getChatGroupById(groupId: string): ChatGroupInfo | undefined {
    const groups = getAllChatGroups();
    return groups.find(g => g.id === groupId);
}

/** 创建群组 */
export async function createChatGroup(
    name: string,
    memberIds: string[],
    avatar?: string,
): Promise<string | null> {
    const fm: Partial<FrontmatterData> & ChatGroupFrontmatter = {
        chat_group: true,
        chat_group_name: name,
        chat_group_members: memberIds,
        chat_group_avatar: avatar || 'organization',
    };
    const body = `# ${name}\n`;
    const uri = await createIssueMarkdown({ frontmatter: fm, markdownBody: body });
    if (!uri) { return null; }
    await createIssueNodes([uri]);
    return extractId(uri);
}

/** 获取群组下的所有对话（从类型索引查询，O(K)） */
export function getConversationsForGroup(groupId: string): ChatConversationInfo[] {
    const all = getIssueMarkdownsByType('chat_group_conversation');
    const convos: ChatConversationInfo[] = [];
    for (const md of all) {
        if (!md.frontmatter || md.frontmatter.chat_group_conversation !== true) { continue; }
        const fm = md.frontmatter as unknown as ChatGroupConversationFrontmatter & FrontmatterData;
        if (fm.chat_group_id !== groupId) { continue; }
        convos.push({
            id: extractId(md.uri),
            roleId: groupId,
            title: fm.chat_title || md.title || '未命名对话',
            uri: md.uri,
            mtime: md.mtime,
        });
    }
    convos.sort((a, b) => b.mtime - a.mtime);
    return convos;
}

/** 创建群组对话 */
export async function createGroupConversation(groupId: string, title?: string): Promise<vscode.Uri | null> {
    const group = getChatGroupById(groupId);
    const groupName = group?.name || '未知群组';
    const convoTitle = title || `${groupName} 的讨论`;

    const fm: Partial<FrontmatterData> & ChatGroupConversationFrontmatter = {
        chat_group_conversation: true,
        chat_group_id: groupId,
        chat_title: convoTitle,
    };
    const body = `# ${convoTitle}\n\n`;
    const uri = await createIssueMarkdown({ frontmatter: fm, markdownBody: body });
    if (uri) { await createIssueNodes([uri]); }
    return uri;
}

/** 从群组对话文件中解析消息（支持 ## Assistant:RoleName 格式，自动过滤末尾状态标记） */
export async function parseGroupConversationMessages(uri: vscode.Uri): Promise<ChatGroupMessage[]> {
    try {
        const content = Buffer.from(
            await vscode.workspace.fs.readFile(uri),
        ).toString('utf8');
        const { body } = extractFrontmatterAndBody(content);
        const cleanBody = stripMarker(body);
        return parseGroupMessagesFromBody(cleanBody);
    } catch (e) {
        logger.error('parseGroupConversationMessages 失败', e);
        return [];
    }
}

/** 向群组对话追加消息（assistant 消息带角色名） */
export async function appendGroupMessageToConversation(
    uri: vscode.Uri,
    role: 'user' | 'assistant',
    content: string,
    roleName?: string,
): Promise<void> {
    try {
        const raw = Buffer.from(
            await vscode.workspace.fs.readFile(uri),
        ).toString('utf8');

        const now = Date.now();
        const dateStr = formatTimestamp(now);
        const label = role === 'user'
            ? 'User'
            : `Assistant:${roleName || 'Unknown'}`;
        const block = `\n## ${label} (${dateStr})\n\n${content}\n`;

        const updated = raw + block;
        await vscode.workspace.fs.writeFile(uri, Buffer.from(updated, 'utf8'));
    } catch (e) {
        logger.error('appendGroupMessageToConversation 失败', e);
        throw e;
    }
}

/** 从 markdown body 解析群组消息列表 */
function parseGroupMessagesFromBody(body: string): ChatGroupMessage[] {
    const messages: ChatGroupMessage[] = [];
    // 匹配 ## User (...) 或 ## Assistant:RoleName (...)
    const regex = /^## (User|Assistant(?::([^\s(]+))?)\s*\(([^)]+)\)\s*$/gm;
    const sections: { role: 'user' | 'assistant'; roleName?: string; timestamp: number; startIndex: number }[] = [];

    let match: RegExpExecArray | null;
    while ((match = regex.exec(body)) !== null) {
        const isUser = match[1] === 'User';
        const roleName = match[2] || undefined; // capture group for role name after ':'
        const timestamp = parseTimestamp(match[3]) || Date.now();
        sections.push({
            role: isUser ? 'user' : 'assistant',
            roleName,
            timestamp,
            startIndex: match.index + match[0].length,
        });
    }

    for (let i = 0; i < sections.length; i++) {
        const start = sections[i].startIndex;
        const end = i + 1 < sections.length
            ? body.lastIndexOf('\n## ', sections[i + 1].startIndex)
            : body.length;
        const content = body.slice(start, end >= start ? end : body.length).trim();
        messages.push({
            role: sections[i].role,
            roleName: sections[i].roleName,
            content,
            timestamp: sections[i].timestamp,
        });
    }

    return messages;
}

// ─── 工具函数 ───────────────────────────────────────────────

/** 从 URI 提取 issue ID（文件名去掉 .md） */
function extractId(uri: vscode.Uri): string {
    const base = uri.fsPath.split('/').pop() || '';
    return base.replace(/\.md$/i, '');
}

/** 从 markdown body 解析消息列表 */
function parseMessagesFromBody(body: string): ChatMessage[] {
    const messages: ChatMessage[] = [];
    // 匹配 ## User (...) 或 ## Assistant (...)
    const regex = /^## (User|Assistant)\s*\(([^)]+)\)\s*$/gm;
    const sections: { role: 'user' | 'assistant'; timestamp: number; startIndex: number }[] = [];

    let match: RegExpExecArray | null;
    while ((match = regex.exec(body)) !== null) {
        const role = match[1].toLowerCase() === 'user' ? 'user' : 'assistant';
        const timestamp = parseTimestamp(match[2]) || Date.now();
        sections.push({ role, timestamp, startIndex: match.index + match[0].length });
    }

    for (let i = 0; i < sections.length; i++) {
        const start = sections[i].startIndex;
        const end = i + 1 < sections.length
            ? body.lastIndexOf('\n## ', sections[i + 1].startIndex)
            : body.length;
        const content = body.slice(start, end >= start ? end : body.length).trim();
        messages.push({
            role: sections[i].role,
            content,
            timestamp: sections[i].timestamp,
        });
    }

    return messages;
}

/** 格式化时间戳为可读字符串 */
function formatTimestamp(ts: number): string {
    const d = new Date(ts);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 解析时间字符串（支持 YYYY-MM-DD HH:mm:ss 格式） */
function parseTimestamp(str: string): number | null {
    const d = new Date(str.replace(/\s+/, 'T'));
    return isNaN(d.getTime()) ? null : d.getTime();
}

// ─── 执行日志 ───────────────────────────────────────────────

/** 默认最大保留条数 */
const DEFAULT_LOG_MAX_RUNS = 50;

/**
 * 获取或创建对话关联的执行日志文件。
 * 首次调用时自动创建日志文件并将 chat_log_id 写回对话 frontmatter。
 */
export async function getOrCreateExecutionLog(conversationUri: vscode.Uri): Promise<vscode.Uri | null> {
    try {
        const raw = Buffer.from(await vscode.workspace.fs.readFile(conversationUri)).toString('utf8');
        const { frontmatter } = extractFrontmatterAndBody(raw);
        if (!frontmatter) { return null; }

        const fm = frontmatter as Record<string, unknown>;
        const existingLogId = fm.chat_log_id as string | undefined;

        // 已有日志文件，直接返回
        if (existingLogId) {
            const dir = getIssueDir();
            if (!dir) { return null; }
            const logUri = vscode.Uri.file(path.join(dir, `${existingLogId}.md`));
            try {
                await vscode.workspace.fs.stat(logUri);
                return logUri;
            } catch {
                // 日志文件不存在，重新创建
            }
        }

        // 创建日志文件
        const convoId = extractId(conversationUri);
        const convoTitle = (fm.chat_title as string) || '对话';
        const logFm: Partial<FrontmatterData> & ChatExecutionLogFrontmatter = {
            chat_execution_log: true,
            chat_conversation_id: convoId,
            log_max_runs: DEFAULT_LOG_MAX_RUNS,
        };
        const body = `# 执行日志: ${convoTitle}\n\n`;
        const logUri = await createIssueMarkdown({ frontmatter: logFm, markdownBody: body });
        if (!logUri) { return null; }

        // 挂在对话的树节点下
        const convoNode = await getSingleIssueNodeByUri(conversationUri);
        await createIssueNodes([logUri], convoNode?.id);

        // 将 log_id 写回对话文件
        const logId = extractId(logUri);
        await updateIssueMarkdownFrontmatter(conversationUri, {
            chat_log_id: logId,
        } as Partial<FrontmatterData>);

        return logUri;
    } catch (e) {
        logger.error('getOrCreateExecutionLog 失败', e);
        return null;
    }
}

/**
 * 向执行日志追加一条运行记录。
 * 自动裁剪超出 log_max_runs 的旧记录。
 */
export async function appendExecutionRunRecord(
    logUri: vscode.Uri,
    record: ExecutionRunRecord,
): Promise<void> {
    try {
        const raw = Buffer.from(await vscode.workspace.fs.readFile(logUri)).toString('utf8');
        const { frontmatter } = extractFrontmatterAndBody(raw);
        const maxRuns = (frontmatter as Record<string, unknown>)?.log_max_runs as number ?? DEFAULT_LOG_MAX_RUNS;

        const block = formatRunRecord(record);
        let updated = raw + block;

        // 裁剪旧记录（保留最近 maxRuns 条）
        const runRegex = /\n## Run #\d+/g;
        const matches = [...updated.matchAll(runRegex)];
        if (matches.length > maxRuns) {
            const cutIndex = matches[matches.length - maxRuns].index!;
            // 保留 frontmatter + 标题行 + 最近的 maxRuns 条记录
            const headerEnd = updated.indexOf('\n## Run #');
            if (headerEnd >= 0 && cutIndex > headerEnd) {
                const header = updated.slice(0, headerEnd);
                const kept = updated.slice(cutIndex);
                updated = header + kept;
            }
        }

        await vscode.workspace.fs.writeFile(logUri, Buffer.from(updated, 'utf8'));
    } catch (e) {
        logger.error('appendExecutionRunRecord 失败', e);
    }
}

/** 获取执行日志的运行时信息 */
export async function getExecutionLogInfo(conversationUri: vscode.Uri): Promise<ChatExecutionLogInfo | null> {
    try {
        const raw = Buffer.from(await vscode.workspace.fs.readFile(conversationUri)).toString('utf8');
        const { frontmatter } = extractFrontmatterAndBody(raw);
        if (!frontmatter) { return null; }

        const fm = frontmatter as Record<string, unknown>;
        const logId = fm.chat_log_id as string | undefined;
        if (!logId) { return null; }

        const dir = getIssueDir();
        if (!dir) { return null; }
        const logUri = vscode.Uri.file(path.join(dir, `${logId}.md`));

        let logStat: vscode.FileStat;
        try {
            logStat = await vscode.workspace.fs.stat(logUri);
        } catch {
            return null;
        }

        const logRaw = Buffer.from(await vscode.workspace.fs.readFile(logUri)).toString('utf8');
        const successMatches = logRaw.match(/\*\*状态\*\*.*?→.*?success/g);
        const failMatches = logRaw.match(/\*\*状态\*\*.*?→.*?(?:error|retrying)/g);
        const runMatches = logRaw.match(/## Run #\d+/g);

        return {
            id: logId,
            conversationId: extractId(conversationUri),
            uri: logUri,
            mtime: logStat.mtime,
            totalRuns: runMatches?.length ?? 0,
            successCount: successMatches?.length ?? 0,
            failureCount: failMatches?.length ?? 0,
        };
    } catch (e) {
        logger.error('getExecutionLogInfo 失败', e);
        return null;
    }
}

/**
 * 聚合所有执行日志，返回最近 N 条 Run 条目（跨对话）。
 * 用于「最近活动」视图。
 */
export async function getRecentActivityEntries(limit = 30): Promise<RecentActivityEntry[]> {
    const allLogs = getIssueMarkdownsByType('chat_execution_log');
    const entries: RecentActivityEntry[] = [];

    for (const md of allLogs) {
        if (!md.frontmatter || md.frontmatter.chat_execution_log !== true) { continue; }
        const fm = md.frontmatter as unknown as ChatExecutionLogFrontmatter;
        const conversationId = fm.chat_conversation_id;

        let raw: string;
        try {
            raw = Buffer.from(await vscode.workspace.fs.readFile(md.uri)).toString('utf8');
        } catch { continue; }

        // 按 Run header 拆分（streaming 格式: ## Run #N (YYYY-MM-DD HH:mm:ss)，无 icon/summary）
        const runHeaderRe = /## Run #(\d+) \((\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\)/g;
        let match: RegExpExecArray | null;
        const runPositions: { runNumber: number; timestamp: number; startIdx: number }[] = [];

        while ((match = runHeaderRe.exec(raw)) !== null) {
            const ts = new Date(match[2].replace(' ', 'T')).getTime();
            runPositions.push({
                runNumber: Number(match[1]),
                timestamp: ts,
                startIdx: match.index,
            });
        }

        // 解析每个 run section 的上下文和结果
        for (let i = 0; i < runPositions.length; i++) {
            const h = runPositions[i];
            const nextStart = i + 1 < runPositions.length ? runPositions[i + 1].startIdx : raw.length;
            const section = raw.slice(h.startIdx, nextStart);

            // 上下文来自 startLogRun 写的首行: 📋 **开始执行** | 触发: X | 角色: Y | 模型: Z
            const ctxMatch = /📋 \*\*开始执行\*\* \| (.+)/.exec(section);
            let roleName: string | undefined;
            let modelFamily: string | undefined;
            let trigger: string | undefined;
            if (ctxMatch) {
                const parts = ctxMatch[1];
                const r = /角色: ([^|]+)/.exec(parts);
                const m = /模型: ([^|]+)/.exec(parts);
                const t = /触发: ([^|]+)/.exec(parts);
                roleName = r?.[1]?.trim();
                modelFamily = m?.[1]?.trim();
                trigger = t?.[1]?.trim();
            }

            // 成功/失败从 appendLogLine 写的结果行提取
            const hasSuccess = /✅ \*\*成功\*\*/.test(section);
            const hasFailure = /❌ \*\*失败/.test(section);
            const success = hasSuccess && !hasFailure;

            // 生成摘要
            let summary: string;
            if (hasSuccess) {
                const sm = /✅ \*\*成功\*\* \| (.+)/.exec(section);
                summary = sm ? `成功 | ${sm[1].trim()}` : '成功';
            } else if (hasFailure) {
                const fm2 = /❌ \*\*失败[^*]*\*\* \| (.+)/.exec(section);
                summary = fm2 ? `失败 | ${fm2[1].trim()}` : '失败';
            } else {
                // 可能仍在执行中
                summary = '执行中…';
            }

            entries.push({
                runNumber: h.runNumber,
                timestamp: h.timestamp,
                conversationId,
                logUri: md.uri,
                roleName,
                modelFamily,
                trigger,
                success,
                summary,
            });
        }
    }

    // 按时间倒序，取前 N 条
    entries.sort((a, b) => b.timestamp - a.timestamp);
    return entries.slice(0, limit);
}

/** 格式化单条执行记录为 markdown */
function formatRunRecord(record: ExecutionRunRecord): string {
    const ts = formatTimestamp(record.startedAt);
    const icon = record.success ? '✅' : '❌';
    const totalTokens = record.inputTokens + record.outputTokens;
    const durationStr = record.duration >= 1000
        ? `${(record.duration / 1000).toFixed(1)}s`
        : `${record.duration}ms`;

    // 标题行：序号 + 时间 + 结果图标 + 一句话摘要
    const summary = record.success
        ? `成功（${durationStr}，${totalTokens} tokens）`
        : `失败：${record.errorMessage || '未知错误'}`;
    let md = `\n## Run #${record.runNumber} (${ts}) ${icon} ${summary}\n\n`;

    // 上下文信息块
    const triggerLabel = record.trigger === 'timer' ? '定时器' : record.trigger === 'save' ? '保存触发' : '用户直接发送';
    md += `| 项目 | 值 |\n|------|------|\n`;
    md += `| 触发方式 | ${triggerLabel} |\n`;
    if (record.roleName) {
        md += `| 角色 | ${record.roleName} |\n`;
    }
    if (record.modelFamily) {
        md += `| 模型 | ${record.modelFamily} |\n`;
    }
    if (record.maxTokens !== undefined) {
        md += `| Token 上限 | ${record.maxTokens || '无限制'} |\n`;
    }
    if (record.timeout !== undefined) {
        md += `| 超时 | ${record.timeout / 1000}s |\n`;
    }
    md += `| 状态轨迹 | ${record.stateTrace} |\n`;
    md += `| 耗时 | ${durationStr} |\n`;
    md += `| Token 消耗 | input ${record.inputTokens} + output ${record.outputTokens} = ${totalTokens} |\n`;

    if (record.retryCount > 0) {
        md += `| 重试次数 | ${record.retryCount} |\n`;
    }

    md += '\n';

    // 错误详情（独立块，醒目）
    if (record.errorMessage) {
        md += `> **错误详情**: ${record.errorMessage}\n\n`;
    }

    // 工具调用明细
    if (record.toolCalls.length > 0) {
        md += `**工具调用** (${record.toolCalls.length} 次):\n\n`;
        for (let i = 0; i < record.toolCalls.length; i++) {
            const tc = record.toolCalls[i];
            md += `${i + 1}. \`${tc.tool}\` (${tc.duration}ms)\n`;
            md += `   - 输入: ${tc.inputSummary}\n`;
            md += `   - 结果: ${tc.resultSummary}\n`;
        }
        md += '\n';
    }

    return md;
}

/** 计算日志文件中的下一个 run 编号 */
export async function getNextRunNumber(logUri: vscode.Uri): Promise<number> {
    try {
        const raw = Buffer.from(await vscode.workspace.fs.readFile(logUri)).toString('utf8');
        const matches = [...raw.matchAll(/## Run #(\d+)/g)];
        if (matches.length === 0) { return 1; }
        const maxNum = Math.max(...matches.map(m => parseInt(m[1], 10)));
        return maxNum + 1;
    } catch {
        return 1;
    }
}

// ─── 增量事件日志 ─────────────────────────────────────────────

/** 开始新的 Run 条目并写入标题 + 上下文行，返回 runNumber */
export async function startLogRun(logUri: vscode.Uri, context: {
    trigger?: 'timer' | 'direct' | 'save';
    roleName?: string;
    modelFamily?: string;
    timeout?: number;
    maxTokens?: number;
    retryCount?: number;
}): Promise<number> {
    // 先裁剪旧记录
    await trimLogRuns(logUri);

    const runNumber = await getNextRunNumber(logUri);
    const date = new Date();
    const dateStr = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${formatTimeHMS(date)}`;
    const timeStr = formatTimeHMS(date);

    const triggerLabel = context.trigger === 'timer' ? '定时器'
        : context.trigger === 'save' ? '保存触发' : '直接发送';

    const parts: string[] = [`触发: ${triggerLabel}`];
    if (context.roleName) { parts.push(`角色: ${context.roleName}`); }
    if (context.modelFamily) { parts.push(`模型: ${context.modelFamily}`); }
    if (context.timeout != null) { parts.push(`超时: ${context.timeout / 1000}s`); }
    if (context.maxTokens) { parts.push(`Token 上限: ${context.maxTokens}`); }
    if (context.retryCount && context.retryCount > 0) { parts.push(`重试 #${context.retryCount}`); }

    const header = `\n## Run #${runNumber} (${dateStr})\n\n`;
    const firstLine = `- \`${timeStr}\` 📋 **开始执行** | ${parts.join(' | ')}\n`;

    await appendRawToLog(logUri, header + firstLine);
    return runNumber;
}

/** 向日志文件追加一行带时间戳的事件 */
export async function appendLogLine(logUri: vscode.Uri, line: string): Promise<void> {
    const ts = formatTimeHMS(new Date());
    await appendRawToLog(logUri, `- \`${ts}\` ${line}\n`);
}

/** 向日志文件末尾追加原始文本 */
async function appendRawToLog(logUri: vscode.Uri, text: string): Promise<void> {
    try {
        const raw = Buffer.from(await vscode.workspace.fs.readFile(logUri)).toString('utf8');
        await vscode.workspace.fs.writeFile(logUri, Buffer.from(raw + text, 'utf8'));
    } catch (e) {
        logger.warn('appendRawToLog 失败', e);
    }
}

/** 裁剪旧的 Run 条目，保留最近 maxRuns 条 */
async function trimLogRuns(logUri: vscode.Uri): Promise<void> {
    try {
        const raw = Buffer.from(await vscode.workspace.fs.readFile(logUri)).toString('utf8');
        const { frontmatter } = extractFrontmatterAndBody(raw);
        const maxRuns = (frontmatter as Record<string, unknown>)?.log_max_runs as number ?? DEFAULT_LOG_MAX_RUNS;

        const runRegex = /\n## Run #\d+/g;
        const matches = [...raw.matchAll(runRegex)];
        // 仅当已有 maxRuns 条时才裁剪（为新 run 腾空间）
        if (matches.length >= maxRuns) {
            const keepFrom = matches.length - maxRuns + 1; // 保留最近 maxRuns-1 条 + 即将新增的 1 条
            const cutIndex = matches[keepFrom].index!;
            const headerEnd = raw.indexOf('\n## Run #');
            if (headerEnd >= 0 && cutIndex > headerEnd) {
                const header = raw.slice(0, headerEnd);
                const kept = raw.slice(cutIndex);
                await vscode.workspace.fs.writeFile(logUri, Buffer.from(header + kept, 'utf8'));
            }
        }
    } catch { /* 裁剪失败不影响主流程 */ }
}

function pad2(n: number): string { return n.toString().padStart(2, '0'); }
function formatTimeHMS(d: Date): string {
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// ─── 工具调用详情节点 ─────────────────────────────────────────

/** 创建工具调用节点的元数据 */
export interface ToolCallNodeMeta {
    /** 工具调用是否成功 */
    success: boolean;
    /** 工具描述（来自工具定义） */
    description?: string;
    /** 本次 Run 中的调用序号 */
    sequence: number;
    /** Run 编号 */
    runNumber: number;
}

/**
 * 为单次工具调用创建独立的 issueMarkdown 节点，挂在执行日志下。
 * 包含完整的输入 JSON 和输出内容，以及工具元数据。
 * @returns 文件名（如 `20260310-232134-xxx.md`），用于在执行日志中生成链接；失败时返回 null
 */
export async function createToolCallNode(
    logUri: vscode.Uri,
    toolName: string,
    input: unknown,
    output: string,
    durationMs: number,
    meta: ToolCallNodeMeta,
): Promise<string | null> {
    try {
        const logId = extractId(logUri);
        const ts = formatTimeHMS(new Date());
        const durLabel = durationMs >= 1000 ? `${(durationMs / 1000).toFixed(1)}s` : `${durationMs}ms`;
        const statusIcon = meta.success === false ? '❌' : '✅';

        let inputStr: string;
        try { inputStr = JSON.stringify(input, null, 2); } catch { inputStr = String(input); }

        const outputLen = output.length;
        const outputLenLabel = outputLen >= 1024
            ? `${(outputLen / 1024).toFixed(1)}KB`
            : `${outputLen}字符`;

        const title = `#${meta.sequence} ${toolName} (${durLabel}) ${statusIcon}`;

        const fm: Partial<FrontmatterData> & ChatToolCallFrontmatter = {
            chat_tool_call: true,
            chat_log_id: logId,
            run_number: meta.runNumber,
            tool_name: toolName,
            tool_success: meta.success,
            tool_duration: durationMs,
            call_sequence: meta.sequence,
        };

        const infoParts: string[] = [];
        if (meta.description) { infoParts.push(meta.description); }
        infoParts.push(`输出 ${outputLenLabel}`);
        infoParts.push(ts);

        let body = `# ${title}\n\n`;
        body += `> ${infoParts.join(' | ')}\n\n`;
        body += `## 输入\n\n\`\`\`json\n${inputStr}\n\`\`\`\n\n`;
        body += `## 输出\n\n${output}\n`;

        const uri = await createIssueMarkdown({ frontmatter: fm, markdownBody: body });
        if (!uri) { return null; }

        // 挂在执行日志的树节点下
        const logNode = await getSingleIssueNodeByUri(logUri);
        await createIssueNodes([uri], logNode?.id);

        return path.basename(uri.fsPath);
    } catch (e) {
        logger.warn('createToolCallNode 失败', e);
        return null;
    }
}

// ─── Chrome 面板聊天 ─────────────────────────────────────────

/** 根据 ID 构造对话文件 URI */
function chromeChatUri(id: string): vscode.Uri | null {
    const dir = getIssueDir();
    if (!dir) { return null; }
    return vscode.Uri.file(path.join(dir, `${id}.md`));
}

/** 获取所有 Chrome 面板聊天对话（从类型索引查询，O(K)） */
export function getAllChromeChatConversations(): ChromeChatInfo[] {
    const all = getIssueMarkdownsByType('chrome_chat');
    const convos: ChromeChatInfo[] = [];
    for (const md of all) {
        if (!md.frontmatter || (md.frontmatter as any).chrome_chat !== true) { continue; }
        const fm = md.frontmatter as unknown as ChromeChatFrontmatter & FrontmatterData;
        convos.push({
            id: extractId(md.uri),
            title: fm.chat_title || md.title || '新对话',
            mtime: md.mtime,
        });
    }
    convos.sort((a, b) => b.mtime - a.mtime);
    return convos;
}

/** 创建新的 Chrome 面板聊天对话，返回 { id, title, mtime } */
export async function createChromeChatConversation(title?: string): Promise<ChromeChatInfo | null> {
    const convoTitle = title || '新对话';
    const fm: Partial<FrontmatterData> & ChromeChatFrontmatter = {
        chrome_chat: true,
        chat_title: convoTitle,
    };
    const body = `# ${convoTitle}\n\n`;
    const uri = await createIssueMarkdown({ frontmatter: fm, markdownBody: body });
    if (!uri) { return null; }
    await createIssueNodes([uri]);
    return {
        id: extractId(uri),
        title: convoTitle,
        mtime: Date.now(),
    };
}

/** 删除 Chrome 面板聊天对话 */
export async function deleteChromeChatConversation(id: string): Promise<boolean> {
    const uri = chromeChatUri(id);
    if (!uri) { return false; }
    try {
        await vscode.workspace.fs.delete(uri);
        return true;
    } catch (e) {
        logger.error('deleteChromeChatConversation 失败', e);
        return false;
    }
}

/** 重命名 Chrome 面板聊天对话 */
export async function renameChromeChatConversation(id: string, newTitle: string): Promise<boolean> {
    const uri = chromeChatUri(id);
    if (!uri) { return false; }
    try {
        await updateIssueMarkdownFrontmatter(uri, { chat_title: newTitle } as any);
        return true;
    } catch (e) {
        logger.error('renameChromeChatConversation 失败', e);
        return false;
    }
}

/** 获取 Chrome 面板聊天对话的消息列表 */
export async function getChromeChatMessages(id: string): Promise<ChatMessage[]> {
    const uri = chromeChatUri(id);
    if (!uri) { return []; }
    return parseConversationMessages(uri);
}

/** 向 Chrome 面板聊天对话追加消息 */
export async function appendChromeChatMessage(
    id: string,
    role: 'user' | 'assistant',
    content: string,
): Promise<boolean> {
    const uri = chromeChatUri(id);
    if (!uri) { return false; }
    try {
        await appendMessageToConversation(uri, role, content);
        return true;
    } catch (e) {
        logger.error('appendChromeChatMessage 失败', e);
        return false;
    }
}
