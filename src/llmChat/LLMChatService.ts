/**
 * LLM 聊天服务
 *
 * 管理聊天会话生命周期、调用 LLM 并将消息持久化到 issueMarkdown。
 * 支持单角色对话和群组讨论（含协调者调度）。
 */
import * as vscode from 'vscode';
import { LLMService } from '../llm/LLMService';
import {
    getChatRoleById,
    createConversation,
    parseConversationMessages,
    appendMessageToConversation,
    getChatGroupById,
    parseGroupConversationMessages,
    appendGroupMessageToConversation,
    getConversationConfig,
    updateConversationTokenUsed,
    estimateTokens,
    getOrCreateExecutionLog,
    startLogRun,
    appendLogLine,
} from './llmChatDataManager';
import type { ChatRoleInfo, ChatGroupInfo } from './types';
import { CHAT_TOOLS, executeChatTool, getToolsForRole, type ToolExecContext } from './chatTools';
import { Logger } from '../core/utils/Logger';

const logger = Logger.getInstance();

/** 协调者调度计划 */
export interface CoordinatorPlan {
    /** assign = 指定成员回答, sequential = 全员顺序, parallel = 全员并行 */
    mode: 'assign' | 'sequential' | 'parallel';
    /** 被选中的成员名称列表 */
    members: string[];
    /** 给各成员的专注引导（可选） */
    guidance: Record<string, string>;
    /** 协调者给用户看的简短说明 */
    summary: string;
}

export class LLMChatService {
    private static instance: LLMChatService;

    /** 当前活跃的对话 URI */
    private _activeConversationUri: vscode.Uri | undefined;
    /** 当前活跃对话关联的角色（单聊时有值） */
    private _activeRole: ChatRoleInfo | undefined;
    /** 当前活跃的群组（群聊时有值） */
    private _activeGroup: ChatGroupInfo | undefined;
    /** 群组成员角色列表（群聊时有值） */
    private _activeGroupMembers: ChatRoleInfo[] = [];

    private _onDidSendMessage = new vscode.EventEmitter<{ uri: vscode.Uri; role: 'user' | 'assistant'; content: string; roleName?: string }>();
    readonly onDidSendMessage = this._onDidSendMessage.event;

    private constructor() {}

    static getInstance(): LLMChatService {
        if (!LLMChatService.instance) {
            LLMChatService.instance = new LLMChatService();
        }
        return LLMChatService.instance;
    }

    get activeConversationUri(): vscode.Uri | undefined {
        return this._activeConversationUri;
    }

    get activeRole(): ChatRoleInfo | undefined {
        return this._activeRole;
    }

    get activeGroup(): ChatGroupInfo | undefined {
        return this._activeGroup;
    }

    get activeGroupMembers(): ChatRoleInfo[] {
        return this._activeGroupMembers;
    }

    get isGroupChat(): boolean {
        return !!this._activeGroup;
    }

    /** 设置当前活跃对话（单聊） */
    async setActiveConversation(uri: vscode.Uri, roleId: string): Promise<void> {
        this._activeConversationUri = uri;
        this._activeRole = await getChatRoleById(roleId);
        this._activeGroup = undefined;
        this._activeGroupMembers = [];
        logger.info(`[LLMChat] 设置活跃对话: ${uri.fsPath}, 角色: ${this._activeRole?.name ?? roleId}`);
    }

    /** 设置当前活跃对话（群聊） */
    async setActiveGroupConversation(uri: vscode.Uri, groupId: string): Promise<void> {
        this._activeConversationUri = uri;
        this._activeRole = undefined;
        this._activeGroup = await getChatGroupById(groupId);

        this._activeGroupMembers = [];
        if (this._activeGroup) {
            for (const memberId of this._activeGroup.memberIds) {
                const role = await getChatRoleById(memberId);
                if (role) {
                    this._activeGroupMembers.push(role);
                }
            }
        }
        logger.info(`[LLMChat] 设置群组对话: ${uri.fsPath}, 群组: ${this._activeGroup?.name ?? groupId}, 成员: ${this._activeGroupMembers.length}`);
    }

    /** 为指定角色创建新对话并设为活跃 */
    async startNewConversation(roleId: string): Promise<vscode.Uri | null> {
        const uri = await createConversation(roleId);
        if (!uri) {
            vscode.window.showErrorMessage('创建对话失败');
            return null;
        }
        await this.setActiveConversation(uri, roleId);
        return uri;
    }

