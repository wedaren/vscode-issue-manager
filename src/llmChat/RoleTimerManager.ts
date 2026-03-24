/**
 * 角色定时器管理器
 *
 * 每个启用 timer_enabled: true 的角色拥有独立定时器。
 * 定时器每隔 timer_interval ms 扫描该角色的所有对话，
 * 找到状态为 queued 或到期 retrying 的对话并发起 LLM 请求。
 *
 * 状态标记（文件末尾的 HTML 注释）驱动整个执行流程：
 *   queued     → 定时器选中 → executing → 成功: 移除标记 + 追加回复
 *                                       → 失败: retrying（指数退避）或 error（超限）
 *   executing  → 超过 STALE_EXECUTING_MS 视为崩溃 → 重置为 retrying
 */
import * as vscode from 'vscode';
import { LLMService } from '../llm/LLMService';
import { Logger } from '../core/utils/Logger';
import {
    getAllChatRoles,
    getChatRoleById,
    getConversationsForRole,
    parseConversationMessages,
    getConversationConfig,
    updateConversationTokenUsed,
    estimateTokens,
    getOrCreateExecutionLog,
    startLogRun,
    appendLogLine,
    createToolCallNode,
} from './llmChatDataManager';
import { CHAT_TOOLS, executeChatTool } from './chatTools';
import { PERSONAL_ASSISTANT_TOOLS, executePersonalAssistantTool } from './personalAssistantTools';
import {
    readStateMarker,
    writeStateMarker,
    stripMarker,
} from './convStateMarker';
import type { ChatRoleInfo } from './types';

const logger = Logger.getInstance();

/** executing 状态超过此时间（ms）视为进程崩溃，强制进入重试 */
const STALE_EXECUTING_MS = 5 * 60 * 1000;

/** 文件变化监听的防抖延迟（ms） */
const WATCHER_DEBOUNCE_MS = 2_000;

export class RoleTimerManager implements vscode.Disposable {
    private static _instance: RoleTimerManager | undefined;

    /** roleId → setInterval handle */
    private readonly timers = new Map<string, ReturnType<typeof setInterval>>();
    /** 内存锁：正在执行的对话文件路径，防止同一 tick 重复处理 */
    private readonly executing = new Set<string>();
    /** 状态变化事件，供 UI 刷新使用 */
    private readonly _onDidChange = new vscode.EventEmitter<{ uri: vscode.Uri; roleId: string; success: boolean }>();
    readonly onDidChange = this._onDidChange.event;

    private readonly _disposables: vscode.Disposable[] = [];
    private _watcherDebounce: ReturnType<typeof setTimeout> | undefined;

    private constructor() {}

    static getInstance(): RoleTimerManager {
        if (!RoleTimerManager._instance) {
            RoleTimerManager._instance = new RoleTimerManager();
        }
        return RoleTimerManager._instance;
    }

    // ─── 生命周期 ────────────────────────────────────────────

    /** 启动：读取所有角色配置并为启用的角色创建定时器，同时监听角色文件变化和保存事件 */
    async start(): Promise<void> {
        await this.syncTimers();
        this.startFileWatcher();
        this.startSaveWatcher();
        logger.info(`[RoleTimerManager] 已启动，当前活跃定时器: ${this.timers.size} 个`);
    }

    /** 停止所有定时器 */
    stopAll(): void {
        for (const timer of this.timers.values()) {
            clearInterval(timer);
        }
        this.timers.clear();
    }

    dispose(): void {
        this.stopAll();
        if (this._watcherDebounce) { clearTimeout(this._watcherDebounce); }
        for (const d of this._disposables) { d.dispose(); }
        this._onDidChange.dispose();
        RoleTimerManager._instance = undefined;
    }

    // ─── 对外接口 ────────────────────────────────────────────

    /**
     * 立即触发指定对话的处理（用户提交后绕过定时器等待）。
     * 若对话状态不是 queued，或正在执行中，则忽略。
     */
    async triggerConversation(uri: vscode.Uri): Promise<void> {
        if (this.executing.has(uri.fsPath)) { return; }

        const marker = await readStateMarker(uri);
        if (!marker || marker.status !== 'queued') { return; }

        const roleId = await this.getRoleIdFromFile(uri);
        if (!roleId) { return; }

        const role = await getChatRoleById(roleId);
        if (!role) { return; }

        void this.executeConversation(uri, role);
    }

    // ─── 内部：定时器同步 ─────────────────────────────────────

