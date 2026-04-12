/**
 * Post-response hook：记忆编译器（离线 raw → wiki）
 *
 * 将 raw/observations/ 中的原始观察编译为结构化的 wiki 知识：
 *   - 用户画像类观察 → wiki/user/profile, wiki/user/preferences
 *   - 角色执行经验   → wiki/roles/{roleName}/experience
 *
 * 采用 Karpathy "LLM Knowledge Base" 思路：
 *   - raw 是不可变的原始记录（memoryExtractorHook 写入）
 *   - wiki 是 LLM 编译后的结构化知识（本 hook 维护）
 *   - 编译是增量的：只处理新增的观察
 *
 * 【触发策略】
 * - 每轮对话后检查：该角色是否有新观察未编译
 * - 通过对比观察文件 mtime vs wiki 文件 mtime 判断
 * - 有新观察时触发一次 LLM 编译调用
 * - 编译失败不影响主流程（fire-and-forget）
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

// ─── 编译 Prompt ────────────────────────────────────────────

const COMPILE_PROMPT = `你是一个知识编译器。你的任务是将原始观察记录编译为结构化的用户/角色知识。

## 输入

### 原始观察（raw，来自多次对话的自动提取）
{OBSERVATIONS}

### 当前已有的结构化知识（wiki，上次编译的结果）
{CURRENT_WIKI}

## 任务

将原始观察合并到结构化知识中：
1. **去重**：同一事实多次出现只保留一条
2. **去矛盾**：如果新旧信息矛盾，保留最新的
3. **分类**：将观察归入正确的区块
4. **溯源**：每条信息末尾标注来源日期（如 ← 2026-04-10）
5. **精炼**：合并相似描述，保持每条简洁

## 输出格式

严格按以下格式输出两个区块（如果某区块无内容可省略）：

---USER_WIKI---
## 身份与背景
- 条目 ← 来源日期

## 偏好与习惯
- 条目 ← 来源日期

## 当前关注
- 条目 ← 来源日期

## 约束与原则
- 条目 ← 来源日期

---ROLE_WIKI---
## 交互经验
- 条目 ← 来源日期

## 工具使用模式
- 条目 ← 来源日期

注意：
- 用户画像类信息（身份、偏好、背景）写入 USER_WIKI（所有角色共享）
- 角色特有的执行经验写入 ROLE_WIKI（仅该角色可见）
- 如果原始观察中没有新信息，原样输出当前 wiki 内容
- 每个区块最多 20 条，超出时合并或删除最不重要的`;

// ─── 辅助函数 ────────────────────────────────────────────────

/** 获取指定标题前缀的所有 issue */
async function getByTitlePrefix(prefix: string) {
    const all = await getAllIssueMarkdowns({});
    return all.filter(issue => issue.title.startsWith(prefix));
}

/** 读取 issue 正文 */
async function readBody(uri: vscode.Uri): Promise<string> {
    const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    const { body } = extractFrontmatterAndBody(content);
    return body;
}

/** 查找或创建 wiki issue */
async function findOrCreateWiki(title: string, initialBody: string): Promise<vscode.Uri | null> {
    const all = await getAllIssueMarkdowns({});
    for (const md of all) {
        if (md.title === title) { return md.uri; }
    }
    return await createIssueMarkdown({
        frontmatter: { issue_title: title } as Partial<FrontmatterData>,
        markdownBody: initialBody,
    });
}

/** 解析编译输出，分离 USER_WIKI 和 ROLE_WIKI 区块 */
function parseCompileOutput(output: string): { userWiki: string; roleWiki: string } {
    let userWiki = '';
    let roleWiki = '';

    const userMatch = output.match(/---USER_WIKI---\s*\n([\s\S]*?)(?=---ROLE_WIKI---|$)/);
    if (userMatch) { userWiki = userMatch[1].trim(); }

    const roleMatch = output.match(/---ROLE_WIKI---\s*\n([\s\S]*?)$/);
    if (roleMatch) { roleWiki = roleMatch[1].trim(); }

    return { userWiki, roleWiki };
}

