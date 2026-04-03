/**
 * Post-response hook：洞见结晶
 *
 * 当对话产生有价值的新认知时，自动提取并写入对话的 frontmatter。
 * 这些洞见让 conversation_context provider 能在未来的对话中关联到这次思考。
 *
 * 触发条件：非首轮回复（需要至少一个来回才可能产生洞见）
 * 提取内容：这次对话产生了什么新的理解、决策或结论
 */
import * as vscode from 'vscode';
import { LLMService } from '../../llm/LLMService';
import type { PostResponseHook } from './PostResponseHookRunner';
import { getIssueMarkdown, updateIssueMarkdownFrontmatter } from '../../data/IssueMarkdowns';

const INSIGHT_PROMPT = `根据以下对话片段，判断是否产生了值得记录的新认知、决策或洞见。

【什么值得记录】
- 用户对某个问题形成了新的理解或看法
- 做出了明确的决策或选择
- 发现了之前没注意到的关联或矛盾
- 得出了可复用的经验或教训

【什么不值得记录】
- 单纯的问答（查个信息、问个用法）
- 还在探索中、没有结论的讨论
- 纯粹的任务执行（帮我写个代码、翻译一下）

【输出格式】
若有洞见：用一句话（50字以内）概括核心认知，以"- "开头。最多1条。
若无洞见：仅回复"SKIP"。

## 用户说
{USER}

## 助手回复
{ASSISTANT}`;

export const insightCrystallizerHook: PostResponseHook = async (ctx) => {
    // 首轮不触发（还没有来回）
    if (ctx.isFirstResponse) { return; }

    const userText = ctx.lastUserText.trim();
    const assistantText = ctx.assistantText.trim();
    if (!userText || !assistantText || userText.length < 20) { return; }

    const prompt = INSIGHT_PROMPT
        .replace('{USER}', userText.slice(0, 800))
        .replace('{ASSISTANT}', assistantText.slice(0, 800));

    const result = await LLMService.chat(
        [vscode.LanguageModelChatMessage.User(prompt)],
    );
    if (!result?.text) { return; }

    const text = result.text.trim();
    if (text.toUpperCase().startsWith('SKIP')) { return; }

    // 提取洞见
    const insightLine = text.split('\n').find(l => l.trim().startsWith('- '));
    if (!insightLine) { return; }
    const insight = insightLine.slice(2).trim();
    if (!insight || insight.length > 80) { return; }

    // 追加到对话 frontmatter 的 chat_insights 数组
    const md = await getIssueMarkdown(ctx.uri);
    if (!md) { return; }

    const existing = (md.frontmatter?.chat_insights as string[] | undefined) || [];
    // 避免重复
    if (existing.some(e => e === insight)) { return; }
    // 最多保留 5 条
    const updated = [...existing, insight].slice(-5);

    await updateIssueMarkdownFrontmatter(ctx.uri, { chat_insights: updated } as any);
};
