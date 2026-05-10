#!/usr/bin/env node
/**
 * ACP Agent 冒烟测试客户端。
 *
 * 用法:
 *   - 必须已编译: `npm run compile:acp`
 *   - 必需环境变量: ISSUE_MANAGER_DIR, ACP_AGENT_API_URL, ACP_AGENT_MODEL
 *   - 可选 ACP_AGENT_API_KEY
 *   - 可选 SMOKE_PROMPT="你想测试的 prompt"  (留空则只测 initialize + session/new)
 *
 *   node ./dist/acpAgent/acpAgent/smokeTest.js
 *
 * 输出:client → server 的请求,和 server → client 的响应/通知,都打到 stderr。
 */

import { spawn, type ChildProcessByStdio } from "node:child_process";
import * as path from "node:path";
import type { Readable, Writable } from "node:stream";

interface JsonRpcRequest {
    jsonrpc: "2.0";
    id: number;
    method: string;
    params?: unknown;
}
interface JsonRpcResponse {
    jsonrpc: "2.0";
    id: number;
    result?: unknown;
    error?: { code: number; message: string };
}
interface JsonRpcNotification {
    jsonrpc: "2.0";
    method: string;
    params?: unknown;
}

class TestClient {
    private nextId = 1;
    private pending = new Map<number, (msg: JsonRpcResponse) => void>();
    private buffer = "";

    constructor(private readonly child: ChildProcessByStdio<Writable, Readable, Readable>) {
        child.stdout.setEncoding("utf-8");
        child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
        child.stderr.on("data", (chunk: Buffer) => {
            process.stderr.write(`[server-stderr] ${chunk.toString().trimEnd()}\n`);
        });
        child.on("exit", code => {
            process.stderr.write(`[server-exit] code=${code}\n`);
        });
    }

    private onStdout(chunk: string): void {
        this.buffer += chunk;
        const lines = this.buffer.split("\n");
        this.buffer = lines.pop() ?? "";
        for (const line of lines) {
            const t = line.trim();
            if (!t) { continue; }
            let msg: JsonRpcResponse | JsonRpcNotification;
            try { msg = JSON.parse(t); }
            catch {
                process.stderr.write(`[client] non-JSON line: ${t.slice(0, 200)}\n`);
                continue;
            }
            if ("id" in msg) {
                const handler = this.pending.get(msg.id as number);
                if (handler) {
                    this.pending.delete(msg.id as number);
                    handler(msg as JsonRpcResponse);
                } else {
                    process.stderr.write(`[client] response for unknown id: ${JSON.stringify(msg)}\n`);
                }
            } else {
                process.stderr.write(`[notification] ${JSON.stringify(msg)}\n`);
            }
        }
    }

    request(method: string, params?: unknown): Promise<unknown> {
        const id = this.nextId++;
        const req: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
        process.stderr.write(`[client→server] ${JSON.stringify(req)}\n`);
        return new Promise((resolve, reject) => {
            this.pending.set(id, msg => {
                if (msg.error) { reject(new Error(`[${msg.error.code}] ${msg.error.message}`)); }
                else { resolve(msg.result); }
            });
            this.child.stdin.write(JSON.stringify(req) + "\n");
        });
    }

    close(): void { this.child.kill("SIGTERM"); }
}

async function main(): Promise<void> {
    const issueDir = process.env.ISSUE_MANAGER_DIR;
    if (!issueDir) { throw new Error("ISSUE_MANAGER_DIR is required"); }

    const serverPath = path.resolve(__dirname, "index.js");
    const child = spawn("node", [serverPath], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
    }) as ChildProcessByStdio<Writable, Readable, Readable>;

    const client = new TestClient(child);

    process.stderr.write("\n=== test 1: initialize ===\n");
    const initRes = await client.request("initialize", {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: "smokeTest", title: "ACP Smoke Test", version: "0.1.0" },
    });
    process.stderr.write(`[client] initialize → ${JSON.stringify(initRes)}\n`);

    process.stderr.write("\n=== test 2: session/new ===\n");
    const sess = await client.request("session/new", {
        cwd: issueDir,
        mcpServers: [],
    }) as { sessionId: string };
    process.stderr.write(`[client] session/new → ${JSON.stringify(sess)}\n`);

    const promptText = process.env.SMOKE_PROMPT;
    if (promptText) {
        process.stderr.write(`\n=== test 3: session/prompt: "${promptText}" ===\n`);
        const promptRes = await client.request("session/prompt", {
            sessionId: sess.sessionId,
            prompt: [{ type: "text", text: promptText }],
        });
        process.stderr.write(`[client] session/prompt → ${JSON.stringify(promptRes)}\n`);
    } else {
        process.stderr.write("\n[skip] 设置 SMOKE_PROMPT=\"...\" 可跑实时 prompt 测试(需要有效的 ACP_AGENT_API_URL/KEY/MODEL)\n");
    }

    client.close();
    setTimeout(() => process.exit(0), 200);
}

main().catch(err => {
    process.stderr.write(`smokeTest failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
});
