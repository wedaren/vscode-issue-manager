/**
 * Post-response hook：知识沉淀检测
 *
 * 每轮 LLM 回复后运行。检测对话中是否出现了值得沉淀到知识库 raw/ 的信息：
 * - 用户分享了外部文章、链接、论文
 * - 对话中产生了结构化的分析或总结
 * - LLM 提供了深度技术解释
 *
 * 检测到时自动创建 raw/ 素材，编译员的 timer 会在后续自动编译到 wiki/。
 *
 * 【设计原则】
 * - 宁可漏收，不可乱收——只沉淀明确有价值的知识片段
 * - 不沉淀一次性问答、闲聊、操作指令
 * - 由轻量 LLM 调用判断，不阻塞主流程
 */
import * as vscode from 'vscode';
import { LLMService } from '../../llm/LLMService';
import { createIssueMarkdown } from '../../data/IssueMarkdowns';
import { Logger } from '../../core/utils/Logger';
import type { PostResponseHook } from './PostResponseHookRunner';

const logger = Logger.getInstance();

const DETECTION_PROMPT = `你的任务是判断以下对话片段中是否包含值得沉淀到知识库的信息。

【值得沉淀的信息类型】
- 对特定概念、技术、工具的深入解释或分析
- 用户分享的外部资源（文章摘要、论文要点、项目介绍）
- 有价值的技术方案对比、架构设计讨论
- 领域知识、行业洞察、最佳实践

【不值得沉淀的信息】
- 一次性的操作指令（"帮我改这个文件"）
- 简短问答（"这个函数什么意思"）
- 闲聊、日常交流
- 已经是从知识库查询出来的信息（避免循环）

【输出格式】
如果有值得沉淀的信息，输出 JSON（可以多条）：
[{"category":"articles|concepts|tools|patterns","title":"简洁标题","summary":"50-100字摘要"}]

如果没有，仅回复：SKIP

## 用户消息
{USER}

## 助手回复
{ASSISTANT}`;

/** 最小对话长度阈值（太短的对话不值得检测） */
const MIN_TEXT_LENGTH = 100;

export const knowledgeCompilerHook: PostResponseHook = async (ctx) => {
    const userText = ctx.lastUserText.trim();
    const assistantText = ctx.assistantText.trim();

    // 短对话跳过
    if (userText.length + assistantText.length < MIN_TEXT_LENGTH) { return; }

    // 如果对话本身就在操作知识库（编译员角色），跳过避免循环
    if (ctx.role.name === '知识编译员') { return; }

    // 检查角色是否启用了知识库工具集
    if (!ctx.role.toolSets.includes('knowledge_base')) { return; }

    const prompt = DETECTION_PROMPT
        .replace('{USER}', userText.slice(0, 1500))
        .replace('{ASSISTANT}', assistantText.slice(0, 2000));

    const start = Date.now();
    try {
        const result = await LLMService.chat(
            [vscode.LanguageModelChatMessage.User(prompt)],
        );
        if (!result?.text) { return; }

        const text = result.text.trim();
        if (text.toUpperCase().startsWith('SKIP')) { return; }

        // 解析 JSON 结果
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) { return; }

        let items: Array<{ category: string; title: string; summary: string }>;
        try {
            items = JSON.parse(jsonMatch[0]);
        } catch {
            return; // JSON 解析失败，静默跳过
        }

        if (!Array.isArray(items) || items.length === 0) { return; }

        // 为每条创建 raw/ 素材
        const created: string[] = [];
        for (const item of items.slice(0, 2)) { // 最多 2 条
            const category = ['articles', 'concepts', 'tools', 'patterns'].includes(item.category)
                ? item.category
                : 'articles';
            const title = (item.title || '').trim().slice(0, 80);
            const summary = (item.summary || '').trim();

            if (!title || !summary) { continue; }

            const issueTitle = `raw/${category}/${title}`;
            const body = [
                `> 来源: 对话沉淀（角色: ${ctx.role.name}，对话: ${ctx.conversationId}）`,
                `> 沉淀时间: ${new Date().toISOString()}`,
                '',
                `## 摘要`,
                summary,
                '',
                `## 上下文`,
                '',
                `### 用户消息`,
                userText.slice(0, 2000),
                '',
                `### 助手回复`,
                assistantText.slice(0, 3000),
            ].join('\n');

            try {
                await createIssueMarkdown({
                    frontmatter: { issue_title: issueTitle },
                    markdownBody: body,
                });
                created.push(title);
                logger.info(`[KnowledgeCompilerHook] 已沉淀知识: ${issueTitle}`);
            } catch (e) {
                logger.warn(`[KnowledgeCompilerHook] 创建素材失败: ${issueTitle}`, e);
            }
        }

        if (created.length > 0) {
            ctx.log?.(`🪝 knowledgeCompiler → 沉淀 ${created.length} 条: ${created.join(', ')} (${((Date.now() - start) / 1000).toFixed(1)}s)`);
        }

        ctx.notifyChange({
            uri: ctx.uri,
            roleId: ctx.role.id,
            success: true,
        });
    } catch (e) {
        logger.warn('[KnowledgeCompilerHook] 检测失败（已忽略）', e);
    }
};