// ─── Hook 实现 ───────────────────────────────────────────────

export const memoryCompilerHook: PostResponseHook = async (ctx) => {
    const roleName = ctx.role.name;

    // 1. 查找该角色的原始观察
    const observations = await getByTitlePrefix(`raw/observations/${roleName}/`);
    if (observations.length === 0) { return; } // 无观察，跳过

    // 2. 查找当前 wiki（用户画像 + 角色经验）
    const userWikiTitle = 'wiki/user/profile';
    const roleWikiTitle = `wiki/roles/${roleName}/experience`;

    const userWikis = await getByTitlePrefix('wiki/user/');
    const roleWikis = await getByTitlePrefix(`wiki/roles/${roleName}/`);

    // 3. 判断是否需要编译：观察 mtime > wiki mtime
    const latestObsMtime = Math.max(...observations.map(o => o.mtime));
    const latestWikiMtime = Math.max(
        0,
        ...userWikis.map(w => w.mtime),
        ...roleWikis.map(w => w.mtime),
    );

    if (latestObsMtime <= latestWikiMtime) {
        return; // 没有新观察，跳过
    }

    // 4. 读取所有原始观察
    const obsBodies: string[] = [];
    for (const obs of observations.sort((a, b) => a.mtime - b.mtime)) {
        const body = await readBody(obs.uri);
        if (body.trim()) { obsBodies.push(`### ${obs.title}\n${body}`); }
    }
    const allObservations = obsBodies.join('\n\n');
    if (!allObservations.trim()) { return; }

    // 5. 读取当前 wiki 内容
    const currentUserWiki = userWikis.length > 0
        ? (await Promise.all(userWikis.map(w => readBody(w.uri)))).join('\n\n')
        : '（暂无）';
    const currentRoleWiki = roleWikis.length > 0
        ? (await Promise.all(roleWikis.map(w => readBody(w.uri)))).join('\n\n')
        : '（暂无）';
    const currentWiki = `### 用户画像 (wiki/user/)\n${currentUserWiki}\n\n### 角色经验 (wiki/roles/${roleName}/)\n${currentRoleWiki}`;

    // 6. LLM 编译
    const prompt = COMPILE_PROMPT
        .replace('{OBSERVATIONS}', allObservations.slice(0, 6000))
        .replace('{CURRENT_WIKI}', currentWiki.slice(0, 4000));

    const start = Date.now();
    try {
        const result = await LLMService.chat(
            [vscode.LanguageModelChatMessage.User(prompt)],
        );
        if (!result?.text) { return; }

        const { userWiki, roleWiki } = parseCompileOutput(result.text);

        const updated: string[] = [];

        // 7. 写入 wiki/user/profile
        if (userWiki) {
            const uri = await findOrCreateWiki(userWikiTitle, '');
            if (uri) {
                await updateIssueMarkdownBody(uri, userWiki);
                updated.push(userWikiTitle);
                logger.info(`[MemoryCompiler] 已更新 ${userWikiTitle}`);
            }
        }

        // 8. 写入 wiki/roles/{roleName}/experience
        if (roleWiki) {
            const uri = await findOrCreateWiki(roleWikiTitle, '');
            if (uri) {
                await updateIssueMarkdownBody(uri, roleWiki);
                updated.push(roleWikiTitle);
                logger.info(`[MemoryCompiler] 已更新 ${roleWikiTitle}`);
            }
        }

        if (updated.length > 0) {
            ctx.log?.(`🪝 memoryCompiler → 编译 ${observations.length} 份观察，更新 ${updated.join(', ')} (${((Date.now() - start) / 1000).toFixed(1)}s)`);
        }

        ctx.notifyChange({ uri: ctx.uri, roleId: ctx.role.id, success: true });
    } catch (e) {
        logger.warn('[MemoryCompiler] 编译失败（已忽略）', e);
    }
};
