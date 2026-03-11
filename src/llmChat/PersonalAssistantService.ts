/**
 * 个人助手服务
 *
 * 管理专属个人助手角色的生命周期：
 * - 启动时确保助手角色文件存在（不存在则自动创建）
 * - 管理助手的持久记忆文件（读/写）
 * - 提供角色委派能力（将子任务发给指定角色，获取回复）
 */
import * as vscode from 'vscode';
import * as path from 'path';
import {
    getAllIssueMarkdowns,
    createIssueMarkdown,
    extractFrontmatterAndBody,
    updateIssueMarkdownBody,
    updateIssueMarkdownFrontmatter,
} from '../data/IssueMarkdowns';
import type { FrontmatterData } from '../data/IssueMarkdowns';
import type { ChatRoleInfo, ChatRoleFrontmatter, PersonalAssistantMemoryFrontmatter } from './types';
import { getAllChatRoles, createConversation, appendUserMessageQueued, parseConversationMessages } from './llmChatDataManager';
import { RoleTimerManager } from './RoleTimerManager';
import { readStateMarker } from './convStateMarker';
import { Logger } from '../core/utils/Logger';

const logger = Logger.getInstance();

/** 个人助手在 frontmatter 中的标记键 */
const PA_MARKER = 'chat_role_is_personal_assistant';
/** 助手记忆文件在 frontmatter 中的标记键 */
const MEMORY_MARKER = 'assistant_memory';

/** 个人助手的默认系统提示词 */
const PERSONAL_ASSISTANT_SYSTEM_PROMPT = `你是用户的专属个人助手，拥有记忆、学习和团队管理能力。你的名字叫「执行官」。

## 工作流程
收到用户任务时，按以下步骤处理：
1. **获取记忆** — 对话开始时使用 read_memory 了解用户背景和历史任务
2. **分析需求** — 思考任务性质，判断需要哪些专业能力
3. **制定计划** — 向用户简述你的处理方案（几句话即可）
4. **执行任务**：
   - 简单问答 → 直接回复
   - 需要专业能力 → 用 delegate_to_role 委派给合适角色
   - 没有合适角色 → 先用 create_chat_role 创建专家角色，再委派
5. **汇总汇报** — 整合所有信息，清晰告知用户结果和关键信息
6. **更新记忆** — 用 write_memory 记录本次任务经验、角色表现

## 可用工具
**记忆管理**
- read_memory：读取你的持久记忆（对话开始时调用）
- write_memory：更新记忆（任务结束后调用）

**团队管理**
- list_chat_roles：列出当前所有可用专业角色
- delegate_to_role：委派任务给指定角色，获取专业回复
- create_chat_role：创建新的专业角色（当现有角色无法胜任时）
- update_role_config：根据实际表现优化角色的系统提示词
- evaluate_role：记录角色绩效评估

**笔记工具**
- search_issues / read_issue / create_issue / create_issue_tree / update_issue / list_issue_tree

**浏览器工具**（需连接 Chrome 扩展）
- web_search / fetch_url / list_tabs / open_tab 等

## 核心原则
- **充分委派**：优先发挥各专业角色的专长，不要什么都自己做
- **保持记忆**：每次任务后更新记忆，让自己持续进化
- **持续优化**：根据角色表现，主动改进角色配置或创建更好的角色
- **清晰汇报**：向用户说明任务由谁完成、结论是什么、有什么建议`;

export class PersonalAssistantService {
    private static _instance: PersonalAssistantService;

    /** 当前助手角色 ID（文件名去掉 .md） */
    private _assistantRoleId: string | undefined;
    /** 记忆文件 URI */
    private _memoryUri: vscode.Uri | undefined;

    private constructor() {}

    static getInstance(): PersonalAssistantService {
        if (!PersonalAssistantService._instance) {
            PersonalAssistantService._instance = new PersonalAssistantService();
        }
        return PersonalAssistantService._instance;
    }

    /** 获取当前助手角色 ID */
    get assistantRoleId(): string | undefined {
        return this._assistantRoleId;
    }

    // ─── 初始化 ─────────────────────────────────────────────────

    /**
     * 确保个人助手角色存在，在扩展启动时调用。
     * 若角色不存在则自动创建。
     */
    async ensureInitialized(): Promise<void> {
        try {
            await this._findOrCreateAssistantRole();
            await this._findOrCreateMemoryFile();
            logger.info(`[PersonalAssistant] 初始化完成，角色 ID: ${this._assistantRoleId}`);
        } catch (e) {
            logger.error('[PersonalAssistant] 初始化失败', e);
        }
    }

