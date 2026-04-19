/**
 * RPC 方法分发表构造器。server.ts 为每个 agent id 构造一套 handler。
 */
import type { MethodHandler } from '../jsonRpc';
import type { TaskStore } from '../taskStore';
import { createMessageSendHandler } from './messageSend';
import { createTasksGetHandler } from './tasksGet';
import { createTasksCancelHandler } from './tasksCancel';

export function buildHandlers(agentId: string, store: TaskStore): Record<string, MethodHandler> {
    return {
        'message/send': createMessageSendHandler(agentId, store),
        'tasks/get': createTasksGetHandler(store),
        'tasks/cancel': createTasksCancelHandler(store),
    };
}
