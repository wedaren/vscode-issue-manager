/**
 * A2A spec 类型（简化版，只包含 Phase 1 需要的字段）。
 * 完整规范见 https://a2a-protocol.org/latest/specification/
 */

export type A2ATaskState =
    | 'submitted'
    | 'working'
    | 'input-required'
    | 'completed'
    | 'failed'
    | 'canceled'
    | 'rejected'
    | 'auth-required';

export interface A2ATextPart {
    kind: 'text';
    text: string;
}

/** Phase 1 只支持文本 part */
export type A2APart = A2ATextPart;

export interface A2AMessage {
    role: 'user' | 'agent';
    parts: A2APart[];
    messageId?: string;
    taskId?: string;
    contextId?: string;
    kind: 'message';
}

export interface A2ATaskStatus {
    state: A2ATaskState;
    message?: A2AMessage;
    timestamp?: string;
}

export interface A2ATask {
    id: string;
    contextId: string;
    status: A2ATaskStatus;
    history?: A2AMessage[];
    metadata?: Record<string, unknown>;
    kind: 'task';
}

// ─── JSON-RPC 2.0 ──────────────────────────────────────────────

export interface JsonRpcRequest {
    jsonrpc: '2.0';
    method: string;
    params?: unknown;
    id?: string | number | null;
}

export interface JsonRpcErrorObject {
    code: number;
    message: string;
    data?: unknown;
}

export interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: string | number | null;
    result?: unknown;
    error?: JsonRpcErrorObject;
}

// ─── A2A 标准错误码（spec §7）────────────────────────────────

export const A2A_ERROR = {
    TaskNotFound: -32001,
    TaskNotCancelable: -32002,
    PushNotificationNotSupported: -32003,
    UnsupportedOperation: -32004,
    ContentTypeNotSupported: -32005,
} as const;

export const JSONRPC_ERROR = {
    ParseError: -32700,
    InvalidRequest: -32600,
    MethodNotFound: -32601,
    InvalidParams: -32602,
    InternalError: -32603,
} as const;
