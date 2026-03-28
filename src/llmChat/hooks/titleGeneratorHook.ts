/**
 * Post-response hook：自动生成对话标题
 *
 * 仅在 isFirstResponse === true 时执行。
 * 取首条用户消息的前 500 字，调用 LLM 生成 ≤10 字标题，
 * 写入对话文件的 chat_title frontmatter 并刷新树视图。
 */
import * as vscode from 'vscode';
import { LLMService } from '../../llm/LLMService';
import { updateConversationTitle } from '../llmChatDataManager';
import type { PostResponseHook } from './PostResponseHookRunner';

export const titleGeneratorHook: PostResponseHook = async (ctx) => {
    if (!ctx.isFirstResponse) { return; }

    const userText = ctx.firstUserText.trim();
    if (!userText) { return; }

    const prompt = `请为以下对话内容生成一个简洁的标题（10个字以内），直接输出标题文字，不要加引号、标点或解释：\n\n${userText.slice(0, 500)}`;
    const result = await LLMService.chat(
        [vscode.LanguageModelChatMessage.User(prompt)],
    );
    if (!result?.text) { return; }

    const title = result.text.trim().replace(/^["'「」【】\s]+|["'「」【】\s]+$/g, '');
    if (!title) { return; }

    await updateConversationTitle(ctx.uri, title);
    ctx.notifyChange({ uri: ctx.uri, roleId: ctx.role.id, success: true });
};