    /** 查找已存在的助手角色，否则创建 */
    private async _findOrCreateAssistantRole(): Promise<void> {
        const all = await getAllIssueMarkdowns();
        for (const md of all) {
            if (md.frontmatter?.[PA_MARKER] === true) {
                this._assistantRoleId = extractFileId(md.uri);
                return;
            }
        }

        // 不存在 → 创建
        const fm: Partial<FrontmatterData> & ChatRoleFrontmatter & { [k: string]: unknown } = {
            chat_role: true,
            chat_role_name: '执行官',
            chat_role_avatar: 'person-add',
            chat_role_system_prompt: PERSONAL_ASSISTANT_SYSTEM_PROMPT,
            [PA_MARKER]: true,
            // ─── 定时器配置（默认关闭，按需开启） ────────────────
            timer_enabled: false,
            timer_interval: 30000,
            timer_max_concurrent: 2,
            timer_timeout: 180000,
            timer_max_retries: 3,
            timer_retry_delay: 5000,
        };

        const body = `# 执行官（个人助手）\n\n这是你的专属个人助手。他拥有持久记忆，可以委派任务给其他角色，并持续进化。\n`;
        const uri = await createIssueMarkdown({ frontmatter: fm, markdownBody: body });
        if (uri) {
            this._assistantRoleId = extractFileId(uri);
            logger.info(`[PersonalAssistant] 已创建助手角色: ${this._assistantRoleId}`);
        }
    }

    /** 查找助手的记忆文件，否则创建 */
    private async _findOrCreateMemoryFile(): Promise<void> {
        if (!this._assistantRoleId) { return; }

        const all = await getAllIssueMarkdowns();
        for (const md of all) {
            if (md.frontmatter?.[MEMORY_MARKER] === true
                && md.frontmatter?.assistant_role_id === this._assistantRoleId) {
                this._memoryUri = md.uri;
                return;
            }
        }

        // 不存在 → 创建
        const fm: Partial<FrontmatterData> & PersonalAssistantMemoryFrontmatter = {
            assistant_memory: true,
            assistant_role_id: this._assistantRoleId,
        } as Partial<FrontmatterData> & PersonalAssistantMemoryFrontmatter;

        const defaultMemory = this._buildDefaultMemoryContent();
        const uri = await createIssueMarkdown({ frontmatter: fm as Partial<FrontmatterData>, markdownBody: defaultMemory });
        if (uri) {
            this._memoryUri = uri;
            logger.info(`[PersonalAssistant] 已创建记忆文件: ${uri.fsPath}`);
        }
    }

    /** 构建默认记忆文件内容 */
    private _buildDefaultMemoryContent(): string {
        return `# 执行官记忆

## 用户背景
（暂无，将在对话中逐步积累）

## 历史任务
（暂无）

## 角色绩效
（暂无）

## 自我反思
我刚刚被创建。我会在与用户互动的过程中逐步积累记忆，了解用户的偏好和工作习惯，不断优化我的团队和工作方式。
`;
    }

    // ─── 记忆读写 ─────────────────────────────────────────────

    /**
     * 读取助手记忆（返回 markdown 文本）
     */
    async readMemory(): Promise<string> {
        if (!this._memoryUri) {
            await this._findOrCreateMemoryFile();
        }
        if (!this._memoryUri) {
            return '（记忆文件不存在）';
        }

        try {
            const raw = Buffer.from(
                await vscode.workspace.fs.readFile(this._memoryUri),
            ).toString('utf8');
            const { body } = extractFrontmatterAndBody(raw);
            return body.trim() || '（记忆为空）';
        } catch (e) {
            logger.error('[PersonalAssistant] 读取记忆失败', e);
            return '（读取记忆失败）';
        }
    }

    /**
     * 写入/更新助手记忆（替换 markdown body）
     */
    async writeMemory(content: string): Promise<boolean> {
        if (!this._memoryUri) {
            await this._findOrCreateMemoryFile();
        }
        if (!this._memoryUri) {
            return false;
        }

        try {
            const ok = await updateIssueMarkdownBody(this._memoryUri, content);
            return ok;
        } catch (e) {
            logger.error('[PersonalAssistant] 写入记忆失败', e);
            return false;
        }
    }

    // ─── 角色委派 ─────────────────────────────────────────────

    /**
     * 将任务委派给指定角色，获取其回复。
     *
     * 委派行为会创建真实的对话文件（在该角色名下），
     * 就像用户亲自与该角色对话一样，用户可在树视图中看到完整记录。
     *
     * @param roleNameOrId 角色名称或 ID
     * @param task 委派给该角色的任务描述
     * @param signal 可选中止信号
     */
    async delegateToRole(
        roleNameOrId: string,
        task: string,
        signal?: AbortSignal,
    ): Promise<{ reply: string; convoId: string; roleName: string }> {
        const role = await this._findRole(roleNameOrId);
        if (!role) {
            return {
                reply: `找不到角色「${roleNameOrId}」，请先用 list_chat_roles 查看可用角色，或用 create_chat_role 创建新角色。`,
                convoId: '',
                roleName: roleNameOrId,
            };
        }

        // 1. 创建真实对话文件——记录这次委派，就像用户亲自与该角色对话
        const taskPreview = task.length > 30 ? task.slice(0, 30) + '…' : task;
        const convoTitle = `[助手委派] ${taskPreview}`;
        const convoUri = await createConversation(role.id, convoTitle);
        if (!convoUri) {
            return { reply: '创建委派对话文件失败', convoId: '', roleName: role.name };
        }

        const convoId = path.basename(convoUri.fsPath, '.md');
        logger.info(`[PersonalAssistant] 委派开始 → 角色「${role.name}」| 对话 ${convoId} | 任务: ${taskPreview}`);

        // 2. 写入用户消息 + queued 标记（单次写入，进入状态机）
        await appendUserMessageQueued(convoUri, task);

        // 3. 立即触发执行（不等下一个 tick）
        await RoleTimerManager.getInstance().triggerConversation(convoUri);

        // 4. 等待执行完成（通过 onDidChange 事件或超时）
        const reply = await this._waitForDelegationResult(convoUri, role.name, signal);

        logger.info(`[PersonalAssistant] 委派结束 → 角色「${role.name}」| 对话 ${convoId} | 回复长度: ${reply.length}`);

        void vscode.commands.executeCommand('issueManager.llmChat.refresh');
        return { reply, convoId, roleName: role.name };
    }

