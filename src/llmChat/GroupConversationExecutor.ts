/**
 * 群组对话工具函数
 *
 * 提供协调者 Agent 模式下的成员消息构建与写入工具。
 * 成员对话文件由 ask_group_member 工具创建和维护，
 * 与协调者对话文件分开存储，可积累跨 session 上下文。
 */
import * as vscode from 'vscode';
import type { ChatRoleInfo } from './types';
import { parseConversationMessages, getRoleSystemPrompt } from './llmChatDataManager';
import { stripMarker } from './convStateMarker';

// ─── 协调者 Agent 模式：成员消息构建 ─────────────────────────

/**
 * 构造成员在协调者 Agent 模式下的 LLM 消息列表。
 *
 * 历史从成员自己的群组专属对话文件读取（而非协调者文件），
 * 成员可积累跨 session 的任务上下文。
 * 新任务（来自协调者）作为最终 User 消息追加。
 */
export async function buildMemberMessagesForCoordinator(
    memberConvUri: vscode.Uri,
    member: ChatRoleInfo,
    allMembers: ChatRoleInfo[],
    task: string,
): Promise<vscode.LanguageModelChatMessage[]> {
    const msgs: vscode.LanguageModelChatMessage[] = [];

    // 1. 成员自身的 system prompt
    const memberPrompt = await getRoleSystemPrompt(member.uri);
    if (memberPrompt) {
        msgs.push(vscode.LanguageModelChatMessage.User(`[系统指令] ${memberPrompt}`));
    }

    // 2. 群组上下文
    const otherNames = allMembers.filter(m => m.id !== member.id).map(m => m.name);
    let groupCtx = `[群组讨论] 你正在参与群组讨论，你的角色是「${member.name}」。`;
    if (otherNames.length > 0) {
        groupCtx += `其他参与者：${otherNames.join('、')}。`;
    }
    groupCtx += '你由协调者委派任务，根据职责自主完成后回复。';
    msgs.push(vscode.LanguageModelChatMessage.User(groupCtx));

    // 3. 成员在本群组中的历史对话（来自成员专属对话文件）
    const history = await parseConversationMessages(memberConvUri);
    for (const m of history) {
        if (m.role === 'user') {
            msgs.push(vscode.LanguageModelChatMessage.User(m.content));
        } else {
            msgs.push(vscode.LanguageModelChatMessage.Assistant(m.content));
        }
    }

    // 4. 来自协调者的新任务
    msgs.push(vscode.LanguageModelChatMessage.User(task));

    return msgs;
}

/**
 * 向成员的群组专属对话文件追加一条消息（user 或 assistant）。
 * 自动剥离末尾状态标记，写入标准 ## User / ## Assistant 格式。
 * 成员文件不受定时器管理，无需写入状态标记。
 */
export async function appendToMemberConversation(
    uri: vscode.Uri,
    role: 'user' | 'assistant',
    content: string,
): Promise<void> {
    const raw = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    const stripped = stripMarker(raw);
    const dateStr = formatTimestamp(Date.now());
    const label = role === 'user' ? 'User' : 'Assistant';
    const block = `\n\n## ${label} (${dateStr})\n\n${content}\n`;
    await vscode.workspace.fs.writeFile(uri, Buffer.from(stripped + block, 'utf8'));
}

export function formatTimestamp(ts: number): string {
    const d = new Date(ts);
    const p = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
