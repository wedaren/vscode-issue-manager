#!/usr/bin/env node
/**
 * vscode-issue-manager MCP server 入口。
 *
 * 启动方式:
 *   ISSUE_MANAGER_DIR=/path/to/issueDir vscode-issue-manager-mcp
 *   或 vscode-issue-manager-mcp --issue-dir /path/to/issueDir
 *
 * 通过 stdio 提供 MCP 工具供外部 ACP Agent / Claude Desktop / Cursor 等调用。
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { NodeFsStorage } from "../services/issue-core/storage/NodeFsStorage";
import { IssueCoreServices } from "../services/issue-core";
import { createIssueManagerMcpServer } from "./server";

function parseArgs(): { issueDir: string; allowDestructive: boolean } {
    const argv = process.argv.slice(2);
    let issueDir = process.env.ISSUE_MANAGER_DIR ?? "";
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--issue-dir" && i + 1 < argv.length) {
            issueDir = argv[i + 1];
            i++;
        } else if (argv[i].startsWith("--issue-dir=")) {
            issueDir = argv[i].slice("--issue-dir=".length);
        }
    }
    const allowDestructive = process.env.MCP_ALLOW_DESTRUCTIVE === "1";
    return { issueDir, allowDestructive };
}

async function main(): Promise<void> {
    const { issueDir, allowDestructive } = parseArgs();
    if (!issueDir) {
        process.stderr.write(
            "[issue-manager-mcp] 错误: 必须通过 ISSUE_MANAGER_DIR 环境变量或 --issue-dir 参数指定笔记目录。\n",
        );
        process.exit(1);
    }

    const storage = new NodeFsStorage();
    const services = new IssueCoreServices(storage, issueDir);
    const server = createIssueManagerMcpServer({ services, issueDir, allowDestructive });

    process.stderr.write(
        `[issue-manager-mcp] starting (issueDir=${issueDir}, allowDestructive=${allowDestructive})\n`,
    );

    const transport = new StdioServerTransport();
    await server.connect(transport);
    // 进程会通过 transport 的 stdin 关闭事件退出,无需主动 unref。
}

main().catch(err => {
    process.stderr.write(`[issue-manager-mcp] 启动失败: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
});
