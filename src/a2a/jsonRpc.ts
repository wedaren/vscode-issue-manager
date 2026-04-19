/**
 * JSON-RPC 2.0 最小实现：解析请求、构造响应、分发到方法处理器。
 */
import * as http from 'http';
import { Logger } from '../core/utils/Logger';
import { JSONRPC_ERROR } from './types';
import type { JsonRpcRequest, JsonRpcResponse, JsonRpcErrorObject } from './types';

const logger = Logger.getInstance();
const MAX_BODY_BYTES = 4 * 1024 * 1024; // 4MB

export type MethodHandler = (params: unknown) => Promise<unknown>;

export interface RpcContext {
    /** 暴露的角色 id（来自 URL 路径 /agents/:roleId/rpc） */
    agentId: string;
}

/**
 * 解析 http 请求体为 JSON-RPC 请求对象。
 * 返回 [request, null] 或 [null, errorResponse]。
 */
export async function parseRpcRequest(
    req: http.IncomingMessage,
): Promise<[JsonRpcRequest, null] | [null, JsonRpcResponse]> {
    let raw: string;
    try {
        raw = await readBody(req);
    } catch (e) {
        return [null, errorResponse(null, JSONRPC_ERROR.ParseError, `请求体读取失败: ${(e as Error).message}`)];
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        return [null, errorResponse(null, JSONRPC_ERROR.ParseError, `JSON 解析失败: ${(e as Error).message}`)];
    }

    if (!parsed || typeof parsed !== 'object') {
        return [null, errorResponse(null, JSONRPC_ERROR.InvalidRequest, 'request 必须是对象')];
    }
    const obj = parsed as Record<string, unknown>;
    if (obj.jsonrpc !== '2.0') {
        return [null, errorResponse(obj.id as string | number | null ?? null, JSONRPC_ERROR.InvalidRequest, 'jsonrpc 字段必须为 "2.0"')];
    }
    if (typeof obj.method !== 'string') {
        return [null, errorResponse(obj.id as string | number | null ?? null, JSONRPC_ERROR.InvalidRequest, 'method 字段必须是字符串')];
    }

    const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: obj.method,
        params: obj.params,
        id: (obj.id as string | number | null | undefined) ?? null,
    };
    return [request, null];
}

/** 分发 request 到 handler，构造成功或错误响应。handler 异常自动转为 InternalError，除非抛出 JsonRpcError。 */
export async function dispatch(
    request: JsonRpcRequest,
    handlers: Record<string, MethodHandler>,
): Promise<JsonRpcResponse> {
    const handler = handlers[request.method];
    if (!handler) {
        return errorResponse(request.id ?? null, JSONRPC_ERROR.MethodNotFound, `未知方法: ${request.method}`);
    }

    try {
        const result = await handler(request.params);
        return {
            jsonrpc: '2.0',
            id: request.id ?? null,
            result,
        };
    } catch (e) {
        if (e instanceof JsonRpcError) {
            return errorResponse(request.id ?? null, e.code, e.message, e.data);
        }
        logger.error(`[A2A] RPC handler 异常 (${request.method})`, e);
        const msg = e instanceof Error ? e.message : String(e);
        return errorResponse(request.id ?? null, JSONRPC_ERROR.InternalError, `internal error: ${msg}`);
    }
}

export function errorResponse(
    id: string | number | null,
    code: number,
    message: string,
    data?: unknown,
): JsonRpcResponse {
    const error: JsonRpcErrorObject = { code, message };
    if (data !== undefined) { error.data = data; }
    return { jsonrpc: '2.0', id, error };
}

/** 供 handler 主动抛出的 RPC 错误，会被 dispatch 捕获并转为 error response。 */
export class JsonRpcError extends Error {
    constructor(public readonly code: number, message: string, public readonly data?: unknown) {
        super(message);
    }
}

async function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(new Error(`请求体超过 ${MAX_BODY_BYTES} 字节上限`));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}
