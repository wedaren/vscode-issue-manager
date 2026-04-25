/**
 * JSON-RPC 方法 `SubscribeToTask`（v1.0 §9.4.6）— 重新订阅已有 task 的流事件。
 *
 * 行为：
 *   - task 不存在 → JSON 错误响应 TaskNotFound
 *   - task 已终态 → SSE 发一次 statusUpdate 后关闭
 *   - task 仍在跑  → SSE 先发当前状态，再订阅 record.events，直到终态事件
 *
 * 与 SendStreamingMessage 共用 runner 发射的事件总线。
 */
import * as http from 'http';
import { Logger } from '../../core/utils/Logger';
import { JsonRpcError, errorResponse } from '../jsonRpc';
import type { TaskStore } from '../taskStore';
import type { JsonRpcRequest } from '../types';
import { A2A_ERROR, JSONRPC_ERROR } from '../types';
import {
    writeSSEHeaders,
    makeEventWriter,
    serializeStreamEvent,
} from './messageStream';

const logger = Logger.getInstance();

export async function handleTasksResubscribe(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    request: JsonRpcRequest,
    store: TaskStore,
): Promise<void> {
    let taskId: string;
    try {
        taskId = validateParams(request.params);
    } catch (e) {
        const err = e instanceof JsonRpcError
            ? errorResponse(request.id ?? null, e.code, e.message, e.data)
            : errorResponse(request.id ?? null, JSONRPC_ERROR.InternalError, (e as Error).message);
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(err));
        return;
    }

    const record = store.getTask(taskId);
    if (!record) {
        const err = errorResponse(request.id ?? null, A2A_ERROR.TaskNotFound, `task "${taskId}" 不存在`);
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(err));
        return;
    }

    writeSSEHeaders(res);
    const writeEvent = makeEventWriter(res, request.id ?? null);

    // 立即推送当前状态（v1.0 wire 格式）
    writeEvent({ task: record.task });

    // 已终态 → 直接关闭（发一次 statusUpdate 后关流，无 final 字段）
    if (!store.isCancelable(record.task.status.state)) {
        writeEvent(serializeStreamEvent({
            kind: 'status-update',
            taskId: record.task.id,
            contextId: record.task.contextId,
            task: record.task,
            final: true,
        }));
        res.end();
        return;
    }

    // 仍在跑 → 订阅后续事件
    const onClientClose = () => {
        subscription.dispose();
    };
    req.on('close', onClientClose);

    const subscription = record.events.event(ev => {
        writeEvent(serializeStreamEvent(ev));
        if (ev.kind === 'status-update' && ev.final) {
            subscription.dispose();
            req.off('close', onClientClose);
            if (!res.writableEnded) { res.end(); }
        }
    });

    // 兜底：Promise 永远 pending，直到 res 关闭（由上面的监听处理）
    await new Promise<void>(resolve => {
        res.once('close', () => {
            subscription.dispose();
            resolve();
        });
    });

    logger.info(`[A2A] resubscribe 到 task ${taskId} 完成`);
}

function validateParams(raw: unknown): string {
    if (!raw || typeof raw !== 'object') {
        throw new JsonRpcError(JSONRPC_ERROR.InvalidParams, 'params 必须是对象');
    }
    const id = (raw as Record<string, unknown>).id;
    if (typeof id !== 'string' || !id) {
        throw new JsonRpcError(JSONRPC_ERROR.InvalidParams, 'params.id 必填');
    }
    return id;
}
