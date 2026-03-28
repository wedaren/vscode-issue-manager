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
import { whenCacheReady } from '../data/IssueMarkdowns';
import { Logger } from '../core/utils/Logger';
import {
    getAllChatRoles,
    getChatRoleById,
    getConversationsForRole,
    getConversationConfig,
    getPendingContinuation,
    clearPendingContinuation,
    getAutoQueueCount,
    setAutoQueueCount,
    appendUserMessageQueued,
} from './llmChatDataManager';
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
import { executeConversation as execConversation } from './ConversationExecutor';

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

        const idleTimeout = role.timerTimeout ?? 60_000;
        const maxExecution = role.timerMaxExecution ?? 600_000;
        const ac = new AbortController();

        // 自主模式：timer 触发 → 无人值守；save（用户手动）→ 取配置
        const convoConfig = await getConversationConfig(uri);
        const isAutonomous = trigger === 'timer'
            ? true
            : (convoConfig?.autonomous ?? role.autonomous ?? false);

        // ─── 空闲超时 + 总执行时间检查（调度层职责，不下沉到 executor） ──
        let execLastActivityAt = Date.now();

        try {
            const idleCheckId = setInterval(() => {
                const now = Date.now();
                const totalMs = now - startedAt;
                if (totalMs >= maxExecution) {
                    clearInterval(idleCheckId);
                    ac.abort(new Error(`总执行超时（${maxExecution / 1000}s 上限）`));
                    return;
                }
                const idleMs = now - execLastActivityAt;
                if (idleMs >= idleTimeout) {
                    clearInterval(idleCheckId);
                    ac.abort(new Error(`空闲超时（${idleTimeout / 1000}s 无活动）`));
                }
            }, 5_000);

            // 状态栏
            vscode.window.setStatusBarMessage(`$(loading~spin) ${role.name} 思考中...`, 60000);

            // ─── 调用统一执行引擎 ────────────────────────────────
            const result = await execConversation(uri, role, {
                trigger,
                signal: ac.signal,
                autonomous: isAutonomous,
                logEnabled: this._debugLogAll || (convoConfig?.logEnabled ?? role.logEnabled ?? false),
                toolTimeout: role.timerToolTimeout ?? 60_000,
                onHeartbeat: () => { execLastActivityAt = Date.now(); },
                onToolActivity: () => { execLastActivityAt = Date.now(); },
            });

            clearInterval(idleCheckId);

            // ─── 成功：写入回复 + 触发 hooks ─────────────────────
            await this.removeMarkerAndAppendAssistant(uri, result.text, result.toolPrologue);

            this._hookRunner.fire({
                uri,
                conversationId: path.basename(uri.fsPath, '.md'),
                role,
                isFirstResponse: result.isFirstResponse,
                firstUserText: result.firstUserText,
                lastUserText: result.lastUserText,
                assistantText: result.text,
                notifyChange: (p) => this._onDidChange.fire(p),
            });

            // ─── 续写提升 ───────────────────────────────────────
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

            vscode.window.setStatusBarMessage(`$(check) ${role.name} 回复完成`, 3000);
            logger.info(`[RoleTimerManager] 对话处理成功: ${filePath}`);
            this._onDidChange.fire({ uri, roleId: role.id, success: true });
        } catch (e) {
            let errMsg: string;
            if (ac.signal.aborted && ac.signal.reason instanceof Error) {
                errMsg = ac.signal.reason.message;
            } else {
                errMsg = e instanceof Error ? e.message : String(e);
            }

            const nextRetry = retryCount + 1;
            const maxRetries = role.timerMaxRetries ?? 3;

            if (nextRetry > maxRetries) {
                await writeStateMarker(uri, { status: 'error', message: errMsg, retryCount: nextRetry });
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

function formatTimestamp(ts: number): string {
    const d = new Date(ts);
    const p = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
