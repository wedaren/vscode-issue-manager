/**
 * A2A spec 类型（v1.0，只包含 Phase 1 需要的字段）。
 * 完整规范见 https://a2a-protocol.org/latest/specification/
 */

export type A2ATaskState =
    | 'TASK_STATE_SUBMITTED'
    | 'TASK_STATE_WORKING'
    | 'TASK_STATE_INPUT_REQUIRED'
    | 'TASK_STATE_COMPLETED'
    | 'TASK_STATE_FAILED'
    | 'TASK_STATE_CANCELED'
    | 'TASK_STATE_REJECTED'
    | 'TASK_STATE_AUTH_REQUIRED';

/** v1.0: TextPart 通过 text 成员存在性判别，无 kind 字段 */
export interface A2ATextPart {
    text: string;
}

/** fileWithBytes：内联 base64 编码的文件内容（推荐，自包含） */
export interface A2AFileWithBytes {
    name?: string;
    mimeType?: string;
    bytes: string;
}

/** fileWithUri：外部 URI 引用（入方向暂不自动 fetch） */
export interface A2AFileWithUri {
    name?: string;
    mimeType?: string;
    uri: string;
}

/** v1.0: FilePart 通过 file 成员存在性判别；file 是 fileWithBytes 或 fileWithUri 二选一 */
export interface A2AFilePart {
    file: A2AFileWithBytes | A2AFileWithUri;
}

export type A2APart = A2ATextPart | A2AFilePart;

/** Type guards — v1.0 part 通过成员存在性判别，而非 kind 字段 */
export function isA2ATextPart(p: A2APart): p is A2ATextPart {
    return typeof (p as A2ATextPart).text === 'string';
}
export function isA2AFilePart(p: A2APart): p is A2AFilePart {
    const fp = p as A2AFilePart;
    return !!fp.file && typeof fp.file === 'object';
}
export function isFileWithBytes(f: A2AFileWithBytes | A2AFileWithUri): f is A2AFileWithBytes {
    return typeof (f as A2AFileWithBytes).bytes === 'string';
}

export interface A2AMessage {
    role: 'ROLE_USER' | 'ROLE_AGENT';
    parts: A2APart[];
    messageId?: string;
    taskId?: string;
    contextId?: string;
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
}

/** v1.0 wire 格式的 StreamResponse result */
export interface A2AStreamResponse {
    task?: A2ATask;
    message?: A2AMessage;
    statusUpdate?: {
        taskId: string;
        contextId?: string;
        status: A2ATaskStatus;
        metadata?: Record<string, unknown>;
    };
    artifactUpdate?: {
        taskId: string;
        contextId?: string;
        artifact: {
            artifactId: string;
            name?: string;
            parts: A2APart[];
            append?: boolean;
            lastChunk?: boolean;
        };
    };
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
