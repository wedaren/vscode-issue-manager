#!/usr/bin/env node
/**
 * vscode-issue-manager ACP Agent (PoC) entry。
 *
 * 通过 stdio 提供 ACP 协议,让外部 ACP Client (Zed / 自定义客户端 / 移动端) 把它当作
 * 一个对话式 Agent 来用。Agent 内部跑 OpenAI-兼容 LLM,工具是 issue-core 服务。
 *
 * 必需环境变量:
 *   ISSUE_MANAGER_DIR   - 笔记目录绝对路径
 *   ACP_AGENT_API_URL   - chat completions 完整 endpoint(如 https://api.deepseek.com/v1/chat/completions)
 *   ACP_AGENT_MODEL     - 模型名(如 deepseek-chat)
 *
 * 可选:
 *   ACP_AGENT_API_KEY   - Bearer token(本地 Ollama 等不需要)
 */

import { NodeFsStorage } from "../services/issue-core/storage/NodeFsStorage";
import { IssueCoreServices } from "../services/issue-core";
import { AcpServer } from "./server";
import type { LlmConfig } from "./llmClient";

function fail(msg: string): never {
    process.stderr.write(`[acp-agent] 错误: ${msg}\n`);
    process.exit(1);
}

function main(): void {
    const issueDir = process.env.ISSUE_MANAGER_DIR;
    if (!issueDir) { fail("缺少 ISSUE_MANAGER_DIR 环境变量"); }

    const apiUrl = process.env.ACP_AGENT_API_URL;
    if (!apiUrl) { fail("缺少 ACP_AGENT_API_URL 环境变量(完整 chat completions endpoint)"); }

    const model = process.env.ACP_AGENT_MODEL;
    if (!model) { fail("缺少 ACP_AGENT_MODEL 环境变量"); }

    const apiKey = process.env.ACP_AGENT_API_KEY;

    const storage = new NodeFsStorage();
    const services = new IssueCoreServices(storage, issueDir);
    const llmConfig: LlmConfig = { apiUrl, model, apiKey };

    process.stderr.write(
        `[acp-agent] starting (issueDir=${issueDir}, model=${model}, hasKey=${!!apiKey})\n`,
    );

    const server = new AcpServer({ services, llmConfig });
    server.start();
}

main();
