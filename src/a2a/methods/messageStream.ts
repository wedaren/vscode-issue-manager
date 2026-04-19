/**
 * JSON-RPC 方法 `message/stream` — SSE 流式响应。
 *
 * 走独立路径（非 dispatch），直接写 `text/event-stream`。
 * 实际流事件由 runner.ts 通过 TaskRecord.events 发射，本函数订阅后转写为 SSE。
 *
 * 每条 SSE 事件包一层 JSON-RPC response，`result` 字段携带 A2A 事件对象。
 */
import * as http from 'http';
import { Logger } from '../../core/utils/Logger';
import { runTask, validateSendParams } from './runner';
import { JsonRpcError, errorResponse } from '../jsonRpc';
import type { TaskStore, TaskStreamEvent } from '../taskStore';
import type { JsonRpcRequest } from '../types';
import { A2A_ERROR, JSONRPC_ERROR } from '../types';

const logger = Logger.getInstance();

export async function handleMessageStream(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    request: JsonRpcRequest,
    agentId: string,
    store: TaskStore,
): Promise<void> {
    // 参数校验：失败时用 JSON 响应而非 SSE
    let params;
    try {
        params = validateSendParams(request.params);
    } catch (e) {
        const err = e instanceof JsonRpcError
            ? errorResponse(request.id ?? null, e.code, e.message, e.data)
            : errorResponse(request.id ?? null, JSONRPC_ERROR.InternalError, (e as Error).message);
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(err));
        return;
    }

    writeSSEHeaders(res);

    const writeEvent = makeEventWriter(res, request.id ?? null);

    // 客户端主动断开 → 取消任务
    let activeTaskId: string | undefined;
    const onClientClose = () => {
        if (activeTaskId) {
            logger.info(`[A2A] 客户端断开连接，取消 task ${activeTaskId}`);
            store.cancelTask(activeTaskId);
        }
    };
    req.on('close', onClientClose);

    try {
        await runTask(agentId, store, params, {
            onStart: (record) => {
                activeTaskId = record.task.id;
                // 首个事件：完整的 Task 对象（state=submitted）
                writeEvent(record.task);
                // 订阅后续事件
                record.events.event(ev => writeEvent(serializeStreamEvent(ev)));
            },
        });
    } catch (e) {
        if (e instanceof JsonRpcError) {
            writeEvent({ error: { code: e.code, message: e.message, data: e.data } });
        } else {
            logger.error('[A2A] message/stream 异常', e);
            writeEvent({ error: { code: A2A_ERROR.UnsupportedOperation, message: (e as Error).message } });
        }
    } finally {
        req.off('close', onClientClose);
        if (!res.writableEnded) { res.end(); }
    }
}

// ─── SSE 工具 ────────────────────────────────────────────────

export function writeSSEHeaders(res: http.ServerResponse): void {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
}

export function makeEventWriter(res: http.ServerResponse, rpcId: string | number | null) {
    return (result: unknown): void => {
        if (res.writableEnded || res.destroyed) { return; }
        const payload = { jsonrpc: '2.0', id: rpcId, result };
        try {
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
        } catch (e) {
            logger.warn('[A2A] SSE write 失败', e);
        }
    };
}

/** 把内部 TaskStreamEvent 转成 A2A spec 约定的事件对象。 */
export function serializeStreamEvent(ev: TaskStreamEvent): unknown {
    if (ev.kind === 'artifact-update') {
        return {
            kind: 'artifact-update',
            taskId: ev.taskId,
            contextId: ev.contextId,
            artifact: {
                artifactId: ev.artifactId,
                name: 'response',
                parts: [{ kind: 'text', text: ev.text }],
            },
            append: ev.append,
            lastChunk: ev.lastChunk,
        };
    }
    // status-update
    return {
        kind: 'status-update',
        taskId: ev.taskId,
        contextId: ev.contextId,
        status: ev.task.status,
        final: ev.final,
    };
}
