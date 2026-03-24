/**
 * 对话消息构建模块
 *
 * 将 uri + role 组装为 LLM 请求所需的 messages 数组。
 * LLMChatService（UI 交互路径）和 RoleTimerManager（定时器路径）共用此实现，
 * 保证两条路径注入相同的上下文（意图锚点、执行计划、记忆、滑动窗口截断）。
 */
import * as vscode from 'vscode';
import {
    getRoleSystemPrompt,
    getConversationConfig,
    readPlanForInjection,
    readAutoMemoryForInjection,
    parseConversationMessages,
    estimateTokens,
} from './llmChatDataManager';
import type { ChatRoleInfo } from './types';

/**
 * 为单角色对话构建 LLM 请求消息列表。
 *
 * 注入顺序：
 *   [系统指令] → [当前任务/意图锚点] → [执行计划] → [执行模式] → [自动提取记忆] → history
 *
 * 当历史 token 超过 maxTokens 的 70% 时，启用滑动窗口截断：
 *   保留第 1 轮（原始任务）+ 最近 N 轮，中间插入省略占位符。
 */
export async function buildConversationMessages(
    uri: vscode.Uri,
    role: ChatRoleInfo,
): Promise<vscode.LanguageModelChatMessage[]> {
    // ─── System Prompt ────────────────────────────────────────
    const prompt = await getRoleSystemPrompt(role.uri);
    let systemText = prompt
        ? `[系统指令] ${prompt}`
        : '[系统指令] 你是一个智能助手，请根据对话上下文给出有帮助的回复。';

    // ─── 意图锚点 ──────────────────────────────────────────────
    const convoConfig = await getConversationConfig(uri);
    if (convoConfig?.intent) {
        systemText += `\n\n[当前任务] ${convoConfig.intent}`;
    }

    // 优先级：对话 > 角色，均未设置时默认 false（交互模式）
    const autonomous = convoConfig?.autonomous ?? role.autonomous ?? false;

    // ─── 执行计划 ──────────────────────────────────────────────
    if (role.toolSets.includes('planning')) {
        const planContext = await readPlanForInjection(uri, autonomous);
        if (planContext) {
            systemText += `\n\n${planContext}`;
        }
    }

    // ─── 执行模式 ──────────────────────────────────────────────
    if (autonomous) {
        systemText += '\n\n[执行模式: 自主] 当前为自主执行模式，用户不在场。'
            + '你应该独立思考、主动调用工具完成任务，不要等待用户确认。'
            + '遇到不明确的地方自行做出合理决策，完成后在回复中说明你的决策和理由。';
    } else {
        systemText += '\n\n[执行模式: 交互] 当前为交互对话模式，用户在场。'
            + '执行破坏性操作（修改角色配置、删除笔记、大规模变更）前应征求用户确认。'
            + '常规的信息查询、笔记创建、分析建议等可直接执行。';
    }

    // ─── 自动提取记忆 ─────────────────────────────────────────
    const autoMemory = await readAutoMemoryForInjection(role.id);
    if (autoMemory) {
        systemText += `\n\n${autoMemory}`;
    }

    const systemMsg = vscode.LanguageModelChatMessage.User(systemText);

    // ─── 历史消息 ─────────────────────────────────────────────
    const history = await parseConversationMessages(uri);

    // 将消息按轮次分组（一组 = user + assistant）
    const rounds: Array<{ user: typeof history[0]; assistant?: typeof history[0] }> = [];
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
        // 跳过孤立的 assistant 消息（防御性处理）
    }

    const maxTokens = convoConfig?.maxTokens ?? role.maxTokens;

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

/** 将轮次数组转为 LanguageModelChatMessage 数组 */
function roundsToMessages(
    rounds: Array<{ user: { content: string }; assistant?: { content: string } }>,
): vscode.LanguageModelChatMessage[] {
    const msgs: vscode.LanguageModelChatMessage[] = [];
    for (const r of rounds) {
        msgs.push(vscode.LanguageModelChatMessage.User(r.user.content));
        if (r.assistant) {
            msgs.push(vscode.LanguageModelChatMessage.Assistant(r.assistant.content));
        }
    }
    return msgs;
}
