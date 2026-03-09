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
} from './llmChatDataManager';
import { CHAT_TOOLS, executeChatTool } from './chatTools';
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

        // 标记为执行中（持久化，崩溃后可检测）
        await writeStateMarker(uri, {
            status: 'executing',
            startedAt: Date.now(),
            retryCount,
        });

        logger.info(`[RoleTimerManager] 开始处理对话: ${filePath}（尝试 #${retryCount + 1}）`);

        try {
            const timeout = role.timerTimeout ?? 60_000;
            const ac = new AbortController();
            const timeoutId = setTimeout(() => ac.abort(), timeout);

            const messages = await this.buildMessages(uri, role);
            const result = await LLMService.streamWithTools(
                messages,
                CHAT_TOOLS,
                () => { /* 定时器模式：静默处理，不需要流式推送 */ },
                async (toolName, input) => {
                    const res = await executeChatTool(toolName, input);
                    return res.content;
                },
                { signal: ac.signal, modelFamily: role.modelFamily },
            );

            clearTimeout(timeoutId);

            if (!result?.text) { throw new Error('LLM 返回空响应'); }

            // 成功：移除标记并追加助手回复（单次写入）
            await this.removeMarkerAndAppendAssistant(uri, result.text.trim());

            logger.info(`[RoleTimerManager] 对话处理成功: ${filePath}`);
            this._onDidChange.fire({ uri, roleId: role.id, success: true });
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            const nextRetry = retryCount + 1;
            const maxRetries = role.timerMaxRetries ?? 3;

            if (nextRetry > maxRetries) {
                await writeStateMarker(uri, {
                    status: 'error',
                    message: errMsg,
                    retryCount: nextRetry,
                });
                logger.error(`[RoleTimerManager] 已达最大重试次数(${maxRetries})，对话: ${filePath}，错误: ${errMsg}`);
            } else {
                const baseDelay = role.timerRetryDelay ?? 5_000;
                const delay = baseDelay * Math.pow(2, retryCount); // 指数退避
                await writeStateMarker(uri, {
                    status: 'retrying',
                    retryAt: Date.now() + delay,
                    retryCount: nextRetry,
                });
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

function formatTimestamp(ts: number): string {
    const d = new Date(ts);
    const p = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