    /**
     * 向当前活跃对话发送用户消息，并获取 LLM 回复。
     */
    async sendMessage(
        userMessage: string,
        options?: { signal?: AbortSignal },
    ): Promise<string | null> {
        const uri = this._activeConversationUri;
        if (!uri) {
            vscode.window.showWarningMessage('请先选择或新建一个对话');
            return null;
        }

        await appendMessageToConversation(uri, 'user', userMessage);
        this._onDidSendMessage.fire({ uri, role: 'user', content: userMessage });

        const messages = await this.buildLLMMessages(uri, userMessage);
        const startedAt = Date.now();

        // 对话级配置覆盖角色级
        const convoConfig = await getConversationConfig(uri);
        const effectiveModelFamily = convoConfig?.modelFamily || this._activeRole?.modelFamily;

        // ── 日志先行 ──
        const logUri = await this.getLogUri(uri);
        if (logUri) {
            try {
                await startLogRun(logUri, {
                    trigger: 'direct',
                    roleName: this._activeRole?.name,
                    modelFamily: effectiveModelFamily,
                    maxTokens: convoConfig?.maxTokens ?? this._activeRole?.maxTokens,
                });
            } catch { /* 日志写入失败不阻塞主流程 */ }
        }

        try {
            if (logUri) { void appendLogLine(logUri, '🚀 发起 LLM 请求...'); }

            const result = await LLMService.chat(messages, {
                signal: options?.signal,
                modelFamily: effectiveModelFamily,
            });

            if (!result?.text) {
                if (logUri) { void appendLogLine(logUri, `❌ **失败** | LLM 返回空响应 | 耗时 ${fmtDuration(Date.now() - startedAt)}`); }
                return null;
            }

            const assistantReply = result.text.trim();
            await appendMessageToConversation(uri, 'assistant', assistantReply);
            this._onDidSendMessage.fire({ uri, role: 'assistant', content: assistantReply });

            const inputTokens = await estimateTokens(messages);
            const outputMsg = vscode.LanguageModelChatMessage.Assistant(assistantReply);
            const outputTokens = await estimateTokens([outputMsg]);
            void updateConversationTokenUsed(uri, inputTokens + outputTokens);

            if (logUri) { void appendLogLine(logUri, `✅ **成功** | 耗时 ${fmtDuration(Date.now() - startedAt)} | input ${inputTokens} + output ${outputTokens} = ${inputTokens + outputTokens} tokens`); }
            return assistantReply;
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            if (options?.signal?.aborted) {
                if (logUri) { void appendLogLine(logUri, `⏹️ **用户中止** | 耗时 ${fmtDuration(Date.now() - startedAt)}`); }
                return null;
            }
            if (logUri) { void appendLogLine(logUri, `❌ **失败** | 耗时 ${fmtDuration(Date.now() - startedAt)} | ${errMsg}`); }
            logger.error('[LLMChat] 发送消息失败', e);
            vscode.window.showErrorMessage(`LLM 回复失败: ${errMsg}`);
            return null;
        }
    }

