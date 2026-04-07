/**
 * 对话消息构建模块
 *
 * 将 uri + role 组装为 LLM 请求所需的 messages 数组。
 * LLMChatService（UI 交互路径）和 RoleTimerManager（定时器路径）共用此实现。
 *
 * 上下文策略：contextPipeline — 角色声明所需上下文，管道并行获取并组装。
 */
import * as vscode from 'vscode';
import {
    getRoleSystemPrompt,
    getConversationConfig,
    parseConversationMessages,
    estimateTokens,
    getChatRoleById,
} from './llmChatDataManager';
import type { ChatRoleInfo } from './types';
import { runContextPipeline } from './contextPipeline';

/**
 * 为单角色对话构建 LLM 请求消息列表。
 *
 * 当历史 token 超过 maxTokens 的 70% 时，启用滑动窗口截断：
 *   保留第 1 轮（原始任务）+ 最近 N 轮，中间插入省略占位符。
 */
export async function buildConversationMessages(
    uri: vscode.Uri,
    role: ChatRoleInfo,
): Promise<vscode.LanguageModelChatMessage[]> {
    // ─── 基础数据 ────────────────────────────────────────────
    const prompt = await getRoleSystemPrompt(role.uri);
    const convoConfig = await getConversationConfig(uri);
    const autonomous = convoConfig?.autonomous ?? role.autonomous ?? false;
    const history = await parseConversationMessages(uri);

    let identity = prompt || '你是一个智能助手，请根据对话上下文给出有帮助的回复。';

    // ─── 群组协调者：注入成员名称列表 ────────────────────────
    if (role.groupMembers?.length) {
        const members = role.groupMembers
            .map(id => getChatRoleById(id))
            .filter((r): r is ChatRoleInfo => !!r);
        if (members.length) {
            const memberList = members.map(m => `- ${m.name}`).join('\n');
            identity += `\n\n## 你的团队成员\n${memberList}\n\n调用 ask_group_member 时，memberName 必须是以上名称之一（精确匹配）。`;
        }
    }

    // ─── 上下文管道 ──────────────────────────────────────────
    const maxTokens = convoConfig?.maxTokens ?? role.maxTokens;
    const latestUserMessage = getLatestUserMessage(history);
    const result = await runContextPipeline(
        identity,
        uri,
        role,
        convoConfig,
        autonomous,
        latestUserMessage,
        history.length > 0,
        maxTokens,
    );

    const systemMsg = vscode.LanguageModelChatMessage.User(result.systemPrompt);

    // ─── 历史消息 ─────────────────────────────────────────────
    const rounds = groupRounds(history);

    // 无 token 预算限制 或 轮次 ≤ 3 时，不截断
    if (!maxTokens || rounds.length <= 3) {
        return [systemMsg, ...roundsToMessages(rounds)];
    }

    // 预估全量 token
    const fullMsgs = [systemMsg, ...roundsToMessages(rounds)];
    const fullTokens = await estimateTokens(fullMsgs);
    const threshold = maxTokens * 0.7;

    if (fullTokens <= threshold) {
        return fullMsgs;
    }

    // 截断：保留第 1 轮 + 最近 N 轮，逐步增加 N 直到接近阈值
    const firstRound = rounds[0];
    let bestN = 1;

    for (let n = 1; n < rounds.length; n++) {
        const tail = rounds.slice(-n);
        const candidate = [
            systemMsg,
            ...roundsToMessages([firstRound]),
            vscode.LanguageModelChatMessage.User(`[...已省略 ${rounds.length - 1 - n} 轮对话...]`),
            ...roundsToMessages(tail),
        ];
        const est = await estimateTokens(candidate);
        if (est > threshold) { break; }
        bestN = n;
    }

    const kept = rounds.slice(-bestN);
    const omitted = rounds.length - 1 - bestN;
    const msgs = [systemMsg, ...roundsToMessages([firstRound])];
    if (omitted > 0) {
        msgs.push(vscode.LanguageModelChatMessage.User(`[...已省略 ${omitted} 轮对话...]`));
    }
    msgs.push(...roundsToMessages(kept));

    return msgs;
}

// ━━━ 辅助函数 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface ChatMsg { role: 'user' | 'assistant'; content: string }
interface Round { user: ChatMsg; assistant?: ChatMsg }

/** 从历史消息中提取最新用户消息（用于意图分类） */
function getLatestUserMessage(history: ChatMsg[]): string {
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].role === 'user') { return history[i].content; }
    }
    return '';
}

/** 将消息按轮次分组（一组 = user + assistant） */
function groupRounds(history: ChatMsg[]): Round[] {
    const rounds: Round[] = [];
    for (let i = 0; i < history.length; i++) {
        const m = history[i];
        if (m.role === 'user') {
            const next = history[i + 1];
            if (next?.role === 'assistant') {
                rounds.push({ user: m, assistant: next });
                i++;
            } else {
                rounds.push({ user: m });
            }
        }
    }
    return rounds;
}

/** 将轮次数组转为 LanguageModelChatMessage 数组 */
function roundsToMessages(rounds: Round[]): vscode.LanguageModelChatMessage[] {
    const msgs: vscode.LanguageModelChatMessage[] = [];
    for (const r of rounds) {
        msgs.push(vscode.LanguageModelChatMessage.User(r.user.content));
        if (r.assistant) {
            msgs.push(vscode.LanguageModelChatMessage.Assistant(r.assistant.content));
        }
    }
    return msgs;
}
