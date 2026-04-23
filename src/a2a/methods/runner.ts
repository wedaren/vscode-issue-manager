/**
 * Task 执行器 — message/send 与 message/stream 共享的核心逻辑。
 *
 * 流程：
 *   1. 校验参数与角色
 *   2. 获取/创建 contextId 对应的对话文件
 *   3. 创建 task（submitted → working）并调用 callbacks.onStart
 *   4. 执行 executeConversation，流式 chunk 通过 callbacks.onChunk 透传
 *   5. 终态（completed/failed/canceled）更新 task.status
 *
 * `onStart` 在 task 进入 working 状态前触发，用于 SSE 发送初始 Task 事件。
 * `onChunk` 在 LLM 每个流式 chunk 到达时触发，用于 SSE 发送 artifact-update。
 */
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { Logger } from '../../core/utils/Logger';
import {
    createConversation,
    appendMessageToConversation,
    A2A_TASKS_SUBDIR,
} from '../../llmChat/llmChatDataManager';
import { ExecutionContext } from '../../llmChat/ExecutionContext';
import { executeConversation } from '../../llmChat/ConversationExecutor';
import { RoleTimerManager } from '../../llmChat/RoleTimerManager';
import { findExposedRole } from '../agentCard';
import { JsonRpcError } from '../jsonRpc';
import type { TaskStore, TaskRecord, TaskStreamEvent } from '../taskStore';
import {
    A2A_ERROR,
    JSONRPC_ERROR,
} from '../types';
import type {
    A2ATask,
    A2AMessage,
    A2ATaskState,
    A2ATextPart,
} from '../types';

const logger = Logger.getInstance();

// ─── 参数校验 ────────────────────────────────────────────────

export interface ValidatedSendParams {
    message: {
        role?: string;
        parts: A2ATextPart[];
        messageId?: string;
        contextId?: string;
    };
}

export function validateSendParams(raw: unknown): ValidatedSendParams {
    if (!raw || typeof raw !== 'object') {
        throw new JsonRpcError(JSONRPC_ERROR.InvalidParams, 'params 必须是对象');
    }
    const obj = raw as Record<string, unknown>;
    const message = obj.message;
    if (!message || typeof message !== 'object') {
        throw new JsonRpcError(JSONRPC_ERROR.InvalidParams, 'params.message 必填');
    }
    const msg = message as Record<string, unknown>;
    if (!Array.isArray(msg.parts) || msg.parts.length === 0) {
        throw new JsonRpcError(JSONRPC_ERROR.InvalidParams, 'params.message.parts 必填且至少一个 part');
    }

    const textParts: A2ATextPart[] = [];
    for (const p of msg.parts) {
        if (p && typeof p === 'object') {
            const text = (p as Record<string, unknown>).text;
            if (typeof text === 'string') {
                textParts.push({ text });
            }
        }
        // 非文本 part：此版本不支持；跳过
    }
    if (textParts.length === 0) {
        throw new JsonRpcError(A2A_ERROR.ContentTypeNotSupported, 'message 中未找到可处理的 text part');
    }

    return {
        message: {
            role: typeof msg.role === 'string' ? msg.role : undefined,
            parts: textParts,
            messageId: typeof msg.messageId === 'string' ? msg.messageId : undefined,
            contextId: typeof msg.contextId === 'string' ? msg.contextId : undefined,
        },
    };
}

export function extractUserText(params: ValidatedSendParams): string {
    return params.message.parts.map(p => p.text).join('\n').trim();
}

// ─── 执行 hook ──────────────────────────────────────────────

export interface TaskRunHooks {
    /**
     * task 记录创建后、执行开始前**同步**触发。
     * 调用方应在此时订阅 record.events，以确保不遗漏任何事件。
     */
    onStart?: (record: TaskRecord) => void;
}

// ─── 核心执行器 ──────────────────────────────────────────────

/**
 * 执行一次 A2A task：同步等到终态（completed/failed/canceled），返回最终 task。
 *
 * 执行期间通过 `record.events` 推送状态变更与 artifact chunk，供 SSE 订阅者消费。
 * 调用方在 `onStart` 中订阅事件 — 该 hook 在任何事件 fire 之前同步执行。
 */
