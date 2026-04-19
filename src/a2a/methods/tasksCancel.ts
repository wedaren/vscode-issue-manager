/**
 * JSON-RPC 方法 `tasks/cancel` — 中止正在执行的任务。
 * 已处于终态（completed/failed/canceled/rejected）的任务返回 TaskNotCancelable。
 */
import { JsonRpcError } from '../jsonRpc';
import type { TaskStore } from '../taskStore';
import { A2A_ERROR, JSONRPC_ERROR } from '../types';
import type { A2ATask } from '../types';

export function createTasksCancelHandler(store: TaskStore) {
    return async (rawParams: unknown): Promise<A2ATask> => {
        if (!rawParams || typeof rawParams !== 'object') {
            throw new JsonRpcError(JSONRPC_ERROR.InvalidParams, 'params 必须是对象');
        }
        const taskId = (rawParams as Record<string, unknown>).id;
        if (typeof taskId !== 'string' || !taskId) {
            throw new JsonRpcError(JSONRPC_ERROR.InvalidParams, 'params.id 必填');
        }

        const record = store.getTask(taskId);
        if (!record) {
            throw new JsonRpcError(A2A_ERROR.TaskNotFound, `task "${taskId}" 不存在`);
        }
        if (!store.isCancelable(record.task.status.state)) {
            throw new JsonRpcError(
                A2A_ERROR.TaskNotCancelable,
                `task 处于终态 "${record.task.status.state}"，不可取消`,
            );
        }
        store.cancelTask(taskId);
        return record.task;
    };
}