    /** 读取最新角色列表，启动/停止定时器使之与配置保持一致 */
    private async syncTimers(): Promise<void> {
        const roles = await getAllChatRoles();
        const enabledIds = new Set(roles.filter(r => r.timerEnabled).map(r => r.id));

        // 启动新增的角色定时器
        for (const role of roles) {
            if (role.timerEnabled && !this.timers.has(role.id)) {
                this.startTimerForRole(role);
            }
        }
        // 停止已禁用的角色定时器
        for (const [roleId, timer] of this.timers) {
            if (!enabledIds.has(roleId)) {
                clearInterval(timer);
                this.timers.delete(roleId);
                logger.info(`[RoleTimerManager] 角色定时器已停止: ${roleId}`);
            }
        }
    }

    private startTimerForRole(role: ChatRoleInfo): void {
        const interval = role.timerInterval ?? 30_000;
        const timer = setInterval(() => void this.tick(role.id), interval);
        this.timers.set(role.id, timer);
        logger.info(`[RoleTimerManager] 角色「${role.name}」定时器已启动（间隔 ${interval}ms）`);
    }

    // ─── 内部：文件监听 ──────────────────────────────────────

    private startFileWatcher(): void {
        const watcher = vscode.workspace.createFileSystemWatcher('**/*.md');
        const handler = () => this.scheduleSync();
        this._disposables.push(
            watcher,
            watcher.onDidCreate(handler),
            watcher.onDidChange(handler),
            watcher.onDidDelete(handler),
        );
    }

    private scheduleSync(): void {
        if (this._watcherDebounce) { clearTimeout(this._watcherDebounce); }
        this._watcherDebounce = setTimeout(() => void this.syncTimers(), WATCHER_DEBOUNCE_MS);
    }

    /**
     * 监听文件保存事件：用户手动在对话文件末尾写入 <!-- llm:queued --> 并保存，
     * 立即触发处理，无需等待定时器下一个 tick。
     * 不要求角色开启 timer_enabled，保存即触发对所有对话文件均有效。
     */
    private startSaveWatcher(): void {
        this._disposables.push(
            vscode.workspace.onDidSaveTextDocument(doc => {
                if (!doc.fileName.endsWith('.md')) { return; }
                // 用保存后的磁盘内容检查末尾标记
                void this.triggerConversation(doc.uri);
            }),
        );
    }

    // ─── 内部：tick 逻辑 ─────────────────────────────────────

    private async tick(roleId: string): Promise<void> {
        // 每次 tick 重新读取配置，捕捉用户对角色文件的修改
        const role = await getChatRoleById(roleId);
        if (!role?.timerEnabled) {
            // 角色已禁用定时器，自动停止
            const timer = this.timers.get(roleId);
            if (timer) { clearInterval(timer); this.timers.delete(roleId); }
            return;
        }

        const maxConcurrent = role.timerMaxConcurrent ?? 2;
        const convos = await getConversationsForRole(roleId);
        let dispatched = 0;

        for (const convo of convos) {
            if (dispatched >= maxConcurrent) { break; }
            if (this.executing.has(convo.uri.fsPath)) { continue; }

            const marker = await readStateMarker(convo.uri);
            if (!marker) { continue; }

            const now = Date.now();
            const eligible =
                marker.status === 'queued' ||
                (marker.status === 'retrying' && marker.retryAt !== undefined && now >= marker.retryAt) ||
                (marker.status === 'executing' && marker.startedAt !== undefined && now - marker.startedAt > STALE_EXECUTING_MS);

            if (eligible) {
                if (marker.status === 'executing') {
                    logger.warn(`[RoleTimerManager] 检测到僵尸 executing 状态，强制重试: ${convo.uri.fsPath}`);
                }
                dispatched++;
                void this.executeConversation(convo.uri, role);
            }
        }
    }

    // ─── 内部：LLM 执行 ──────────────────────────────────────

