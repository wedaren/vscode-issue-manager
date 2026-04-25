/**
 * JSON-RPC 方法 `message/send` — 同步执行 task 到终态后返回。
 * 复用 runner.ts 的核心逻辑（不提供 onChunk 回调，流式由 message/stream 负责）。
 */
import { runTask, validateSendParams } from './runner';
import type { TaskStore } from '../taskStore';
import type { A2ATask } from '../types';

export function createMessageSendHandler(agentId: string, store: TaskStore) {
    return async (rawParams: unknown): Promise<A2ATask> => {
        const params = validateSendParams(rawParams);
        return runTask(agentId, store, params);
    };
}
