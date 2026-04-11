/**
 * ExecutionContext — 统一执行上下文
 *
 * 替代散落在 ExecutionOptions / ToolExecContext / streamWithTools 之间的 7 个回调，
 * 将活动追踪、日志写入、工具可见性三个横切关注点收敛到一个对象。
 *
 * 生命周期：
 *   - RoleTimerManager / LLMChatService 通过 ExecutionContext.create() 创建
 *   - 传入 ConversationExecutor → LLMService inline handlers → chatTools
 *   - 委派场景通过 createChildContext() 派生子上下文，heartbeat 自动传播到父
 */
import * as vscode from 'vscode';
import type { ChatRoleInfo } from './types';
import { getToolsForRole } from './chatTools';
import {
    getOrCreateExecutionLog,
    startLogRun,
    appendLogLine,
} from './llmChatDataManager';

// ─── 创建参数 ────────────────────────────────────────────────

export interface ExecutionContextInit {
    role: ChatRoleInfo;
    conversationUri: vscode.Uri;
    signal?: AbortSignal;
    trigger: 'direct' | 'timer' | 'save';
    autonomous?: boolean;
    logEnabled?: boolean;
    toolTimeout?: number;
    delegationDepth?: number;
    delegationTotalCalls?: number;
    retryCount?: number;
    /** 流式 chunk 回调（UI 路径需要） */
    onChunk?: (chunk: string) => void;
    /** 工具状态回调（UI 路径可选） */
    onToolStatus?: (status: { toolName: string; phase: 'calling' | 'done'; result?: string }) => void;
}

// ─── 核心类 ──────────────────────────────────────────────────

export class ExecutionContext {
    // ─── 活动追踪 ────────────────────────────────────────────
    private _lastActivityAt: number = Date.now();
    private readonly _parent?: ExecutionContext;

    /** 重置空闲计时器。任何层在任何活跃时刻调用即可，自动传播到父上下文。 */
    heartbeat(): void {
        this._lastActivityAt = Date.now();
        this._parent?.heartbeat();
    }

    /** 返回最后一次活动的时间戳（ms），供 idle timer 检查。 */
    get lastActivityAt(): number { return this._lastActivityAt; }

    // ─── 日志 ────────────────────────────────────────────────
    readonly logUri: vscode.Uri | null;
    readonly runNumber: number;

    /** 向执行日志追加一行。内部串行写入，fire-and-forget，不会抛异常。 */
    log(line: string): void {
        if (this.logUri) {
            void appendLogLine(this.logUri, line);
        }
    }

    // ─── 工具可见性 ──────────────────────────────────────────
    readonly availableTools: ReadonlySet<string>;

    // ─── 不可变上下文 ────────────────────────────────────────
    readonly role: ChatRoleInfo;
    readonly conversationUri: vscode.Uri;
    readonly signal?: AbortSignal;
    readonly trigger: 'direct' | 'timer' | 'save';
    readonly autonomous: boolean;
    readonly toolTimeout: number;
    readonly delegationDepth: number;
    readonly delegationTotalCalls: number;

    // ─── UI 回调（仍需独立传递，非横切关注点） ───────────────
    readonly onChunk?: (chunk: string) => void;
    readonly onToolStatus?: (status: { toolName: string; phase: 'calling' | 'done'; result?: string }) => void;

    // ─── 私有构造 ────────────────────────────────────────────

    private constructor(
        init: Omit<ExecutionContextInit, 'logEnabled' | 'retryCount'>,
        logUri: vscode.Uri | null,
        runNumber: number,
        availableTools: ReadonlySet<string>,
        parent?: ExecutionContext,
    ) {
        this.role = init.role;
        this.conversationUri = init.conversationUri;
        this.signal = init.signal;
        this.trigger = init.trigger;
        this.autonomous = init.autonomous ?? false;
        this.toolTimeout = init.toolTimeout ?? 60_000;
        this.delegationDepth = init.delegationDepth ?? 0;
        this.delegationTotalCalls = init.delegationTotalCalls ?? 0;
        this.onChunk = init.onChunk;
        this.onToolStatus = init.onToolStatus;
        this.logUri = logUri;
        this.runNumber = runNumber;
        this.availableTools = availableTools;
        this._parent = parent;
    }

    // ─── 工厂方法 ────────────────────────────────────────────

    /**
     * 创建顶层执行上下文。异步，因为需要初始化日志文件和计算可用工具集。
     */
    static async create(init: ExecutionContextInit): Promise<ExecutionContext> {
        // 日志初始化
        let logUri: vscode.Uri | null = null;
        let runNumber = 0;
        if (init.logEnabled) {
            try { logUri = await getOrCreateExecutionLog(init.conversationUri); } catch { /* ignore */ }
        }
        if (logUri) {
            try {
                runNumber = await startLogRun(logUri, {
                    trigger: init.trigger,
                    roleName: init.role.name,
                    modelFamily: init.role.modelFamily,
                    timeout: init.toolTimeout,
                    maxTokens: init.role.maxTokens,
                    retryCount: init.retryCount,
                });
            } catch { /* ignore */ }
        }

        // 工具可见性
        const tools = getToolsForRole(init.role);
        const availableTools = new Set(tools.map(t => t.name));

        return new ExecutionContext(init, logUri, runNumber, availableTools);
    }

    /**
     * 为委派创建子上下文。heartbeat 自动传播到父。
     */
    async createChildContext(
        childRole: ChatRoleInfo,
        childConvoUri: vscode.Uri,
        overrides?: { autonomous?: boolean; toolTimeout?: number },
    ): Promise<ExecutionContext> {
        // 子上下文始终启用日志
        let logUri: vscode.Uri | null = null;
        let runNumber = 0;
        try { logUri = await getOrCreateExecutionLog(childConvoUri); } catch { /* ignore */ }
        if (logUri) {
            try {
                runNumber = await startLogRun(logUri, {
                    trigger: 'direct',
                    roleName: childRole.name,
                    modelFamily: childRole.modelFamily,
                    timeout: overrides?.toolTimeout ?? childRole.timerToolTimeout ?? this.toolTimeout,
                });
            } catch { /* ignore */ }
        }

        const childTools = getToolsForRole(childRole);
        const availableTools = new Set(childTools.map(t => t.name));

        return new ExecutionContext(
            {
                role: childRole,
                conversationUri: childConvoUri,
                signal: this.signal, // 继承父的中止信号
                trigger: 'direct',
                autonomous: overrides?.autonomous ?? true, // 委派默认自主
                toolTimeout: overrides?.toolTimeout ?? childRole.timerToolTimeout ?? this.toolTimeout,
                delegationDepth: this.delegationDepth + 1,
                delegationTotalCalls: this.delegationTotalCalls + 1,
                // 子上下文不需要 UI 回调
            },
            logUri,
            runNumber,
            availableTools,
            this, // parent — heartbeat 传播
        );
    }
}