    private async executeConversation(uri: vscode.Uri, role: ChatRoleInfo): Promise<void> {
        const filePath = uri.fsPath;
        this.executing.add(filePath);

        const currentMarker = await readStateMarker(uri);
        const retryCount = currentMarker?.retryCount ?? 0;
        const startedAt = Date.now();

        // 标记为执行中（持久化，崩溃后可检测）
        await writeStateMarker(uri, { status: 'executing', startedAt, retryCount });

        logger.info(`[RoleTimerManager] 开始处理对话: ${filePath}（尝试 #${retryCount + 1}）`);

        const timeout = role.timerTimeout ?? 60_000;
        const ac = new AbortController();

        // ── 日志先行：获取日志 URI 并写入 Run 标题 ──
        let logUri: vscode.Uri | null = null;
        try { logUri = await getOrCreateExecutionLog(uri); } catch { /* 忽略 */ }

        const convoConfig = await getConversationConfig(uri);
        const effectiveModelFamily = convoConfig?.modelFamily || role.modelFamily;
        const effectiveMaxTokens = convoConfig?.maxTokens ?? role.maxTokens;

        let runNumber = 0;
        if (logUri) {
            try {
                runNumber = await startLogRun(logUri, {
                    trigger: 'timer',
                    roleName: role.name,
                    modelFamily: effectiveModelFamily,
                    timeout,
                    maxTokens: effectiveMaxTokens,
                    retryCount,
                });
            } catch { /* 日志写入失败不阻塞主流程 */ }
        }

        let inputTokens = 0;
        let outputTokens = 0;

        // ─── 执行阶段追踪（用于超时/错误诊断） ────────────────────
        let execPhase = '初始化';           // 当前阶段描述
        let execToolCalls = 0;              // 已完成的工具调用次数
        let execLastToolName = '';          // 最后一次工具调用名称
        let execLastActivityAt = Date.now(); // 最后一次活动时间戳

        try {
            // 空闲超时：每 5s 检查一次距上次活动是否超过 timeout
            const idleCheckId = setInterval(() => {
                const idleMs = Date.now() - execLastActivityAt;
                if (idleMs >= timeout) {
                    clearInterval(idleCheckId);
                    const idleSec = (idleMs / 1000).toFixed(1);
                    const totalSec = ((Date.now() - startedAt) / 1000).toFixed(1);
                    const detail = execToolCalls > 0
                        ? `阶段: ${execPhase} | 已完成 ${execToolCalls} 次工具调用 | 最后工具: ${execLastToolName} | 空闲 ${idleSec}s | 总耗时 ${totalSec}s`
                        : `阶段: ${execPhase} | 尚无工具调用 | 空闲 ${idleSec}s | 总耗时 ${totalSec}s`;
                    if (logUri) { void appendLogLine(logUri, `⏰ **空闲超时** (${timeout / 1000}s 无活动) | ${detail}`); }
                    ac.abort(new Error(`空闲超时（${timeout / 1000}s 无活动）| ${detail}`));
                }
            }, 5_000);

            const isPA = role.isPersonalAssistant === true;
            const tools = isPA ? PERSONAL_ASSISTANT_TOOLS : CHAT_TOOLS;

            const messages = await this.buildMessages(uri, role);
            inputTokens = await estimateTokens(messages);

            // 日志：token 预估
            if (logUri) { void appendLogLine(logUri, `🔢 预估 input: **${inputTokens}** tokens`); }

            // token 门禁
            if (effectiveMaxTokens && inputTokens > effectiveMaxTokens) {
                throw new Error(`token 预算超限：预估 ${inputTokens}，上限 ${effectiveMaxTokens}`);
            }

            await updateConversationTokenUsed(uri, inputTokens);

            // 日志：发起请求（完整 messages 记录到 issueMarkdown）
            execPhase = '等待 LLM 首次响应';
            execLastActivityAt = Date.now();
            if (logUri) {
                // 构建请求快照
                const requestSnapshot = messages.map((m, i) => {
                    const roleLabel = (m as { role?: number }).role === 1 ? 'user' : 'assistant';
                    const text = m.content instanceof Array
                        ? m.content.map((p: unknown) => (p && typeof p === 'object' && 'value' in p) ? String((p as { value: unknown }).value ?? '') : '').join('')
                        : String(m.content ?? '');
                    return `### [${i}] ${roleLabel}\n\n${text}`;
                }).join('\n\n---\n\n');
                const toolNames = tools.map(t => t.name).join(', ');
                const fullContent = `**模型**: ${effectiveModelFamily} | **工具**: ${toolNames} | **tokens**: ${inputTokens} | **超时**: ${timeout / 1000}s\n\n---\n\n${requestSnapshot}`;

                if (runNumber > 0) {
                    let reqFileName: string | null = null;
                    try {
                        reqFileName = await createToolCallNode(logUri, 'llm_request', { model: effectiveModelFamily, tools: toolNames, inputTokens, timeout }, fullContent, 0, {
                            success: true,
                            description: 'LLM 请求快照',
                            sequence: 0,
                            runNumber,
                        });
                    } catch { /* 节点创建失败不阻塞 */ }

                    const reqLink = reqFileName
                        ? `[发起 LLM 请求](IssueDir/${reqFileName})`
                        : '发起 LLM 请求';
                    void appendLogLine(logUri, `🚀 ${reqLink}`);
                } else {
                    void appendLogLine(logUri, '🚀 发起 LLM 请求...');
                }
            }

            let toolCallSeq = 0;

            const result = await LLMService.streamWithTools(
                messages,
                tools,
                () => { /* 定时器模式：静默处理 */ },
                async (toolName, input) => {
                    const tcStart = Date.now();
                    toolCallSeq++;
                    execPhase = `执行工具 ${toolName} (#${toolCallSeq})`;
                    execLastActivityAt = Date.now();

                    // 日志：工具调用开始
                    if (logUri && !(isPA && toolName === 'delegate_to_role')) {
                        void appendLogLine(logUri, `⏳ 调用 \`${toolName}\`...`);
                    }

                    // PA 委派：记录意图（带链接）
                    if (isPA && toolName === 'delegate_to_role' && logUri) {
                        const targetRole = String((input as Record<string, unknown>).roleNameOrId || '');
                        const taskStr = String((input as Record<string, unknown>).task || '');

                        // 创建委派意图节点（完整任务内容记录在 issueMarkdown）
                        if (runNumber > 0) {
                            let intentFileName: string | null = null;
                            try {
                                intentFileName = await createToolCallNode(logUri, `delegate_intent:${targetRole}`, input, taskStr, 0, {
                                    success: true,
                                    description: `委派任务给「${targetRole}」`,
                                    sequence: toolCallSeq,
                                    runNumber,
                                });
                            } catch { /* 节点创建失败不阻塞 */ }

                            const intentLink = intentFileName
                                ? `[「${targetRole}」](IssueDir/${intentFileName})`
                                : `「${targetRole}」`;
                            void appendLogLine(logUri, `📤 **委派给${intentLink}**`);
                        } else {
                            void appendLogLine(logUri, `📤 **委派给「${targetRole}」**`);
                        }
                    }

                    const res = isPA
                        ? await executePersonalAssistantTool(toolName, input, ac.signal)
                        : await executeChatTool(toolName, input);
                    const dur = Date.now() - tcStart;

                    // 创建工具调用详情节点 + 日志摘要行（带链接）
                    if (logUri && runNumber > 0) {
                        const toolDef = tools.find(t => t.name === toolName);
                        let fileName: string | null = null;
                        try {
                            fileName = await createToolCallNode(logUri, toolName, input, res.content, dur, {
                                success: res.success,
                                description: toolDef?.description,
                                sequence: toolCallSeq,
                                runNumber,
                            });
                        } catch { /* 节点创建失败不阻塞 */ }

                        const toolLink = fileName
                            ? `[\`${toolName}\`](IssueDir/${fileName})`
                            : `\`${toolName}\``;

                        const statusIcon = res.success ? '✅' : '❌';
                        if (isPA && toolName === 'delegate_to_role') {
                            void appendLogLine(logUri, `📥${statusIcon} **委派结果** ${toolLink} (${fmtDuration(dur)})`);
                        } else {
                            void appendLogLine(logUri, `${statusIcon} ${toolLink} (${fmtDuration(dur)})`);
                        }
                    } else if (logUri) {
                        // runNumber 为 0（startLogRun 失败），仅写摘要
                        const statusIcon = res.success ? '✅' : '❌';
                        if (isPA && toolName === 'delegate_to_role') {
                            void appendLogLine(logUri, `📥${statusIcon} **委派结果** (${fmtDuration(dur)})`);
                        } else {
                            void appendLogLine(logUri, `${statusIcon} \`${toolName}\` (${fmtDuration(dur)})`);
                        }
                    }

                    // 工具完成，更新追踪
                    execToolCalls = toolCallSeq;
                    execLastToolName = toolName;
                    execPhase = `等待 LLM 响应（工具调用 #${toolCallSeq} 后）`;
                    execLastActivityAt = Date.now();

                    return res.content;
                },
                {
                    signal: ac.signal,
                    modelFamily: effectiveModelFamily,
                    onToolsDecided: (info) => {
                        if (!logUri) { return; }
                        const names = info.toolNames.map(n => `\`${n}\``).join(', ');
                        if (info.roundText) {
                            const thought = info.roundText.replace(/\n+/g, ' ').trim();
                            void appendLogLine(logUri, `🤖 **LLM 第${info.round}轮** → 调用 ${names} | 思考: ${summarize(thought, 80)}`);
                        } else {
                            void appendLogLine(logUri, `🤖 **LLM 第${info.round}轮** → 调用 ${names}`);
                        }
                    },
                },
            );

            clearInterval(idleCheckId);

            if (!result?.text) { throw new Error('LLM 返回空响应'); }

            // 成功：移除标记并追加助手回复
            await this.removeMarkerAndAppendAssistant(uri, result.text.trim());

            const outputMsg = vscode.LanguageModelChatMessage.Assistant(result.text);
            outputTokens = await estimateTokens([outputMsg]);
            await updateConversationTokenUsed(uri, inputTokens + outputTokens);

            // 日志：助手回复摘要（展示 LLM 的思考与输出）
            if (logUri && result.text) {
                const preview = result.text.trim().replace(/\n+/g, ' ');
                void appendLogLine(logUri, `💭 **助手回复**: ${summarize(preview, 200)}`);
            }

            // 日志：成功
            const dur = fmtDuration(Date.now() - startedAt);
            if (logUri) { void appendLogLine(logUri, `✅ **成功** | 耗时 ${dur} | input ${inputTokens} + output ${outputTokens} = ${inputTokens + outputTokens} tokens`); }

            logger.info(`[RoleTimerManager] 对话处理成功: ${filePath}`);
            this._onDidChange.fire({ uri, roleId: role.id, success: true });
        } catch (e) {
            // 优先使用 AbortController 的 abort reason（超时时携带具体原因）
            let errMsg: string;
            if (ac.signal.aborted && ac.signal.reason instanceof Error) {
                errMsg = ac.signal.reason.message;
            } else {
                errMsg = e instanceof Error ? e.message : String(e);
            }

            const nextRetry = retryCount + 1;
            const maxRetries = role.timerMaxRetries ?? 3;
            const dur = fmtDuration(Date.now() - startedAt);

            if (nextRetry > maxRetries) {
                await writeStateMarker(uri, { status: 'error', message: errMsg, retryCount: nextRetry });
                if (logUri) { void appendLogLine(logUri, `❌ **失败（已达最大重试 ${maxRetries} 次）** | 耗时 ${dur} | ${errMsg}`); }
                logger.error(`[RoleTimerManager] 已达最大重试次数(${maxRetries})，对话: ${filePath}，错误: ${errMsg}`);
            } else {
                const baseDelay = Number(role.timerRetryDelay) || 5_000;
                const delay = Math.max(1_000, baseDelay * Math.pow(2, retryCount));
                const retryAt = Date.now() + delay;
                await writeStateMarker(uri, {
                    status: 'retrying',
                    retryAt: Number.isFinite(retryAt) ? retryAt : Date.now() + 5_000,
                    retryCount: nextRetry,
                });
                if (logUri) { void appendLogLine(logUri, `⚠️ **失败 → 重试 (${nextRetry}/${maxRetries})** | ${Math.round(delay / 1000)}s 后重试 | 耗时 ${dur} | ${errMsg}`); }
                logger.warn(`[RoleTimerManager] 执行失败，${delay}ms 后重试(${nextRetry}/${maxRetries}): ${errMsg}`);
            }

            this._onDidChange.fire({ uri, roleId: role.id, success: false });
        } finally {
            this.executing.delete(filePath);
        }
    }

