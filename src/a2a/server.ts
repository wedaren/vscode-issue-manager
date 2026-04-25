/**
 * A2A HTTP server。
 *
 * 绑定 127.0.0.1（不暴露公网），提供：
 *   - GET /agents               — 列出暴露的角色 id（M1-3 实现）
 *   - GET /agents/:roleId/.well-known/agent.json — agent card（M1-3 实现）
 *   - POST /agents/:roleId/rpc  — JSON-RPC 2.0 endpoint（M1-4 实现）
 *
 * 生命周期：
 *   - start(): 尝试绑定 resolveBindPort() 决定的端口；失败降级为 OS 分配
 *   - stop(): 关闭 server + 中止所有活跃任务（M1-4 接入）
 *   - restart(): 配置变更时调用
 */
import * as vscode from 'vscode';
import * as http from 'http';
import { Logger } from '../core/utils/Logger';
import type { A2AConfig } from './config';
import { resolveBindPort, writeLastPort } from './config';
import type { A2AAuth } from './auth';
import { listExposedRoles, findExposedRole, buildAgentCard, getExternalAgentId } from './agentCard';
import { TaskStore } from './taskStore';
import { parseRpcRequest, dispatch } from './jsonRpc';
import { buildHandlers } from './methods';
import { handleMessageStream } from './methods/messageStream';
import { handleTasksResubscribe } from './methods/tasksResubscribe';

const BIND_HOST = '127.0.0.1';
const logger = Logger.getInstance();

export class A2AServer {
    private server: http.Server | undefined;
    private actualPort = 0;
    private readonly taskStore = new TaskStore();

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly auth: A2AAuth,
    ) {}

    /** 当前监听端口（0 表示未启动） */
    get port(): number { return this.actualPort; }

    /** 对外访问基址，如 `http://127.0.0.1:12345`。未启动返回 undefined。 */
    get baseUrl(): string | undefined {
        return this.actualPort ? `http://${BIND_HOST}:${this.actualPort}` : undefined;
    }

    async start(config: A2AConfig): Promise<void> {
        if (this.server) { return; }

        this.server = http.createServer((req, res) => this.handleRequest(req, res));

        const desiredPort = resolveBindPort(config);
        try {
            await this.listenOn(desiredPort);
        } catch (e) {
            // 绑定失败（端口占用等）→ 降级让 OS 分配
            if (desiredPort !== 0) {
                const msg = e instanceof Error ? e.message : String(e);
                logger.warn(`[A2A] 端口 ${desiredPort} 绑定失败（${msg}），降级为 OS 分配端口`);
                void vscode.window.showWarningMessage(
                    `A2A 端口 ${desiredPort} 不可用，已自动切换到随机端口 (http://${BIND_HOST}:${this.actualPort})。`,
                );
                await this.listenOn(0);
            } else {
                throw e;
            }
        }

        await writeLastPort(this.context, this.actualPort);
        logger.info(`[A2A] server 已启动: ${this.baseUrl}`);
    }

    async stop(): Promise<void> {
        const server = this.server;
        this.server = undefined;
        this.actualPort = 0;
        // 中止所有活跃任务（保证 server 干净退出，不留下工具调用孤儿进程）
        this.taskStore.dispose();
        if (!server) { return; }
        await new Promise<void>((resolve) => {
            server.close(() => resolve());
        });
        logger.info('[A2A] server 已停止');
    }

    async restart(config: A2AConfig): Promise<void> {
        await this.stop();
        await this.start(config);
    }

    private listenOn(port: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const server = this.server;
            if (!server) {
                reject(new Error('server not initialized'));
                return;
            }
            const onError = (err: Error) => {
                server.off('listening', onListening);
                reject(err);
            };
            const onListening = () => {
                server.off('error', onError);
                const addr = server.address();
                this.actualPort = typeof addr === 'object' && addr ? addr.port : 0;
                resolve();
            };
            server.once('error', onError);
            server.once('listening', onListening);
            server.listen(port, BIND_HOST);
        });
    }

    /**
     * 请求分发。M1-1 先返回 501，后续 milestone 接入路由。
     * 所有响应统一 `application/json; charset=utf-8`。
     */
    private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            // 防御：拒绝非 loopback（http 模块已绑定 127.0.0.1，此处是二次确认）
            const remote = req.socket.remoteAddress ?? '';
            if (remote && remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
                writeJson(res, 403, { error: 'loopback only' });
                return;
            }

            // Agent card 与 agents 列表免鉴权（A2A spec：agent card 用于发现）
            const path = (req.url ?? '').split('?')[0];
            const agentCardMatch = /^\/agents\/([^/]+)\/\.well-known\/agent\.json$/.exec(path);
            const rpcMatch = /^\/agents\/([^/]+)\/rpc$/.exec(path);
            const isDiscovery = req.method === 'GET' && (path === '/agents' || agentCardMatch);

            if (!isDiscovery) {
                const ok = await this.auth.verify(req.headers['authorization']);
                if (!ok) {
                    res.writeHead(401, {
                        'Content-Type': 'application/json; charset=utf-8',
                        'WWW-Authenticate': 'Bearer realm="A2A"',
                    });
                    res.end(JSON.stringify({ error: 'unauthorized' }));
                    return;
                }
            }

            // ─── 路由分发 ────────────────────────────────────────
            if (req.method === 'GET' && path === '/agents') {
                const roles = listExposedRoles().map(r => {
                    const agentId = getExternalAgentId(r);
                    return {
                        id: agentId,
                        name: r.a2a.name ?? r.name,
                        agentCard: `${this.baseUrl}/agents/${encodeURIComponent(agentId)}/.well-known/agent.json`,
                    };
                });
                writeJson(res, 200, { agents: roles });
                return;
            }

            if (req.method === 'GET' && agentCardMatch) {
                const agentId = decodeURIComponent(agentCardMatch[1]);
                const role = findExposedRole(agentId);
                if (!role) {
                    writeJson(res, 404, { error: `agent "${agentId}" 不存在或未暴露` });
                    return;
                }
                const baseUrl = this.baseUrl;
                if (!baseUrl) {
                    writeJson(res, 500, { error: 'server 未就绪' });
                    return;
                }
                writeJson(res, 200, buildAgentCard(role, baseUrl));
                return;
            }

            if (req.method === 'POST' && rpcMatch) {
                const agentId = decodeURIComponent(rpcMatch[1]);
                const role = findExposedRole(agentId);
                if (!role) {
                    writeJson(res, 404, { error: `agent "${agentId}" 不存在或未暴露` });
                    return;
                }
                const [request, errResp] = await parseRpcRequest(req);
                if (errResp) {
                    writeJson(res, 400, errResp);
                    return;
                }
                // SendStreamingMessage 与 SubscribeToTask 单独走 SSE 路径；其余方法统一 JSON 响应
                if (request.method === 'SendStreamingMessage') {
                    await handleMessageStream(req, res, request, agentId, this.taskStore);
                    return;
                }
                if (request.method === 'SubscribeToTask') {
                    await handleTasksResubscribe(req, res, request, this.taskStore);
                    return;
                }
                const handlers = buildHandlers(agentId, this.taskStore);
                const response = await dispatch(request, handlers);
                writeJson(res, 200, response);
                return;
            }

            writeJson(res, 404, { error: 'not found', path, method: req.method });
        } catch (e) {
            logger.error('[A2A] 请求处理异常', e);
            if (!res.headersSent) {
                writeJson(res, 500, { error: 'internal error' });
            }
        }
    }
}

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
}