    /**
     * 流式发送消息并回调每个 chunk（支持工具调用）
     */
    async sendMessageStream(
        userMessage: string,
        onChunk: (chunk: string) => void,
        options?: {
            signal?: AbortSignal;
            /** 工具调用状态回调 */
            onToolStatus?: (status: { toolName: string; phase: 'calling' | 'done'; result?: string }) => void;
        },
    ): Promise<string | null> {
        const uri = this._activeConversationUri;
        if (!uri) {
            vscode.window.showWarningMessage('请先选择或新建一个对话');
            return null;
        }

        await appendMessageToConversation(uri, 'user', userMessage);
        this._onDidSendMessage.fire({ uri, role: 'user', content: userMessage });

        const messages = await this.buildLLMMessages(uri, userMessage);
        const tools = this._activeRole ? getToolsForRole(this._activeRole) : CHAT_TOOLS;
        const toolContext: ToolExecContext = { role: this._activeRole, signal: options?.signal };
        const signal = options?.signal;
        const startedAt = Date.now();

        // 对话级配置覆盖角色级
        const convoConfig = await getConversationConfig(uri);
        const effectiveModelFamily = convoConfig?.modelFamily || this._activeRole?.modelFamily;

        // ── 日志先行 ──
        const logUri = await this.getLogUri(uri);
        if (logUri) {
            try {
                await startLogRun(logUri, {
                    trigger: 'direct',
                    roleName: this._activeRole?.name,
                    modelFamily: effectiveModelFamily,
                    maxTokens: convoConfig?.maxTokens ?? this._activeRole?.maxTokens,
                });
            } catch { /* 日志写入失败不阻塞主流程 */ }
        }

        try {
            if (logUri) { void appendLogLine(logUri, '🚀 发起 LLM 请求...'); }

            const result = await LLMService.streamWithTools(
                messages,
                tools,
                onChunk,
                async (toolName, input) => {
                    const tcStart = Date.now();

                    // 委派：记录意图
                    if (toolName === 'delegate_to_role' && logUri) {
                        const targetRole = String((input as Record<string, unknown>).roleNameOrId || '');
                        const taskStr = String((input as Record<string, unknown>).task || '');
                        const taskPreview = taskStr.length > 100 ? taskStr.slice(0, 100) + '…' : taskStr;
                        void appendLogLine(logUri, `📤 **委派给「${targetRole}」**: ${taskPreview}`);
                    }

                    const res = await executeChatTool(toolName, input, toolContext);
                    const dur = Date.now() - tcStart;

                    if (logUri) {
                        if (toolName === 'delegate_to_role') {
                            const icon = res.success ? '📥' : '📥❌';
                            void appendLogLine(logUri, `${icon} **委派结果** (${fmtDuration(dur)}) → ${truncate(res.content, 150)}`);
                        } else {
                            void appendLogLine(logUri, `🔧 \`${toolName}\` (${fmtDuration(dur)}) → ${truncate(res.content, 80)}`);
                        }
                    }
                    return res.content;
                },
                {
                    signal,
                    modelFamily: effectiveModelFamily,
                    onToolStatus: options?.onToolStatus,
                },
            );

            if (!result?.text) {
                if (logUri) { void appendLogLine(logUri, `❌ **失败** | LLM 返回空响应 | 耗时 ${fmtDuration(Date.now() - startedAt)}`); }
                return null;
            }

            const assistantReply = result.text.trim();
            await appendMessageToConversation(uri, 'assistant', assistantReply);
            this._onDidSendMessage.fire({ uri, role: 'assistant', content: assistantReply });

            const inputTokens = await estimateTokens(messages);
            const outputMsg = vscode.LanguageModelChatMessage.Assistant(assistantReply);
            const outputTokens = await estimateTokens([outputMsg]);
            void updateConversationTokenUsed(uri, inputTokens + outputTokens);

            // 日志：助手回复摘要
            if (logUri && assistantReply) {
                const preview = assistantReply.replace(/\n+/g, ' ');
                void appendLogLine(logUri, `💭 **助手回复**: ${truncate(preview, 200)}`);
            }

            if (logUri) { void appendLogLine(logUri, `✅ **成功** | 耗时 ${fmtDuration(Date.now() - startedAt)} | input ${inputTokens} + output ${outputTokens} = ${inputTokens + outputTokens} tokens`); }
            return assistantReply;
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            if (options?.signal?.aborted) {
                if (logUri) { void appendLogLine(logUri, `⏹️ **用户中止** | 耗时 ${fmtDuration(Date.now() - startedAt)}`); }
                return null;
            }
            if (logUri) { void appendLogLine(logUri, `❌ **失败** | 耗时 ${fmtDuration(Date.now() - startedAt)} | ${errMsg}`); }
            logger.error('[LLMChat] 流式发送失败', e);
            vscode.window.showErrorMessage(`LLM 回复失败: ${errMsg}`);
            return null;
        }
    }

