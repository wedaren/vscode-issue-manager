/**
 * Post-response hook：原始观察提取
 *
 * 每轮 LLM 回复后运行。从用户发言中提取关于"这个用户是谁"的持久事实，
 * 写入 raw/observations/{roleName}/ 作为知识库的原始素材。
 *
 * 后续由记忆编译 hook（memoryCompilerHook）离线编译为结构化的
 * wiki/user/ 和 wiki/roles/{roleName}/ 知识。
 *
 * 【设计原则】
 * - 仅记录用户本人陈述或流露的信息，不记录 LLM 的行为/输出/结论
 * - 宁可漏记，不可误记——不确定时输出 SKIP
 * - 只做原始记录（raw），不做整理——整理交给离线编译器
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { LLMService } from '../../llm/LLMService';
import {
    getAllIssueMarkdowns,
    createIssueMarkdown,
    extractFrontmatterAndBody,
    updateIssueMarkdownBody,
    type FrontmatterData,
} from '../../data/IssueMarkdowns';
import { Logger } from '../../core/utils/Logger';
import type { PostResponseHook } from './PostResponseHookRunner';

const logger = Logger.getInstance();

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

/**
 * 查找当天的 raw/observations 文件，找不到则创建。
 * 每个角色每天一个文件，避免文件爆炸。
 */
async function findOrCreateObservationFile(roleName: string): Promise<vscode.Uri | null> {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const targetTitle = `raw/observations/${roleName}/${today}`;

    // 查找已有
    const all = await getAllIssueMarkdowns({});
    for (const md of all) {
        if (md.title === targetTitle) {
            return md.uri;
        }
    }

    // 不存在 → 创建
    const body = `> 角色: ${roleName}\n> 日期: ${today}\n`;
    const uri = await createIssueMarkdown({
        frontmatter: { issue_title: targetTitle } as Partial<FrontmatterData>,
        markdownBody: body,
    });
    if (uri) {
        logger.info(`[MemoryExtractor] 创建观察文件: ${targetTitle}`);
    }
    return uri;
}

/**
 * 向观察文件追加条目。
 */
async function appendObservations(
    fileUri: vscode.Uri,
    entries: string[],
    conversationId: string,
): Promise<void> {
    const content = Buffer.from(await vscode.workspace.fs.readFile(fileUri)).toString('utf8');
    const { body } = extractFrontmatterAndBody(content);

    const now = new Date();
    const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const newLines = entries.map(e => `- [${time}][${conversationId}] ${e}`).join('\n');
    const newBody = body.trimEnd() + '\n' + newLines + '\n';

    await updateIssueMarkdownBody(fileUri, newBody);
}

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

    // 写入 raw/observations/{roleName}/
    try {
        const fileUri = await findOrCreateObservationFile(ctx.role.name);
        if (!fileUri) { return; }
        await appendObservations(fileUri, entries, ctx.conversationId);
        logger.info(`[MemoryExtractor] 已记录 ${entries.length} 条观察 → raw/observations/${ctx.role.name}/`);
    } catch (e) {
        logger.warn('[MemoryExtractor] 写入观察失败（已忽略）', e);
    }
};
