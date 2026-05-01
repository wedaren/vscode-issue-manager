import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    type CallToolResult,
    type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { IssueCoreServices } from "../services/issue-core";
import { ISSUE_TOOLS, ISSUE_TOOL_HANDLERS, type IssueToolHandler } from "./tools/issueTools";
import { KB_TOOLS, KB_TOOL_HANDLERS } from "./tools/knowledgeBaseTools";

export interface McpServerOptions {
    services: IssueCoreServices;
    issueDir: string;
    /** 是否允许破坏性工具(delete_issue / batch_delete_issues)。默认 false。 */
    allowDestructive: boolean;
}

const DESTRUCTIVE_TOOL_NAMES = new Set(["delete_issue", "batch_delete_issues"]);

export function createIssueManagerMcpServer(opts: McpServerOptions): Server {
    const { services, issueDir, allowDestructive } = opts;

    const server = new Server(
        { name: "vscode-issue-manager-mcp", version: "0.1.0" },
        { capabilities: { tools: {} } },
    );

    // 工具白名单
    const allTools: Tool[] = [...ISSUE_TOOLS, ...KB_TOOLS];
    const allHandlers: Record<string, IssueToolHandler> = {
        ...ISSUE_TOOL_HANDLERS,
        ...KB_TOOL_HANDLERS,
    };

    const enabledTools = allowDestructive
        ? allTools
        : allTools.filter(t => !DESTRUCTIVE_TOOL_NAMES.has(t.name));

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: enabledTools,
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
        const name = request.params.name;
        if (!allowDestructive && DESTRUCTIVE_TOOL_NAMES.has(name)) {
            return {
                isError: true,
                content: [{
                    type: "text",
                    text: `工具 ${name} 已被禁用(破坏性操作)。设置环境变量 MCP_ALLOW_DESTRUCTIVE=1 以启用。`,
                }],
            };
        }
        const handler = allHandlers[name];
        if (!handler) {
            return {
                isError: true,
                content: [{ type: "text", text: `未知工具: ${name}` }],
            };
        }
        try {
            const args = (request.params.arguments ?? {}) as Record<string, unknown>;
            const text = await handler(args, { services, issueDir });
            return { content: [{ type: "text", text }] };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
                isError: true,
                content: [{ type: "text", text: `工具执行失败: ${msg}` }],
            };
        }
    });

    return server;
}