    /**
     * 群组讨论：协调者先分析问题，决定调度策略，然后各成员按策略回复。
     */
    async sendGroupMessageStream(
        userMessage: string,
        callbacks: {
            /** 协调者决策完成 */
            onCoordinatorPlan: (plan: CoordinatorPlan) => void;
            /** 某位成员开始回复 */
            onMemberStart: (role: ChatRoleInfo) => void;
            /** 流式 chunk */
            onChunk: (chunk: string, role: ChatRoleInfo) => void;
            /** 某位成员回复完毕 */
            onMemberEnd: (role: ChatRoleInfo, fullReply: string) => void;
        },
        options?: { signal?: AbortSignal },
    ): Promise<void> {
        const uri = this._activeConversationUri;
        if (!uri || !this._activeGroup) {
            vscode.window.showWarningMessage('请先选择或新建一个群组对话');
            return;
        }

        // 1. 追加用户消息
        await appendGroupMessageToConversation(uri, 'user', userMessage);
        this._onDidSendMessage.fire({ uri, role: 'user', content: userMessage });

        // 2. 协调者分析 → 生成调度计划
        const plan = await this.runCoordinator(uri, userMessage, options);
        if (options?.signal?.aborted) { return; }
        callbacks.onCoordinatorPlan(plan);

        // 记录协调者决策到文件
        await appendGroupMessageToConversation(uri, 'assistant', plan.summary, '协调者');

        // 3. 根据计划筛选参与成员
        const memberMap = new Map(this._activeGroupMembers.map(m => [m.name, m]));
        const selectedMembers = plan.members
            .map(name => memberMap.get(name))
            .filter((m): m is ChatRoleInfo => !!m);

        if (selectedMembers.length === 0) {
            // fallback：全员参与
            selectedMembers.push(...this._activeGroupMembers);
        }

        // 4. 按模式执行
        if (plan.mode === 'parallel') {
            await this.executeParallel(uri, selectedMembers, plan.guidance, callbacks, options);
        } else {
            // assign 和 sequential 都按顺序执行
            await this.executeSequential(uri, selectedMembers, plan.guidance, callbacks, options);
        }
    }

    // ─── 协调者 ─────────────────────────────────────────────────

    /** 调用 LLM 作为协调者，分析问题并生成调度计划 */
    private async runCoordinator(
        uri: vscode.Uri,
        userMessage: string,
        options?: { signal?: AbortSignal },
    ): Promise<CoordinatorPlan> {
        const members = this._activeGroupMembers;
        const memberDescriptions = members.map(m =>
            `- 「${m.name}」(${m.avatar}): ${m.systemPrompt?.slice(0, 80) || '无特定职责'}`,
        ).join('\n');

        // 获取最近几条历史消息作为上下文
        const history = await parseGroupConversationMessages(uri);
        const recentHistory = history.slice(-6).map(m => {
            if (m.role === 'user') { return `用户: ${m.content.slice(0, 100)}`; }
            return `${m.roleName || '助手'}: ${m.content.slice(0, 100)}`;
        }).join('\n');

        const coordinatorPrompt = `你是一个群组讨论的协调者。你的任务是分析用户的问题，决定让哪些成员回答、以什么方式回答。

## 群组成员
${memberDescriptions}

## 最近对话上下文
${recentHistory || '（新对话，暂无历史）'}

## 用户最新消息
${userMessage}

## 你需要返回一个 JSON 对象（不要包含 markdown 代码块标记）:
{
  "mode": "assign" | "sequential" | "parallel",
  "members": ["成员名称1", "成员名称2"],
  "guidance": { "成员名称1": "请从X角度分析" },
  "summary": "一句话说明调度决策"
}

### mode 说明:
- **assign**: 这个问题只需要特定成员回答（比如翻译问题只需翻译专家）
- **sequential**: 需要多人讨论，按顺序回答（后者可以看到前者的发言并补充或反驳）
- **parallel**: 需要多人独立给出观点（互不影响，各抒己见）

### 决策原则:
- 问题明显属于某个成员专长 → assign 给该成员
- 需要多角度讨论、或后续可能有交叉引用 → sequential
- 需要独立意见、投票、创意发散 → parallel
- guidance 中可以给成员提示应该关注的角度，让讨论更有层次`;

        try {
            const msgs = [vscode.LanguageModelChatMessage.User(coordinatorPrompt)];
            const result = await LLMService.chat(msgs, { signal: options?.signal });

            if (result?.text) {
                const plan = this.parseCoordinatorResponse(result.text);
                if (plan) { return plan; }
            }
        } catch (e) {
            if (options?.signal?.aborted) {
                return this.fallbackPlan();
            }
            logger.error('[LLMChat] 协调者调用失败', e);
        }

        return this.fallbackPlan();
    }

