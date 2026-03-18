/**
 * Post-response hook：自动提取记忆条目
 *
 * 每轮 LLM 回复后运行。发送 user+assistant 对给小模型，
 * 提取 0-2 条值得长期记忆的关键事实/决策。
 * LLM 返回 "SKIP" 时不写入，避免无意义条目堆积。
 */
import * as vscode from 'vscode';
import { LLMService } from '../../llm/LLMService';
import { appendAutoMemoryEntries } from '../llmChatDataManager';
import type { PostResponseHook } from './PostResponseHookRunner';

const EXTRACTION_PROMPT = `从以下对话轮次中提取 0-2 条值得长期记录的关键信息。
适合记录的内容：用户偏好、重要决策、项目约束、已完成的重要任务。
不适合记录的内容：闲聊、临时性问题、常见知识、已在对话中解决的小问题。

每条用一句话描述（20字以内），以"- "开头。
若本轮无值得记录的内容，仅回复"SKIP"，不要解释。

## User
{USER}

## Assistant
{ASSISTANT}`;

export const memoryExtractorHook: PostResponseHook = async (ctx) => {
    const userText = ctx.lastUserText.trim();
    const assistantText = ctx.assistantText.trim();
    if (!userText || !assistantText) { return; }

    const prompt = EXTRACTION_PROMPT
        .replace('{USER}', userText.slice(0, 800))
        .replace('{ASSISTANT}', assistantText.slice(0, 800));

    const result = await LLMService.chat(
        [vscode.LanguageModelChatMessage.User(prompt)],
    );
    if (!result?.text) { return; }

    const text = result.text.trim();
    if (text === 'SKIP' || text.toUpperCase().startsWith('SKIP')) { return; }

    // 提取以 "- " 开头的行
    const entries = text
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('- '))
        .map(l => l.slice(2).trim())
        .filter(l => l.length > 0)
        .slice(0, 2); // 最多保留 2 条

    if (entries.length === 0) { return; }

    await appendAutoMemoryEntries(ctx.role.id, entries, ctx.conversationId);
};
