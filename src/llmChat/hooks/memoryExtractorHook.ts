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

const EXTRACTION_PROMPT = `你的任务是从用户发言中提取关于"这个用户是谁"的持久事实，用于构建长期用户画像。

【只记录以下类型的信息】
- 用户偏好与习惯（如：喜欢简洁回答、习惯用中文思考、偏好在晚间工作）
- 用户背景与身份（如：从事金融科技行业、5年前端经验、在某某公司工作）
- 长期有效的约束或原则（如：团队只用 TypeScript、不喜欢过度抽象）
- 用户的思维方式或价值观（如：偏好实用主义、重视代码简洁性）
- 用户正在持续关注的领域或项目（如：最近在研究 AI Agent 架构）

【明确禁止记录以下内容】
- 任务执行结果、完成情况
- AI/助手的行为或输出
- 一次性的问题或请求
- 无法从用户发言中直接验证的推断

【输出格式】
若有值得记录的内容：每条以"- "开头，80字以内，最多3条。要具体有用，不要太笼统。
若本轮用户发言无符合条件的内容：仅回复"SKIP"。

## 用户发言
{USER}`;

export const memoryExtractorHook: PostResponseHook = async (ctx) => {
    const userText = ctx.lastUserText.trim();
    if (!userText || userText.length < 10) { return; }

    const prompt = EXTRACTION_PROMPT.replace('{USER}', userText.slice(0, 1200));

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
        .filter(l => l.length > 0 && l.length <= 100)
        .slice(0, 3);

    if (entries.length === 0) { return; }

    await appendAutoMemoryEntries(ctx.role.id, entries, ctx.conversationId);
};
