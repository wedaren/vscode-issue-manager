/**
 * JSON-RPC 方法 `tasks/get` — 根据 taskId 返回当前任务状态。
 */
import { JsonRpcError } from '../jsonRpc';
import type { TaskStore } from '../taskStore';
import { A2A_ERROR, JSONRPC_ERROR } from '../types';
import type { A2ATask } from '../types';

export function createTasksGetHandler(store: TaskStore) {
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
        return record.task;
    };
}
