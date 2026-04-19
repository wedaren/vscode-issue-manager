/**
 * 内存任务状态存储。
 *
 * 职责：
 *   - 维护 taskId → TaskRecord
 *   - 维护 contextId → 对话文件 URI（用于同 contextId 消息续写同一对话）
 *   - 提供 per-contextId 串行锁，避免同一会话并发竞态写入
 *   - 管理每个 task 的 AbortController，供 tasks/cancel 使用
 *
 * Phase 1 不持久化：进程重启后任务状态丢失（但对话文件仍在 .a2a-tasks/ 下，
 * 调用方可通过 A2A 重新发起 message/send 创建新 task 续写）。
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { A2ATask, A2ATaskState, A2AMessage } from './types';

/**
 * Task 运行期内推送的流事件。由 runner.ts 发射，
 * 被 message/stream 和 tasks/resubscribe 两条路径共同订阅。
 */
export type TaskStreamEvent =
    | { kind: 'status-update'; taskId: string; contextId: string; task: A2ATask; final: boolean }
    | {
        kind: 'artifact-update';
        taskId: string;
        contextId: string;
        artifactId: string;
        text: string;
        append: boolean;
        lastChunk: boolean;
    };

export interface TaskRecord {
    task: A2ATask;
    abortController: AbortController;
    /** 关联的对话文件 URI（用于 resubscribe / 日志审计） */
    conversationUri?: vscode.Uri;
    /** 事件总线：runner 发射 → message/stream 与 tasks/resubscribe 订阅 */
    events: vscode.EventEmitter<TaskStreamEvent>;
}

export class TaskStore {
    private tasks = new Map<string, TaskRecord>();
    private contextToConvo = new Map<string, vscode.Uri>();
    private contextLocks = new Map<string, Promise<unknown>>();

    // ─── ID 生成 ────────────────────────────────────────────

    generateTaskId(): string { return `a2a-task-${crypto.randomBytes(8).toString('hex')}`; }
    generateContextId(): string { return `a2a-ctx-${crypto.randomBytes(8).toString('hex')}`; }

    // ─── Task 生命周期 ───────────────────────────────────────

    createTask(contextId: string): TaskRecord {
        const taskId = this.generateTaskId();
        const record: TaskRecord = {
            task: {
                id: taskId,
                contextId,
                status: { state: 'submitted', timestamp: new Date().toISOString() },
                kind: 'task',
            },
            abortController: new AbortController(),
            events: new vscode.EventEmitter<TaskStreamEvent>(),
        };
        this.tasks.set(taskId, record);
        return record;
    }

    getTask(taskId: string): TaskRecord | undefined {
        return this.tasks.get(taskId);
    }

    updateStatus(taskId: string, state: A2ATaskState, message?: A2AMessage): void {
        const record = this.tasks.get(taskId);
        if (!record) { return; }
        record.task.status = {
            state,
            message,
            timestamp: new Date().toISOString(),
        };
    }

    setConversationUri(taskId: string, uri: vscode.Uri): void {
        const record = this.tasks.get(taskId);
        if (record) { record.conversationUri = uri; }
    }

    /** 是否处于可取消状态。终态任务不能取消。 */
    isCancelable(state: A2ATaskState): boolean {
        return state === 'submitted' || state === 'working' || state === 'input-required';
    }

    cancelTask(taskId: string): boolean {
        const record = this.tasks.get(taskId);
        if (!record || !this.isCancelable(record.task.status.state)) { return false; }
        record.abortController.abort();
        this.updateStatus(taskId, 'canceled');
        return true;
    }

    // ─── Context ↔ Conversation 映射 ─────────────────────────

    getConvoForContext(contextId: string): vscode.Uri | undefined {
        return this.contextToConvo.get(contextId);
    }

    setConvoForContext(contextId: string, uri: vscode.Uri): void {
        this.contextToConvo.set(contextId, uri);
    }

    // ─── Per-contextId 串行锁 ────────────────────────────────

    /**
     * 同一 contextId 的所有调用按顺序串行执行，避免并发写入同一对话文件。
     * 不同 contextId 并行。
     *
     * 注意：Phase 1 不清理 contextLocks 条目 — contextId 数量有界，
     * 内存占用可接受。Phase 2 可加基于活跃度的 GC。
     */
    async withContextLock<T>(contextId: string, fn: () => Promise<T>): Promise<T> {
        const prev = this.contextLocks.get(contextId) ?? Promise.resolve();
        const next = prev.then(fn, fn);
        // 存入的 promise 必须不会 reject，否则后续链式调用会拒绝传播
        this.contextLocks.set(contextId, next.catch(() => undefined));
        return next;
    }

    // ─── 清理（Phase 2 可加） ────────────────────────────────

    dispose(): void {
        for (const record of this.tasks.values()) {
            if (this.isCancelable(record.task.status.state)) {
                record.abortController.abort();
            }
            record.events.dispose();
        }
        this.tasks.clear();
        this.contextToConvo.clear();
        this.contextLocks.clear();
    }
}
