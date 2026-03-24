/**
 * Post-response hook：自动提取用户画像记忆
 *
 * 每轮 LLM 回复后运行。仅从用户发言中提取关于"这个用户是谁"的持久事实：
 * 偏好、习惯、背景、约束、工作方式等。
 *
 * 【设计原则】
 * - 仅记录用户本人陈述或流露的信息，不记录 LLM 的行为/输出/结论
 * - 任务执行结果、已完成事项等由 LLM 通过 write_memory 工具显式管理，不在此处记录
 * - 宁可漏记，不可误记——不确定时输出 SKIP
 */
import * as vscode from 'vscode';
import { LLMService } from '../../llm/LLMService';
import { appendAutoMemoryEntries } from '../llmChatDataManager';
import type { PostResponseHook } from './PostResponseHookRunner';

const EXTRACTION_PROMPT = `你的任务是从用户发言中提取关于"这个用户是谁"的持久事实，用于构建用户画像。

【只记录以下类型的信息】
- 用户偏好与习惯（如：喜欢简洁回答、习惯用中文思考）
- 用户背景与身份（如：从事 XX 行业、有 N 年 XX 经验）
- 长期有效的约束（如：不喜欢某种代码风格、固定的工作流程）
- 用户明确表达的价值观或工作原则

【明确禁止记录以下内容】
- 任务执行结果、完成情况（如"已完成XX"、"生成了XX"）——这类信息由任务记录系统管理
- AI/助手的行为、输出或能力（如"助手写了XX"、"模型擅长XX"）
- 无法从用户发言中直接验证的推断
- 临时性问题、一次性请求、当前对话的具体内容

【输出格式】
若有值得记录的内容：每条以"- "开头，20字以内，最多2条。
若本轮用户发言无符合条件的内容：仅回复"SKIP"，不要解释。

## 用户发言
{USER}`;

export const memoryExtractorHook: PostResponseHook = async (ctx) => {
    const userText = ctx.lastUserText.trim();
    if (!userText) { return; }

    const prompt = EXTRACTION_PROMPT.replace('{USER}', userText.slice(0, 800));

    const result = await LLMService.chat(
        [vscode.LanguageModelChatMessage.User(prompt)],
    );
    if (!result?.text) { return; }

    const text = result.text.trim();
    if (text.toUpperCase().startsWith('SKIP')) { return; }

    // 提取以 "- " 开头的行
    const entries = text
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('- '))
        .map(l => l.slice(2).trim())
        .filter(l => l.length > 0)
        .slice(0, 2);

    if (entries.length === 0) { return; }

    await appendAutoMemoryEntries(ctx.role.id, entries, ctx.conversationId);
};
