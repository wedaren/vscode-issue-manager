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
import * as path from 'path';
import { LLMService } from '../llm/LLMService';
import { whenCacheReady } from '../data/IssueMarkdowns';
import { Logger } from '../core/utils/Logger';
import {
    getAllChatRoles,
    getChatRoleById,
    getConversationsForRole,
    getConversationConfig,
    updateConversationTokenUsed,
    updateConversationTitle,
    getPendingContinuation,
    clearPendingContinuation,
    getAutoQueueCount,
    setAutoQueueCount,
    appendUserMessageQueued,
    estimateTokens,
    getOrCreateExecutionLog,
    startLogRun,
    appendLogLine,
    createToolCallNode,
} from './llmChatDataManager';
import { executeChatTool, getToolsForRole, type ToolExecContext } from './chatTools';
import { buildConversationMessages } from './messageBuilder';
import {
    readStateMarker,
    writeStateMarker,
    stripMarker,
} from './convStateMarker';
import type { ChatRoleInfo } from './types';
import { PostResponseHookRunner } from './hooks/PostResponseHookRunner';
import { titleGeneratorHook } from './hooks/titleGeneratorHook';
import { memoryExtractorHook } from './hooks/memoryExtractorHook';
import { intentAnchorHook } from './hooks/intentAnchorHook';
import { insightCrystallizerHook } from './hooks/insightCrystallizerHook';

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

    /** 执行中数量变化事件（开始/结束时触发），供状态栏使用 */
    private readonly _onExecutingCountChange = new vscode.EventEmitter<number>();
    readonly onExecutingCountChange = this._onExecutingCountChange.event;

    /** 当前正在执行的对话数量 */
    get executingCount(): number { return this.executing.size; }

    /** 当前正在执行的对话文件路径列表 */
    get executingPaths(): string[] { return [...this.executing]; }

    private readonly _disposables: vscode.Disposable[] = [];
    private _watcherDebounce: ReturnType<typeof setTimeout> | undefined;
    private readonly _hookRunner = new PostResponseHookRunner();

    /** 全局调试开关：ON 时无视角色/对话配置，强制生成所有日志 */
    private _debugLogAll = false;
    get debugLogAll(): boolean { return this._debugLogAll; }
    set debugLogAll(value: boolean) { this._debugLogAll = value; }

    private constructor() {
        this._hookRunner.register('titleGenerator', titleGeneratorHook);
        this._hookRunner.register('intentAnchor', intentAnchorHook);
        this._hookRunner.register('memoryExtractor', memoryExtractorHook);
        this._hookRunner.register('insightCrystallizer', insightCrystallizerHook);
    }

    static getInstance(): RoleTimerManager {
        if (!RoleTimerManager._instance) {
            RoleTimerManager._instance = new RoleTimerManager();
        }
        return RoleTimerManager._instance;
    }

    // ─── 生命周期 ────────────────────────────────────────────

    /** 启动：读取所有角色配置并为启用的角色创建定时器，同时监听角色文件变化和保存事件 */
    async start(): Promise<void> {
        await whenCacheReady;
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

    /** 检查某个对话是否正在执行中（内存锁） */
    isExecuting(uri: vscode.Uri): boolean {
        return this.executing.has(uri.fsPath);
    }

    /**
     * 立即触发指定对话的处理（用户提交后绕过定时器等待）。
     * 若对话状态不是 queued，或正在执行中，则忽略。
     */
    async triggerConversation(uri: vscode.Uri): Promise<void> {
        if (this.executing.has(uri.fsPath)) { return; }

        const marker = await readStateMarker(uri);
        // queued：正常排队；retrying：等待重试中，保存可强制立即重试（跳过 retryAt 延迟）
        if (!marker || (marker.status !== 'queued' && marker.status !== 'retrying')) { return; }

        const roleId = await this.getRoleIdFromFile(uri);
        if (!roleId) { return; }

        const role = await getChatRoleById(roleId);
        if (!role) { return; }

        void this.executeConversation(uri, role, 'save');
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
                void this.executeConversation(convo.uri, role, 'timer');
            }
        }
    }

    // ─── 内部：LLM 执行 ──────────────────────────────────────

    private async executeConversation(uri: vscode.Uri, role: ChatRoleInfo, trigger: 'timer' | 'save' = 'timer'): Promise<void> {
        const filePath = uri.fsPath;
        this.executing.add(filePath);
        this._onExecutingCountChange.fire(this.executing.size);

        // 若用户在 <!-- llm:ready --> 后直接输入内容，自动补全 ## User (ts) 标头
        await this._normalizePendingInput(uri);

        const currentMarker = await readStateMarker(uri);
        const retryCount = currentMarker?.retryCount ?? 0;
        const startedAt = Date.now();

        // 标记为执行中（持久化，崩溃后可检测）
        await writeStateMarker(uri, { status: 'executing', startedAt, retryCount });

        logger.info(`[RoleTimerManager] 开始处理对话: ${filePath}（尝试 #${retryCount + 1}）`);

        const timeout = role.timerTimeout ?? 60_000;
        const ac = new AbortController();

        const convoConfig = await getConversationConfig(uri);

        // ── 日志生成开关：全局调试 ON 覆盖一切；否则 对话级 > 角色级 > 默认 false ──
        const effectiveLogEnabled = this._debugLogAll || (convoConfig?.logEnabled ?? role.logEnabled ?? false);
        let logUri: vscode.Uri | null = null;
        if (effectiveLogEnabled) {
            try { logUri = await getOrCreateExecutionLog(uri); } catch { /* 忽略 */ }
        }
        const effectiveModelFamily = convoConfig?.modelFamily || role.modelFamily;
        const effectiveMaxTokens = convoConfig?.maxTokens ?? role.maxTokens;

        let runNumber = 0;
        if (logUri) {
            try {
                runNumber = await startLogRun(logUri, {
                    trigger,
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

            const tools = getToolsForRole(role);
            const toolContext: ToolExecContext = {
                role,
                conversationUri: uri,
                signal: ac.signal,
                // 心跳回调：长时间工具（如同步委派等待）定期调用，刷新空闲计时
                onHeartbeat: () => { execLastActivityAt = Date.now(); },
            };

            const messages = await buildConversationMessages(uri, role);
            // [systemMsg, userMsg] = 首轮对话，无历史 assistant 消息
            const isFirstResponse = messages.length === 2;
            // 提取首条用户消息文本，供 hook 使用（避免 hook 内重复读文件）
            const firstUserText = isFirstResponse ? extractMessageText(messages[1]) : '';
            inputTokens = await estimateTokens(messages);

            // 日志：token 预估
            if (logUri) { void appendLogLine(logUri, `🔢 预估 input: **${inputTokens}** tokens`); }

            // token 门禁
            if (effectiveMaxTokens && inputTokens > effectiveMaxTokens) {
                throw new Error(`token 预算超限：预估 ${inputTokens}，上限 ${effectiveMaxTokens}`);
            }

            await updateConversationTokenUsed(uri, inputTokens, effectiveMaxTokens);

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

            // 状态栏：开始执行
            vscode.window.setStatusBarMessage(`$(loading~spin) ${role.name} 思考中...`, 60000);

            let toolCallSeq = 0;
            let currentRound = 0;
            const roundReasonings = new Map<number, string>(); // round → 推理文本
            const toolCallItems: Array<{ name: string; time: Date; dur: number; fileName: string | null; success: boolean; round: number; delegationHint?: string }> = [];

            const result = await LLMService.streamWithTools(
                messages,
                tools,
                () => { /* 定时器模式：静默处理 */ },
                async (toolName, input) => {
                    const tcStart = Date.now();
                    toolCallSeq++;
                    execPhase = `执行工具 ${toolName} (#${toolCallSeq})`;
                    execLastActivityAt = Date.now();
                    const isDelegation = toolName === 'delegate_to_role';

                    // 日志：工具调用开始
                    if (logUri && !isDelegation) {
                        void appendLogLine(logUri, `⏳ 调用 \`${toolName}\`...`);
                    }

                    // 委派：记录意图（带链接）
                    if (isDelegation && logUri) {
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

                    // 工具执行期间自动刷新空闲计时，防止慢工具被误杀
                    // （委派工具已有自己的 onHeartbeat，但普通工具没有）
                    const toolHeartbeatId = setInterval(() => { execLastActivityAt = Date.now(); }, 10_000);
                    let res: Awaited<ReturnType<typeof executeChatTool>>;
                    try {
                        res = await executeChatTool(toolName, input, toolContext);
                    } finally {
                        clearInterval(toolHeartbeatId);
                    }
                    const dur = Date.now() - tcStart;

                    // 创建工具调用详情节点 + 日志摘要行（带链接）
                    let fileName: string | null = null;
                    if (logUri && runNumber > 0) {
                        const toolDef = tools.find((t: { name: string }) => t.name === toolName);
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

                        const statusIcon = res.success ? '✓' : '❌';
                        if (isDelegation) {
                            void appendLogLine(logUri, `📥${statusIcon} **委派结果** ${toolLink} (${fmtDuration(dur)})`);
                        } else {
                            void appendLogLine(logUri, `${statusIcon} ${toolLink} (${fmtDuration(dur)})`);
                        }
                    } else if (logUri) {
                        // runNumber 为 0（startLogRun 失败），仅写摘要
                        const statusIcon = res.success ? '✓' : '❌';
                        if (isDelegation) {
                            void appendLogLine(logUri, `📥${statusIcon} **委派结果** (${fmtDuration(dur)})`);
                        } else {
                            void appendLogLine(logUri, `${statusIcon} \`${toolName}\` (${fmtDuration(dur)})`);
                        }
                    }

                    // 工具完成，更新追踪
                    // 委派类工具：提取内联摘要（目标角色 + 回复预览）
                    let delegationHint: string | undefined;
                    if ((toolName === 'delegate_to_role' || toolName === 'continue_delegation') && res.success) {
                        const targetRole = String((input as Record<string, unknown>).roleNameOrId || (input as Record<string, unknown>).convoId || '');
                        // 从结果中提取角色名 **[角色名 的回复]** 或 **[角色名 的追问回复]**
                        const roleMatch = /\*\*\[(.+?) 的(?:追问)?回复\]\*\*/.exec(res.content);
                        const replyRole = roleMatch?.[1] || targetRole;
                        // 提取回复正文预览（跳过标题行和尾部提示）
                        const bodyMatch = res.content.match(/\*\*\n\n([\s\S]*?)\n\n---/);
                        const replyPreview = bodyMatch?.[1]
                            ? summarize(bodyMatch[1].replace(/\n+/g, ' ').trim(), 60)
                            : '';
                        delegationHint = replyPreview
                            ? `→ ${replyRole}: ${replyPreview}`
                            : `→ ${replyRole}`;
                    }
                    toolCallItems.push({ name: toolName, time: new Date(tcStart), dur, fileName, success: res.success, round: currentRound, delegationHint });
                    execToolCalls = toolCallSeq;
                    execLastToolName = toolName;
                    execPhase = `等待 LLM 响应（工具调用 #${toolCallSeq} 后）`;
                    execLastActivityAt = Date.now();

                    // 结果过大时外存引用，避免超出 token 上限
                    return buildToolResultForLlm(res.content, fileName);
                },
                {
                    signal: ac.signal,
                    modelFamily: effectiveModelFamily,
                    onToolsDecided: (info) => {
                        currentRound = info.round;
                        if (info.roundText) {
                            roundReasonings.set(info.round, info.roundText.trim());
                        }
                        // 状态栏反馈
                        const toolList = info.toolNames.join(', ');
                        vscode.window.setStatusBarMessage(`$(loading~spin) ${role.name}: ${toolList}...`, 30000);
                        if (!logUri) { return; }
                        const names = info.toolNames.map(n => `\`${n}\``).join(', ');
                        if (info.roundText) {
                            const thought = info.roundText.replace(/\n+/g, ' ').trim();
                            void appendLogLine(logUri, `🤖 **LLM 第${info.round}轮** → 调用 ${names} | 思考: ${summarize(thought, 80)}`);
                        } else {
                            void appendLogLine(logUri, `🤖 **LLM 第${info.round}轮** → 调用 ${names}`);
                        }
                    },
                    onFinalRound: (info) => {
                        if (!logUri) { return; }
                        const hint = info.toolCallsTotal > 0
                            ? `（完成 ${info.toolCallsTotal} 轮工具调用后）`
                            : '（无工具调用）';
                        void appendLogLine(logUri, `⏳ **LLM 第${info.round}轮（最终）** → 期望：生成完整回复 ${hint}`);
                    },
                },
            );

            clearInterval(idleCheckId);

            if (!result?.text) {
                const hint = toolCallSeq > 0
                    ? `（已完成 ${toolCallSeq} 次工具调用，最后一个工具：\`${execLastToolName}\`）`
                    : '';
                throw new Error(`LLM 返回空响应${hint}，可能原因：上下文过长 / 模型响应异常`);
            }

            // 成功：移除标记并追加助手回复（思考过程 + 工具调用在前，回复文本在后）
            let toolPrologue: string | undefined;
            if (toolCallSeq > 0) {
                const lines: string[] = [];
                let lastRound = -1;
                for (const item of toolCallItems) {
                    if (item.round !== lastRound) {
                        const reasoning = roundReasonings.get(item.round);
                        if (reasoning) {
                            // 截取思考文本，避免过长
                            const thought = reasoning.replace(/\n+/g, ' ').slice(0, 200);
                            lines.push(`> 💭 ${thought}`);
                        }
                        lastRound = item.round;
                    }
                    const t = fmtHms(item.time);
                    const icon = item.success ? '✓' : '❌';
                    const nameStr = item.fileName
                        ? `[\`${item.name}\`](IssueDir/${item.fileName})`
                        : `\`${item.name}\``;
                    const delegSuffix = item.delegationHint ? ` ${item.delegationHint}` : '';
                    lines.push(`> 📎 \`${t}\` ${icon} ${nameStr} (${fmtDuration(item.dur)})${delegSuffix}`);
                }
                if (logUri) {
                    const logId = path.basename(logUri.fsPath, '.md');
                    lines.push(`> [执行详情](IssueDir/${logId}.md)`);
                }
                toolPrologue = lines.join('\n');
            }
            await this.removeMarkerAndAppendAssistant(uri, result.text.trim(), toolPrologue);

            // 触发 post-response hooks（fire-and-forget，不阻塞主流程）
            // messages 末尾始终是当前用户消息
            const lastUserText = extractMessageText(messages[messages.length - 1]);
            this._hookRunner.fire({
                uri,
                conversationId: path.basename(uri.fsPath, '.md'),
                role,
                isFirstResponse,
                firstUserText,
                lastUserText,
                assistantText: result.text.trim(),
                notifyChange: (p) => this._onDidChange.fire(p),
            });

            const outputMsg = vscode.LanguageModelChatMessage.Assistant(result.text);
            outputTokens = await estimateTokens([outputMsg]);
            await updateConversationTokenUsed(uri, inputTokens + outputTokens, effectiveMaxTokens);

            // 日志：助手回复摘要（展示 LLM 的思考与输出）
            if (logUri && result.text) {
                const preview = result.text.trim().replace(/\n+/g, ' ');
                void appendLogLine(logUri, `💭 **助手回复**: ${summarize(preview, 200)}`);
            }

            // 日志：成功
            const dur = fmtDuration(Date.now() - startedAt);
            if (logUri) { void appendLogLine(logUri, `✓ **成功** | 耗时 ${dur} | input ${inputTokens} + output ${outputTokens} = ${inputTokens + outputTokens} tokens`); }

            // ─── 续写提升：将 queue_continuation 暂存的消息转为 queued ──
            // run 成功结束后，状态标记已被清除，可以安全追加消息
            const pendingMsg = await getPendingContinuation(uri);
            if (pendingMsg) {
                await clearPendingContinuation(uri);
                try {
                    await appendUserMessageQueued(uri, pendingMsg);
                    const newCount = await getAutoQueueCount(uri) + 1;
                    await setAutoQueueCount(uri, newCount);
                    logger.info(`[RoleTimerManager] 已提升续写消息（累计第 ${newCount} 次）: ${filePath}`);
                } catch (promoteErr) {
                    logger.error('[RoleTimerManager] 续写消息提升失败', promoteErr);
                }
            }

            // 状态栏：完成
            vscode.window.setStatusBarMessage(`$(check) ${role.name} 回复完成`, 3000);
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
                const retryAt = Number.isFinite(Date.now() + delay) ? Date.now() + delay : Date.now() + 5_000;
                await writeStateMarker(uri, {
                    status: 'retrying',
                    retryAt,
                    retryCount: nextRetry,
                });
                const retryAtStr = new Date(retryAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                if (logUri) { void appendLogLine(logUri, `⚠️ **失败 → 重试 (${nextRetry}/${maxRetries})** | ${Math.round(delay / 1000)}s 后重试（${retryAtStr}）| 耗时 ${dur} | ${errMsg}`); }
                logger.warn(`[RoleTimerManager] 执行失败，${delay}ms 后重试(${nextRetry}/${maxRetries}): ${errMsg}`);
            }

            // run 失败时清空待续写消息，避免错误状态下死循环
            await clearPendingContinuation(uri).catch(() => {});

            this._onDidChange.fire({ uri, roleId: role.id, success: false });
        } finally {
            this.executing.delete(filePath);
            this._onExecutingCountChange.fire(this.executing.size);
        }
    }

    /**
     * 处理用户在 <!-- llm:ready --> 后直接输入内容的场景：
     *   Case A：body 末尾为 <!-- llm:ready -->\n用户内容\n<!-- llm:queued --> → 自动插入 ## User (ts)
     *   Case B：body 无 ## User/## Assistant 历史但有内容（用户从空文件直接输入）→ 同上
     */
    private async _normalizePendingInput(uri: vscode.Uri): Promise<void> {
        const raw = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
        if (!/<!--\s*llm:queued\s*-->\s*$/.test(raw)) { return; }

        // 分离 frontmatter block 与 body（支持 LF / CRLF）
        const fmMatch = /^(---\r?\n[\s\S]*?\r?\n---\r?\n)([\s\S]*)$/.exec(raw);
        if (!fmMatch) { return; }
        const fmBlock = fmMatch[1];
        const bodyFull = fmMatch[2];

        const bodyWithoutQueued = bodyFull.replace(/\n*<!--\s*llm:queued\s*-->\s*$/, '').trimEnd();

        // ── Case A: <!-- llm:ready --> + 用户内容 ─────────────────
        const readyMatch = /^([\s\S]*?)<!--\s*llm:ready\s*-->\r?\n+([\s\S]+?)\s*$/.exec(bodyWithoutQueued);
        if (readyMatch) {
            const userContent = readyMatch[2].trim();
            if (!userContent) { return; }
            const before = readyMatch[1].trimEnd();
            const dateStr = formatTimestamp(Date.now());
            const newBody = `${before}\n\n## User (${dateStr})\n\n${userContent}\n\n<!-- llm:queued -->\n`;
            await vscode.workspace.fs.writeFile(uri, Buffer.from(fmBlock + newBody, 'utf8'));
            return;
        }

        // ── Case B: 无 <!-- llm:ready -->，无历史消息，直接在文件中输入 ──
        const hasHistory = /^## (?:User|Assistant)\s*\(/m.test(bodyWithoutQueued);
        if (!hasHistory) {
            const titleMatch = /^(#+[^\n]*\n+)/.exec(bodyWithoutQueued);
            const titlePart = titleMatch ? titleMatch[0] : '';
            const userContent = bodyWithoutQueued.slice(titlePart.length).trim();
            if (!userContent) { return; }
            const dateStr = formatTimestamp(Date.now());
            const newBody = `${titlePart}## User (${dateStr})\n\n${userContent}\n\n<!-- llm:queued -->\n`;
            await vscode.workspace.fs.writeFile(uri, Buffer.from(fmBlock + newBody, 'utf8'));
        }
    }

    /**
     * 移除状态标记并追加助手消息 —— 单次文件写入，保证原子性。
     */
    private async removeMarkerAndAppendAssistant(uri: vscode.Uri, content: string, toolPrologue?: string): Promise<void> {
        const raw = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
        const stripped = stripMarker(raw);
        const dateStr = formatTimestamp(Date.now());
        // 思考过程 + 工具调用在前，回复文本在后
        const body = toolPrologue ? `${toolPrologue}\n\n${content}` : content;
        const block = `\n## Assistant (${dateStr})\n\n${body}\n\n<!-- llm:ready -->\n`;
        await vscode.workspace.fs.writeFile(uri, Buffer.from(stripped + block, 'utf8'));
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

function fmtHms(d: Date): string {
    const p = (n: number) => n.toString().padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmtDuration(ms: number): string {
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

/**
 * 决定工具结果如何传回给 LLM。
 * - 结果较小（≤ INLINE_MAX_CHARS）：直接 inline
 * - 结果过大且已写入文件：传引用 + 预览，让 LLM 自主决定是否读取完整内容
 * - 结果过大但文件写入失败：截断并附注
 */
const INLINE_MAX_CHARS = 16000;

/** 从 LanguageModelChatMessage 中提取纯文本内容 */
function extractMessageText(msg: vscode.LanguageModelChatMessage): string {
    if (msg.content instanceof Array) {
        return msg.content
            .map((p: unknown) => (p && typeof p === 'object' && 'value' in p) ? String((p as { value: unknown }).value ?? '') : '')
            .join('');
    }
    return String((msg as unknown as { content: unknown }).content ?? '');
}

function buildToolResultForLlm(content: string, fileName: string | null): string {
    if (content.length <= INLINE_MAX_CHARS) {
        return content;
    }
    if (fileName) {
        const preview = content.slice(0, 300).trimEnd();
        return `[工具结果（${content.length} 字符）](IssueDir/${fileName})\n预览：${preview}${content.length > 300 ? '\n...' : ''}\n如需完整内容，请调用 read_issue("${fileName}")`;
    }
    // 文件写入失败时兜底截断
    return content.slice(0, INLINE_MAX_CHARS) + `\n...[内容已截断，原始长度 ${content.length} 字符]`;
}
