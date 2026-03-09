/**
 * LLM 聊天数据管理器
 *
 * 负责从 issueMarkdown 文件中读取/写入聊天角色和对话数据。
 */
import * as vscode from 'vscode';
import * as path from 'path';
import {
    getAllIssueMarkdowns,
    extractFrontmatterAndBody,
    createIssueMarkdown,
    updateIssueMarkdownFrontmatter,
} from '../data/IssueMarkdowns';
import type { FrontmatterData } from '../data/IssueMarkdowns';
import { createIssueNodes } from '../data/issueTreeManager';
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
} from './types';
import { stripMarker } from './convStateMarker';
import { Logger } from '../core/utils/Logger';

const logger = Logger.getInstance();

// ─── 角色相关 ───────────────────────────────────────────────

/** 从所有 issueMarkdown 中筛选出聊天角色 */
export async function getAllChatRoles(): Promise<ChatRoleInfo[]> {
    const all = await getAllIssueMarkdowns();
    const roles: ChatRoleInfo[] = [];
    for (const md of all) {
        if (!md.frontmatter || md.frontmatter.chat_role !== true) {
            continue;
        }
        const fm = md.frontmatter as unknown as ChatRoleFrontmatter & FrontmatterData;
        roles.push({
            id: extractId(md.uri),
            name: fm.chat_role_name || md.title || '未命名角色',
            avatar: fm.chat_role_avatar || 'hubot',
            systemPrompt: fm.chat_role_system_prompt || '',
            modelFamily: fm.chat_role_model_family,
            uri: md.uri,
            // ─── 定时器配置 ───────────────────────────────────
            timerEnabled: fm.timer_enabled === true,
            timerInterval: fm.timer_interval,
            timerMaxConcurrent: fm.timer_max_concurrent,
            timerTimeout: fm.timer_timeout,
            timerMaxRetries: fm.timer_max_retries,
            timerRetryDelay: fm.timer_retry_delay,
        });
    }
    return roles;
}

/** 根据 ID 获取单个角色 */
export async function getChatRoleById(roleId: string): Promise<ChatRoleInfo | undefined> {
    const roles = await getAllChatRoles();
    return roles.find(r => r.id === roleId);
}

/** 创建新的聊天角色文件，返回角色 ID */
export async function createChatRole(
    name: string,
    systemPrompt: string,
    avatar?: string,
    modelFamily?: string,
): Promise<string | null> {
    const fm: Partial<FrontmatterData> & ChatRoleFrontmatter = {
        chat_role: true,
        chat_role_name: name,
        chat_role_avatar: avatar || 'hubot',
        chat_role_system_prompt: systemPrompt,
        // ─── 定时器配置（默认关闭，按需开启） ────────────────
        timer_enabled: false,
        timer_interval: 30000,
        timer_max_concurrent: 2,
        timer_timeout: 60000,
        timer_max_retries: 3,
        timer_retry_delay: 5000,
    };
    if (modelFamily) {
        fm.chat_role_model_family = modelFamily;
    }

    const body = `# ${name}\n`;
    const uri = await createIssueMarkdown({ frontmatter: fm, markdownBody: body });
    if (!uri) {
        return null;
    }
    await createIssueNodes([uri]);
    return extractId(uri);
}

// ─── 对话相关 ───────────────────────────────────────────────

/** 获取某角色下的所有对话 */
export async function getConversationsForRole(roleId: string): Promise<ChatConversationInfo[]> {
    const all = await getAllIssueMarkdowns();
    const convos: ChatConversationInfo[] = [];
    for (const md of all) {
        if (!md.frontmatter || md.frontmatter.chat_conversation !== true) {
            continue;
        }
        const fm = md.frontmatter as unknown as ChatConversationFrontmatter & FrontmatterData;
        if (fm.chat_role_id !== roleId) {
            continue;
        }
        convos.push({
            id: extractId(md.uri),
            roleId: fm.chat_role_id,
            title: fm.chat_title || md.title || '未命名对话',
            uri: md.uri,
            mtime: md.mtime,
        });
    }
    // 按最后修改时间降序
    convos.sort((a, b) => b.mtime - a.mtime);
    return convos;
}

/** 创建新的对话文件 */
export async function createConversation(roleId: string, title?: string): Promise<vscode.Uri | null> {
    const role = await getChatRoleById(roleId);
    const roleName = role?.name || '未知角色';
    const convoTitle = title || `与 ${roleName} 的对话`;

    const fm: Partial<FrontmatterData> & ChatConversationFrontmatter = {
        chat_conversation: true,
        chat_role_id: roleId,
        chat_title: convoTitle,
    };

    const body = `# ${convoTitle}\n\n`;
    const uri = await createIssueMarkdown({ frontmatter: fm, markdownBody: body });
    if (uri) { await createIssueNodes([uri]); }
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

        // 清除旧状态标记
        const stripped = stripMarker(raw);
        const dateStr = formatTimestamp(Date.now());
        const block = `\n## User (${dateStr})\n\n${content}\n\n<!-- llm:queued -->\n`;

        await vscode.workspace.fs.writeFile(uri, Buffer.from(stripped + block, 'utf8'));
    } catch (e) {
        logger.error('appendUserMessageQueued 失败', e);
        throw e;
    }
}

// ─── 群组相关 ───────────────────────────────────────────────

/** 获取所有群组 */
export async function getAllChatGroups(): Promise<ChatGroupInfo[]> {
    const all = await getAllIssueMarkdowns();
    const groups: ChatGroupInfo[] = [];
    for (const md of all) {
        if (!md.frontmatter || md.frontmatter.chat_group !== true) {
            continue;
        }
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
export async function getChatGroupById(groupId: string): Promise<ChatGroupInfo | undefined> {
    const groups = await getAllChatGroups();
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

/** 获取群组下的所有对话 */
export async function getConversationsForGroup(groupId: string): Promise<ChatConversationInfo[]> {
    const all = await getAllIssueMarkdowns();
    const convos: ChatConversationInfo[] = [];
    for (const md of all) {
        if (!md.frontmatter || md.frontmatter.chat_group_conversation !== true) {
            continue;
        }
        const fm = md.frontmatter as unknown as ChatGroupConversationFrontmatter & FrontmatterData;
        if (fm.chat_group_id !== groupId) {
            continue;
        }
        convos.push({
            id: extractId(md.uri),
            roleId: groupId, // 复用 roleId 字段存放 groupId
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
    const group = await getChatGroupById(groupId);
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

// ─── Chrome 面板聊天 ─────────────────────────────────────────

/** 根据 ID 构造对话文件 URI */
function chromeChatUri(id: string): vscode.Uri | null {
    const dir = getIssueDir();
    if (!dir) { return null; }
    return vscode.Uri.file(path.join(dir, `${id}.md`));
}

/** 获取所有 Chrome 面板聊天对话（按 mtime 降序） */
export async function getAllChromeChatConversations(): Promise<ChromeChatInfo[]> {
    const all = await getAllIssueMarkdowns();
    const convos: ChromeChatInfo[] = [];
    for (const md of all) {
        if (!md.frontmatter || (md.frontmatter as any).chrome_chat !== true) {
            continue;
        }
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