    /**
     * 移除状态标记并追加助手消息 —— 单次文件写入，保证原子性。
     */
    private async removeMarkerAndAppendAssistant(uri: vscode.Uri, content: string): Promise<void> {
        const raw = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
        const stripped = stripMarker(raw);
        const dateStr = formatTimestamp(Date.now());
        const block = `\n## Assistant (${dateStr})\n\n${content}\n`;
        await vscode.workspace.fs.writeFile(uri, Buffer.from(stripped + block, 'utf8'));
    }

    /** 构造发送给 LLM 的消息列表（包含系统提示词和对话历史） */
    private async buildMessages(uri: vscode.Uri, role: ChatRoleInfo): Promise<vscode.LanguageModelChatMessage[]> {
        const msgs: vscode.LanguageModelChatMessage[] = [];

        const systemText = role.systemPrompt
            ? `[系统指令] ${role.systemPrompt}`
            : '[系统指令] 你是一个智能助手，请根据对话上下文给出有帮助的回复。';
        msgs.push(vscode.LanguageModelChatMessage.User(systemText));

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

    /** 从对话文件 frontmatter 中提取 chat_role_id */
    private async getRoleIdFromFile(uri: vscode.Uri): Promise<string | undefined> {
        try {
            const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
            const match = /^chat_role_id:\s*(.+)$/m.exec(content);
            return match ? match[1].trim() : undefined;
        } catch {
            return undefined;
        }
    }
}

/** 截断字符串，超出 maxLen 时添加省略号 */
function summarize(text: string, maxLen: number): string {
    if (text.length <= maxLen) { return text; }
    return text.slice(0, maxLen - 1) + '…';
}

function formatTimestamp(ts: number): string {
    const d = new Date(ts);
    const p = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmtDuration(ms: number): string {
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}
