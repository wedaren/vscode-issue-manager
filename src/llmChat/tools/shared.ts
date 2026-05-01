/**
 * 工具系统的纯辅助函数和常量
 */
import * as path from 'path';
import { getAllChatRoles } from '../llmChatDataManager';
import type { ChatRoleInfo } from '../types';

/** 生成 issueMarkdown 链接，使用约定前缀 IssueDir/，消费方按需替换为真实路径 */
export function issueLink(title: string, fileName: string): string {
    return `[\`${title}\`](IssueDir/${fileName})`;
}

/**
 * 规范化文件名：IssueDir/ 是真实 issue 目录的缩写，将其剥离后得到相对于
 * issueDir 的路径。同时兼容 LLM 传入真实绝对路径的情况（取 basename）。
 */
export function normalizeFileName(name: string, issueDir?: string): string {
    // IssueDir/ 是 issueDir 的约定缩写，直接剥离该前缀
    if (name.startsWith('IssueDir/')) {
        return name.slice('IssueDir/'.length);
    }
    // 兼容 LLM 传入真实绝对路径
    if (issueDir && name.startsWith(issueDir + path.sep)) {
        return path.relative(issueDir, name);
    }
    // 其余情况：可能是纯文件名或带其他前缀，取 basename 兜底
    return path.basename(name);
}

/** type 参数值 → frontmatter 类型索引键的映射 */
export const TYPE_FILTER_MAP: Record<string, string> = {
    role: 'chat_role',
    conversation: 'chat_conversation',
    log: 'chat_execution_log',
    tool_call: 'chat_tool_call',
    group: 'chat_group',
    memory: 'role_memory',
    chrome_chat: 'chrome_chat',
};

/** 从 frontmatter 提取文件类型的显示标签 */
export function getTypeTag(fm: Record<string, unknown> | null): string {
    if (!fm) { return '笔记'; }
    if (fm.chat_role) { return '角色'; }
    if (fm.chat_conversation) { return '对话'; }
    if (fm.chat_execution_log) { return '日志'; }
    if (fm.chat_tool_call) { return '工具调用'; }
    if (fm.chat_group) { return '群组'; }
    if (fm.role_memory) { return '记忆'; }
    if (fm.chrome_chat) { return '浏览器对话'; }
    return '笔记';
}

/** 提取关键词周围的上下文片段（前后各取一部分） */
export function extractSnippet(text: string, keyword: string, contextChars = 40): string | null {
    const lower = text.toLowerCase();
    const idx = lower.indexOf(keyword.toLowerCase());
    if (idx === -1) { return null; }
    const start = Math.max(0, idx - contextChars);
    const end = Math.min(text.length, idx + keyword.length + contextChars);
    let snippet = text.slice(start, end).replace(/\n+/g, ' ').trim();
    if (start > 0) { snippet = '…' + snippet; }
    if (end < text.length) { snippet += '…'; }
    return snippet;
}

/** 计算子串出现次数 */
export function countOccurrences(text: string, sub: string): number {
    if (!sub) { return 0; }
    let count = 0;
    let pos = 0;
    while ((pos = text.indexOf(sub, pos)) !== -1) {
        count++;
        pos += sub.length;
    }
    return count;
}

/** 将时间戳格式化为相对时间描述 */
export function formatAge(mtime: number): string {
    const diff = Date.now() - mtime;
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) { return '刚刚'; }
    if (mins < 60) { return `${mins}分钟前`; }
    const hours = Math.floor(mins / 60);
    if (hours < 24) { return `${hours}小时前`; }
    const days = Math.floor(hours / 24);
    return `${days}天前`;
}

/** 按名称或 ID 查找角色 */
export async function findRole(nameOrId: string): Promise<ChatRoleInfo | undefined> {
    const roles = await getAllChatRoles();
    const lower = nameOrId.toLowerCase();
    return roles.find(r =>
        r.id === nameOrId
        || r.name === nameOrId
        || r.name.toLowerCase() === lower,
    );
}