export async function runTask(
    agentId: string,
    store: TaskStore,
    params: ValidatedSendParams,
    hooks?: TaskRunHooks,
): Promise<A2ATask> {
    const role = findExposedRole(agentId);
    if (!role) {
        throw new JsonRpcError(JSONRPC_ERROR.InvalidParams, `agent "${agentId}" 不存在或未暴露`);
    }

    const userText = extractUserText(params);
    const contextId = params.message.contextId ?? store.generateContextId();

    return store.withContextLock(contextId, async () => {
        const convoUri = await ensureConversation(store, contextId, role.id, userText);

        // 创建 task 记录（submitted）— 此时尚无订阅者
        const record = store.createTask(contextId);
        store.setConversationUri(record.task.id, convoUri);

        // onStart 必须同步订阅 events；任何异步都会漏掉首个事件
        hooks?.onStart?.(record);

        // 切到 working 状态并发射第一次 status-update
        store.updateStatus(record.task.id, 'TASK_STATE_WORKING');
        record.events.fire(statusUpdateEvent(record.task, false));
        await appendMessageToConversation(convoUri, 'user', userText);

        // 注册到 RoleTimerManager 的 executing 集合 — 让状态栏 / 树视图 spinner 能感知 A2A 任务
        const timerMgr = RoleTimerManager.getInstance();
        timerMgr.registerExecution(convoUri);
        let execSuccess = false;

        const artifactId = `artifact-${crypto.randomBytes(6).toString('hex')}`;
        let chunkCount = 0;

        try {
            const execCtx = await ExecutionContext.create({
                role,
                conversationUri: convoUri,
                signal: record.abortController.signal,
                trigger: 'a2a',
                autonomous: true,
                // A2A 外部调用默认强制开启日志（设计决策：失败也要可审计）
                logEnabled: true,
                toolTimeout: role.timerToolTimeout,
                onChunk: (chunk: string) => {
                    chunkCount++;
                    record.events.fire({
                        kind: 'artifact-update',
                        taskId: record.task.id,
                        contextId,
                        artifactId,
                        text: chunk,
                        append: chunkCount > 1,
                        lastChunk: false,
                    } satisfies TaskStreamEvent);
                },
            });

            const result = await executeConversation(convoUri, role, {
                trigger: 'a2a',
                ctx: execCtx,
            });

            const fullReply = result.toolPrologue
                ? `${result.toolPrologue}\n\n${result.text}`
                : result.text;
            await appendMessageToConversation(convoUri, 'assistant', fullReply);

            const agentMessage = buildAgentMessage(record, contextId, result.text);
            store.updateStatus(record.task.id, 'TASK_STATE_COMPLETED', agentMessage);
            execSuccess = true;
        } catch (e) {
            const isAbort = record.abortController.signal.aborted;
            const state: A2ATaskState = isAbort ? 'TASK_STATE_CANCELED' : 'TASK_STATE_FAILED';
            const errMsg = e instanceof Error ? e.message : String(e);
            logger.warn(`[A2A] task ${record.task.id} ${state}: ${errMsg}`);
            const errorMessage = buildAgentMessage(record, contextId, errMsg);
            store.updateStatus(record.task.id, state, errorMessage);
        } finally {
            timerMgr.unregisterExecution(convoUri, role.id, execSuccess);
        }

        // 最终事件：终态（final=true）— 订阅者据此关闭 SSE 连接
        record.events.fire(statusUpdateEvent(record.task, true));
        return record.task;
    });
}

function statusUpdateEvent(task: A2ATask, final: boolean): TaskStreamEvent {
    return {
        kind: 'status-update',
        taskId: task.id,
        contextId: task.contextId,
        task,
        final,
    };
}

// ─── 辅助 ────────────────────────────────────────────────────

async function ensureConversation(
    store: TaskStore,
    contextId: string,
    roleId: string,
    userText: string,
): Promise<vscode.Uri> {
    let convoUri = store.getConvoForContext(contextId);
    if (convoUri) { return convoUri; }

    const titleHint = userText.length > 40 ? userText.slice(0, 40) + '…' : userText;
    const created = await createConversation(roleId, {
        title: `[A2A] ${titleHint}`,
        subdir: A2A_TASKS_SUBDIR,
        extraFrontmatter: { a2a_context_id: contextId },
    });
    if (!created) {
        throw new JsonRpcError(JSONRPC_ERROR.InternalError, '创建对话文件失败');
    }
    convoUri = created;
    store.setConvoForContext(contextId, convoUri);
    return convoUri;
}

function buildAgentMessage(record: TaskRecord, contextId: string, text: string): A2AMessage {
    return {
        role: 'ROLE_AGENT',
        parts: [{ text } satisfies A2ATextPart],
        messageId: crypto.randomUUID(),
        taskId: record.task.id,
        contextId,
    };
}