    /** 解析协调者 LLM 返回的 JSON */
    private parseCoordinatorResponse(text: string): CoordinatorPlan | null {
        try {
            // 尝试提取 JSON（去掉可能的 markdown 代码块包裹）
            let jsonStr = text.trim();
            const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) {
                jsonStr = jsonMatch[1].trim();
            }

            const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

            const validModes = ['assign', 'sequential', 'parallel'];
            const mode = validModes.includes(parsed.mode as string)
                ? (parsed.mode as CoordinatorPlan['mode'])
                : 'sequential';

            const allNames = this._activeGroupMembers.map(m => m.name);
            const members = Array.isArray(parsed.members)
                ? (parsed.members as string[]).filter(n => allNames.includes(n))
                : allNames;

            return {
                mode,
                members: members.length > 0 ? members : allNames,
                guidance: (parsed.guidance as Record<string, string>) || {},
                summary: (parsed.summary as string) || this.generateSummary(mode, members),
            };
        } catch (e) {
            logger.warn('[LLMChat] 协调者响应解析失败，使用默认策略', e);
            return null;
        }
    }

    /** 协调者失败时的 fallback：全员顺序回答 */
    private fallbackPlan(): CoordinatorPlan {
        const names = this._activeGroupMembers.map(m => m.name);
        return {
            mode: 'sequential',
            members: names,
            guidance: {},
            summary: `邀请全员参与讨论：${names.join('、')}`,
        };
    }

    private generateSummary(mode: string, members: string[]): string {
        const names = members.join('、');
        switch (mode) {
            case 'assign': return `指派 ${names} 回答`;
            case 'parallel': return `请 ${names} 各自独立给出观点`;
            default: return `请 ${names} 依次讨论`;
        }
    }

    // ─── 执行策略 ───────────────────────────────────────────────

    /** 顺序执行：成员依次回复，后者可见前者发言 */
    private async executeSequential(
        uri: vscode.Uri,
        members: ChatRoleInfo[],
        guidance: Record<string, string>,
        callbacks: Pick<Parameters<LLMChatService['sendGroupMessageStream']>[1], 'onMemberStart' | 'onChunk' | 'onMemberEnd'>,
        options?: { signal?: AbortSignal },
    ): Promise<void> {
        for (const member of members) {
            if (options?.signal?.aborted) { break; }
            await this.executeMemberReply(uri, member, guidance[member.name], callbacks, options);
        }
    }

    /** 并行执行：所有成员同时回复，互不看到本轮其他人的发言（支持工具调用） */
    private async executeParallel(
        uri: vscode.Uri,
        members: ChatRoleInfo[],
        guidance: Record<string, string>,
        callbacks: Pick<Parameters<LLMChatService['sendGroupMessageStream']>[1], 'onMemberStart' | 'onChunk' | 'onMemberEnd'> & {
            onToolStatus?: (status: { toolName: string; phase: 'calling' | 'done'; result?: string }, role: ChatRoleInfo) => void;
        },
        options?: { signal?: AbortSignal },
    ): Promise<void> {
        // 并行构建所有成员的消息列表（基于同一时刻的历史快照）
        const messagesByMember = await Promise.all(
            members.map(async member => ({
                member,
                messages: await this.buildGroupLLMMessages(uri, member, guidance[member.name]),
            })),
        );

        // 并行调用 LLM，但回复的写入仍然串行（保证文件写入顺序一致）
        const results = await Promise.all(
            messagesByMember.map(async ({ member, messages }) => {
                if (options?.signal?.aborted) { return { member, reply: '' }; }

                callbacks.onMemberStart(member);

                try {
                    let accumulated = '';
                    const result = await LLMService.streamWithTools(
                        messages,
                        CHAT_TOOLS,
                        (chunk) => {
                            accumulated += chunk;
                            callbacks.onChunk(accumulated, member);
                        },
                        async (toolName, input) => {
                            const res = await executeChatTool(toolName, input);
                            return res.content;
                        },
                        {
                            signal: options?.signal,
                            modelFamily: member.modelFamily,
                            onToolStatus: (status) => {
                                callbacks.onToolStatus?.(status, member);
                            },
                        },
                    );

                    const reply = result?.text?.trim() || '';
                    callbacks.onMemberEnd(member, reply);
                    return { member, reply };
                } catch (e) {
                    if (!options?.signal?.aborted) {
                        logger.error(`[LLMChat] 并行回复：${member.name} 失败`, e);
                    }
                    callbacks.onMemberEnd(member, '');
                    return { member, reply: '' };
                }
            }),
        );

        // 串行写入文件
        for (const { member, reply } of results) {
            if (reply) {
                await appendGroupMessageToConversation(uri, 'assistant', reply, member.name);
                this._onDidSendMessage.fire({ uri, role: 'assistant', content: reply, roleName: member.name });
            }
        }
    }

    /** 单个成员回复（用于顺序模式，支持工具调用） */
    private async executeMemberReply(
        uri: vscode.Uri,
        member: ChatRoleInfo,
        guidance: string | undefined,
        callbacks: Pick<Parameters<LLMChatService['sendGroupMessageStream']>[1], 'onMemberStart' | 'onChunk' | 'onMemberEnd'> & {
            onToolStatus?: (status: { toolName: string; phase: 'calling' | 'done'; result?: string }, role: ChatRoleInfo) => void;
        },
        options?: { signal?: AbortSignal },
    ): Promise<void> {
        callbacks.onMemberStart(member);

        try {
            const messages = await this.buildGroupLLMMessages(uri, member, guidance);

            let accumulated = '';
            const result = await LLMService.streamWithTools(
                messages,
                CHAT_TOOLS,
                (chunk) => {
                    accumulated += chunk;
                    callbacks.onChunk(accumulated, member);
                },
                async (toolName, input) => {
                    const res = await executeChatTool(toolName, input);
                    return res.content;
                },
                {
                    signal: options?.signal,
                    modelFamily: member.modelFamily,
                    onToolStatus: (status) => {
                        callbacks.onToolStatus?.(status, member);
                    },
                },
            );

            const reply = result?.text?.trim() || '';
            if (reply) {
                await appendGroupMessageToConversation(uri, 'assistant', reply, member.name);
                this._onDidSendMessage.fire({ uri, role: 'assistant', content: reply, roleName: member.name });
            }
            callbacks.onMemberEnd(member, reply);
        } catch (e) {
            if (options?.signal?.aborted) { return; }
            logger.error(`[LLMChat] 群组成员 ${member.name} 回复失败`, e);
            callbacks.onMemberEnd(member, '');
        }
    }

    // ─── 消息构建 ───────────────────────────────────────────────

    /** 构造发送给 LLM 的消息列表（单聊） */
    private async buildLLMMessages(
        uri: vscode.Uri,
        _latestUserMessage: string,
    ): Promise<vscode.LanguageModelChatMessage[]> {
        const msgs: vscode.LanguageModelChatMessage[] = [];

        // 系统指令 + 工具说明
        let systemContent = '';
        if (this._activeRole?.systemPrompt) {
            systemContent = `[系统指令] ${this._activeRole.systemPrompt}`;
        }

        // 根据角色能力动态追加工具说明
        if (this._activeRole?.memoryEnabled) {
            systemContent += '\n\n[记忆工具]\n'
                + '- read_memory: 读取你的持久记忆（对话开始时首先调用）\n'
                + '- write_memory: 更新记忆（任务结束后调用）\n';
        }
        if (this._activeRole?.delegationEnabled) {
            systemContent += '\n\n[委派工具]\n'
                + '- list_chat_roles: 列出所有可用角色\n'
                + '- delegate_to_role: 委派任务给指定角色，获取回复\n';
        }
        if (this._activeRole?.roleManagementEnabled) {
            systemContent += '\n\n[角色管理工具]\n'
                + '- create_chat_role: 创建新角色\n'
                + '- update_role_config: 更新角色系统提示词\n'
                + '- evaluate_role: 记录角色绩效评估\n';
        }

        // VS Code 侧聊天上下文：笔记管理为主，浏览器工具需 Chrome 扩展连接
        systemContent += '\n\n[笔记工具] 你可以管理用户的 issueMarkdown 笔记：\n'
            + '- search_issues: 搜索笔记\n'
            + '- read_issue: 读取笔记内容\n'
            + '- create_issue: 创建单个独立笔记（无层级关系）\n'
            + '- **create_issue_tree**: 创建层级结构的笔记树（推荐！可一次创建多个有父子关系的笔记节点）\n'
            + '- list_issue_tree: 查看笔记树结构\n'
            + '- update_issue: 更新已有笔记\n\n'
            + '[浏览器工具]（需要已连接 Chrome 扩展）：\n'
            + '- web_search: 通过 Chrome 浏览器进行网络搜索\n'
            + '- fetch_url: 通过 Chrome 浏览器访问指定 URL 获取页面文本内容\n'
            + '- open_tab: 在 Chrome 中打开新标签页到指定 URL\n'
            + '- get_tab_content: 获取指定标签页的页面文本内容\n'
            + '- activate_tab: 切换到指定标签页\n'
            + '- list_tabs: 列出 Chrome 所有打开的标签页\n'
            + '- organize_tabs: 将标签页按分组整理\n'
            + '- close_tabs: 关闭指定标签页\n\n'
            + '[页面交互工具]（需要已连接 Chrome 扩展）：\n'
            + '- get_page_elements: 获取页面上的可交互元素（输入框、按钮、链接等）\n'
            + '- click_element: 点击页面元素（按钮、链接等）\n'
            + '- fill_input: 填写表单输入框\n'
            + '- select_option: 选择下拉框选项\n'
            + '- press_key: 模拟键盘按键\n\n'
            + '[使用指引]\n'
            + '- 创建笔记时，优先使用 create_issue_tree 来创建有层级关系的笔记树。\n'
            + '- 检索或整理已有笔记时使用 search_issues/read_issue。\n'
            + '- 查找外部资料时使用 web_search/fetch_url。\n'
            + '- 整理标签页时，先 list_tabs 获取所有标签，再用 organize_tabs 分组。\n'
            + '- 填写表单：先 get_page_elements 了解结构 → fill_input 填入 → click_element 提交。';
        msgs.push(vscode.LanguageModelChatMessage.User(systemContent));

        const history = await parseConversationMessages(uri);
        for (const m of history) {
            if (m.role === 'user') {
                msgs.push(vscode.LanguageModelChatMessage.User(m.content));
            } else {
                msgs.push(vscode.LanguageModelChatMessage.Assistant(m.content));
            }
        }

        return msgs;
    }

    /** 构造群组中某位成员视角的消息列表 */
    private async buildGroupLLMMessages(
        uri: vscode.Uri,
        member: ChatRoleInfo,
        guidance?: string,
    ): Promise<vscode.LanguageModelChatMessage[]> {
        const msgs: vscode.LanguageModelChatMessage[] = [];

        // 该成员的 system prompt
        if (member.systemPrompt) {
            msgs.push(vscode.LanguageModelChatMessage.User(
                `[系统指令] ${member.systemPrompt}`,
            ));
        }

        // 群组上下文提示
        const otherNames = this._activeGroupMembers
            .filter(m => m.id !== member.id)
            .map(m => m.name);
        let groupCtx = `[群组讨论] 你正在参与群组讨论，你的角色是「${member.name}」。`;
        if (otherNames.length > 0) {
            groupCtx += `其他参与者：${otherNames.join('、')}。`;
        }
        groupCtx += '请根据你的角色视角回复。';
        if (guidance) {
            groupCtx += `\n[协调者提示] ${guidance}`;
        }
        msgs.push(vscode.LanguageModelChatMessage.User(groupCtx));

        // 历史消息（群组格式，带角色名）
        const history = await parseGroupConversationMessages(uri);
        for (const m of history) {
            // 跳过协调者消息
            if (m.role === 'assistant' && m.roleName === '协调者') {
                continue;
            }
            if (m.role === 'user') {
                msgs.push(vscode.LanguageModelChatMessage.User(m.content));
            } else {
                const isMyMsg = m.roleName === member.name;
                if (isMyMsg) {
                    msgs.push(vscode.LanguageModelChatMessage.Assistant(m.content));
                } else {
                    msgs.push(vscode.LanguageModelChatMessage.User(
                        `[${m.roleName || '未知角色'}]: ${m.content}`,
                    ));
                }
            }
        }

        return msgs;
    }

    /** 获取日志文件 URI（按需创建） */
    private async getLogUri(uri: vscode.Uri): Promise<vscode.Uri | null> {
        try { return await getOrCreateExecutionLog(uri); } catch { return null; }
    }

    dispose(): void {
        this._onDidSendMessage.dispose();
    }
}

/** 截断字符串，超出 maxLen 时添加省略号 */
function truncate(text: string, maxLen: number): string {
    if (text.length <= maxLen) { return text; }
    return text.slice(0, maxLen - 1) + '…';
}

function fmtDuration(ms: number): string {
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}
