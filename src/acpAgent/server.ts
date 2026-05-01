/**
 * ACP server over stdio (JSON-RPC 2.0)。
 *
 * PoC 实现的方法:
 *   - initialize          (协议版本 + 能力协商)
 *   - session/new         (创建会话)
 *   - session/prompt      (跑一次 prompt turn,响应里返回 stopReason)
 *
 * PoC 发出的通知:
 *   - session/update      (推流 agent_message_chunk / tool_call / tool_call_complete)
 *
 * 不在 PoC 范围:authenticate / session/load / session/cancel / session/set_mode /
 *               fs/* / terminal/* / Plan updates / Permission requests
 */

import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import type { IssueCoreServices } from "../services/issue-core";
import { Agent, type ContentBlock } from "./agent";
import type { LlmConfig } from "./llmClient";

// ─── JSON-RPC 类型 ─────────────────────────────────────────────

interface JsonRpcRequest {
    jsonrpc: "2.0";
    id: number | string;
    method: string;
    params?: Record<string, unknown>;
}

interface JsonRpcNotification {
    jsonrpc: "2.0";
    method: string;
    params?: Record<string, unknown>;
}

interface JsonRpcResponse {
    jsonrpc: "2.0";
    id: number | string;
    result?: unknown;
    error?: { code: number; message: string };
}

const PROTOCOL_VERSION = 1;

// ─── Server ──────────────────────────────────────────────────

export interface AcpServerOptions {
    services: IssueCoreServices;
    llmConfig: LlmConfig;
    /** stdin 流(默认 process.stdin) */
    input?: Readable;
    /** stdout 流(默认 process.stdout) */
    output?: Writable;
}

interface SessionState {
    id: string;
    agent: Agent;
}

export class AcpServer {
    private readonly sessions = new Map<string, SessionState>();
    private readonly input: Readable;
    private readonly output: Writable;
    private buffer = "";

    constructor(private readonly opts: AcpServerOptions) {
        this.input = opts.input ?? process.stdin;
        this.output = opts.output ?? process.stdout;
    }

    /** 启动 stdio 监听 */
    start(): void {
        this.input.setEncoding("utf-8");
        this.input.on("data", (chunk: string) => this.onData(chunk));
        this.input.on("end", () => process.exit(0));
        this.input.on("error", err => {
            process.stderr.write(`[acp-agent] stdin error: ${err}\n`);
            process.exit(1);
        });
    }

    private onData(chunk: string): void {
        this.buffer += chunk;
        // ACP / MCP stdio 用 newline-delimited JSON
        const lines = this.buffer.split("\n");
        this.buffer = lines.pop() ?? "";
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) { continue; }
            this.handleLine(trimmed).catch(err => {
                process.stderr.write(`[acp-agent] handler error: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
            });
        }
    }

    private async handleLine(line: string): Promise<void> {
        let msg: JsonRpcRequest | JsonRpcNotification;
        try { msg = JSON.parse(line) as JsonRpcRequest | JsonRpcNotification; }
        catch (err) {
            process.stderr.write(`[acp-agent] invalid JSON: ${line.slice(0, 200)}\n`);
            return;
        }
        if (!("id" in msg) || msg.id === undefined) {
            // notification — PoC 不接受任何客户端通知
            return;
        }
        const req = msg as JsonRpcRequest;
        try {
            const result = await this.dispatch(req.method, req.params ?? {});
            this.send({ jsonrpc: "2.0", id: req.id, result });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.send({ jsonrpc: "2.0", id: req.id, error: { code: -32000, message } });
        }
    }

    private async dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
        switch (method) {
            case "initialize":
                return this.handleInitialize();
            case "session/new":
                return this.handleSessionNew();
            case "session/prompt":
                return this.handleSessionPrompt(params);
            default:
                throw new Error(`Method not found: ${method}`);
        }
    }

    // ─── Method handlers ────────────────────────────────────

    private handleInitialize(): unknown {
        return {
            protocolVersion: PROTOCOL_VERSION,
            agentCapabilities: {
                // PoC: 不支持 loadSession / set_mode / 远程 MCP 等
                loadSession: false,
                promptCapabilities: { image: false, audio: false, embeddedContext: false },
            },
            agentInfo: {
                name: "vscode-issue-manager-acp",
                title: "vscode-issue-manager ACP Agent (PoC)",
                version: "0.1.0",
            },
            authMethods: [],
        };
    }

    private handleSessionNew(): unknown {
        const sessionId = randomUUID();
        const agent = new Agent(this.opts.services, this.opts.llmConfig);
        this.sessions.set(sessionId, { id: sessionId, agent });
        process.stderr.write(`[acp-agent] new session ${sessionId}\n`);
        return {
            sessionId,
            configOptions: null,
            modes: null,
        };
    }

    private async handleSessionPrompt(params: Record<string, unknown>): Promise<unknown> {
        const sessionId = String(params.sessionId ?? "");
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Unknown sessionId: ${sessionId}`);
        }
        const promptBlocks = (params.prompt as ContentBlock[] | undefined) ?? [];

        const stopReason = await session.agent.runPromptTurn(promptBlocks, {
            onTextChunk: text => this.sendUpdate(sessionId, {
                type: "agent_message_chunk",
                content: { type: "text", text },
            }),
            onToolCall: call => this.sendUpdate(sessionId, {
                type: "tool_call",
                toolCallId: call.id,
                toolName: call.name,
                toolInput: call.input,
            }),
            onToolCallComplete: call => this.sendUpdate(sessionId, {
                type: "tool_call_complete",
                toolCallId: call.id,
                result: [{ type: "text", text: call.result }],
            }),
        });

        return { stopReason };
    }

    // ─── 输出辅助 ───────────────────────────────────────────

    private sendUpdate(sessionId: string, update: Record<string, unknown>): void {
        const notification: JsonRpcNotification = {
            jsonrpc: "2.0",
            method: "session/update",
            params: { sessionId, update },
        };
        this.send(notification);
    }

    private send(msg: JsonRpcResponse | JsonRpcNotification): void {
        this.output.write(JSON.stringify(msg) + "\n");
    }
}
