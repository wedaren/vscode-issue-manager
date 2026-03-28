/**
 * Post-response hook：意图锚点
 *
 * 仅在 isFirstResponse === true 时运行。
 * 从首次用户消息 + 助手回复中提取一句话目标描述，
 * 写入对话 frontmatter 的 chat_intent 字段。
 *
 * 后续每次 buildMessages() 都会将此意图注入到 system prompt 最前，
 * 防止长对话中 LLM 偏离原始目标。
 *
 * 用户可以手动编辑 chat_intent 字段来修正或更新意图描述。
 */
import * as vscode from 'vscode';
import { LLMService } from '../../llm/LLMService';
import { updateConversationIntent } from '../llmChatDataManager';
import type { PostResponseHook } from './PostResponseHookRunner';

const INTENT_PROMPT = `根据以下对话的首轮内容，用一句话（25字以内）描述用户的核心目标。
直接输出目标描述，不要加"用户想要"等前缀，不要加标点符号。

## User
{USER}

## Assistant
{ASSISTANT}`;

export const intentAnchorHook: PostResponseHook = async (ctx) => {
    if (!ctx.isFirstResponse) { return; }

    const userText = ctx.firstUserText.trim();
    const assistantText = ctx.assistantText.trim();
    if (!userText) { return; }

    const prompt = INTENT_PROMPT
        .replace('{USER}', userText.slice(0, 600))
        .replace('{ASSISTANT}', assistantText.slice(0, 400));

    const result = await LLMService.chat(
        [vscode.LanguageModelChatMessage.User(prompt)],
    );
    if (!result?.text) { return; }

    const intent = result.text.trim().replace(/^["'「」【】\s]+|["'「」【】\s]+$/g, '');
    if (!intent) { return; }

    await updateConversationIntent(ctx.uri, intent);
};