    /**
     * 等待委派的对话被 RoleTimerManager 处理完成。
     * 监听 onDidChange 事件，超时 2 分钟自动返回。
     */
    private _waitForDelegationResult(
        convoUri: vscode.Uri,
        roleName: string,
        signal?: AbortSignal,
    ): Promise<string> {
        return new Promise<string>(resolve => {
            const timerManager = RoleTimerManager.getInstance();

            const cleanup = () => {
                disposable.dispose();
                clearTimeout(timeout);
                signal?.removeEventListener('abort', onAbort);
            };

            // 监听执行完成事件
            const disposable = timerManager.onDidChange(async (e) => {
                if (e.uri.fsPath !== convoUri.fsPath) { return; }
                if (e.success) {
                    cleanup();
                    const text = await this._readLastAssistantMessage(convoUri);
                    logger.info(`[PersonalAssistant] 委派给「${roleName}」完成，回复长度: ${text.length}`);
                    resolve(text);
                } else {
                    // 检查是终态 error 还是中间态 retrying
                    const marker = await readStateMarker(convoUri);
                    if (marker?.status === 'retrying') {
                        // 还在重试中，继续等待下一次 onDidChange
                        logger.info(`[PersonalAssistant] 委派给「${roleName}」重试中（${marker.retryCount}次）`);
                        return;
                    }
                    // 终态：error 或其他非 retrying 状态
                    cleanup();
                    const errMsg = marker?.message || '未知错误';
                    logger.error(`[PersonalAssistant] 委派给「${roleName}」失败: ${errMsg}`);
                    resolve(`委派给「${roleName}」时出错: ${errMsg}`);
                }
            });

            // 超时（2 分钟）
            const timeout = setTimeout(() => {
                cleanup();
                logger.warn(`[PersonalAssistant] 委派给「${roleName}」超时`);
                resolve(`委派给「${roleName}」超时，请查看对话文件了解进度`);
            }, 120_000);

            // 中止信号
            const onAbort = () => {
                cleanup();
                resolve('（已取消）');
            };
            signal?.addEventListener('abort', onAbort);
        });
    }

    /** 从对话文件读取最后一条 assistant 消息 */
    private async _readLastAssistantMessage(uri: vscode.Uri): Promise<string> {
        const messages = await parseConversationMessages(uri);
        const last = messages.filter(m => m.role === 'assistant').pop();
        return last?.content?.trim() || '（角色未返回任何内容）';
    }

    // ─── 角色管理 ─────────────────────────────────────────────

    /**
     * 获取所有可用角色（排除个人助手自身）
     */
    async listRoles(): Promise<ChatRoleInfo[]> {
        const all = await getAllChatRoles();
        return all.filter(r => !r.isPersonalAssistant);
    }

    /**
     * 更新指定角色的系统提示词
     */
    async updateRoleSystemPrompt(roleNameOrId: string, newSystemPrompt: string): Promise<boolean> {
        const role = await this._findRole(roleNameOrId);
        if (!role) { return false; }

        try {
            const ok = await updateIssueMarkdownFrontmatter(role.uri, {
                chat_role_system_prompt: newSystemPrompt,
            } as Partial<FrontmatterData>);
            if (ok) {
                logger.info(`[PersonalAssistant] 已更新角色「${role.name}」的系统提示词`);
            }
            return ok;
        } catch (e) {
            logger.error(`[PersonalAssistant] 更新角色配置失败`, e);
            return false;
        }
    }

    // ─── 私有工具 ─────────────────────────────────────────────

    /** 按名称或 ID 查找角色 */
    private async _findRole(nameOrId: string): Promise<ChatRoleInfo | undefined> {
        const roles = await getAllChatRoles();
        const lower = nameOrId.toLowerCase();
        return roles.find(r =>
            r.id === nameOrId
            || r.name === nameOrId
            || r.name.toLowerCase() === lower,
        );
    }
}

/** 从 URI 提取文件 ID（去掉扩展名） */
function extractFileId(uri: vscode.Uri): string {
    return path.basename(uri.fsPath, '.md');
}
