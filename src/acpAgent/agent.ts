/**
 * ACP Agent loop。
 *
 * 桥接:
 *   - 入: 来自 ACP `session/prompt` 的 user prompt (content blocks)
 *   - 出: 通过 SessionEventEmitter 推 `session/update` notifications:
 *         agent_message_chunk / tool_call / tool_call_complete
 *   - 内: 跑 LlmClient.run + 把 issue-core service 暴露为 LLM 工具
 */

import type { IssueCoreServices } from "../services/issue-core";
import { LlmClient, type LlmConfig, type LlmMessage, type LlmTool, type StopReason } from "./llmClient";

// ─── ACP-side types(本 PoC 自定义,与 ACP 协议一致) ──────────────

export type ContentBlock =
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
    // 其它类型 PoC 暂不支持
    ;

/** 暴露给 LLM 的工具集。PoC 选了对外部 Agent 最有用的 5 个。 */
const AGENT_TOOLS: LlmTool[] = [
    {
        name: "search_issues",
        description: "搜索 issueMarkdown 笔记。空格分隔多关键词全部匹配。返回标题、文件名、片段。",
        inputSchema: {
            type: "object",
            properties: {
                query: { type: "string", description: "搜索关键词" },
                limit: { type: "number", description: "最多返回条数,默认 10" },
            },
            required: ["query"],
        },
    },
    {
        name: "read_issue",
        description: "读取指定 issue 的完整内容(含 frontmatter)。文件较大时考虑分页。",
        inputSchema: {
            type: "object",
            properties: {
                fileName: { type: "string", description: "issue 文件名" },
            },
            required: ["fileName"],
        },
    },
    {
        name: "create_issue",
        description: "创建新笔记,自动加到树根级。",
        inputSchema: {
            type: "object",
            properties: {
                title: { type: "string", description: "标题" },
                description: { type: "string", description: "简短描述(可选)" },
                body: { type: "string", description: "Markdown 正文" },
            },
            required: ["title", "body"],
        },
    },
    {
        name: "kb_query",
        description: "在 wiki/ 知识库中搜索。",
        inputSchema: {
            type: "object",
            properties: {
                query: { type: "string", description: "关键词" },
                limit: { type: "number", description: "默认 5" },
            },
            required: ["query"],
        },
    },
    {
        name: "get_library_stats",
        description: "笔记库整体概览:类型分布、最近修改的笔记。",
        inputSchema: { type: "object", properties: {} },
    },
];

const DEFAULT_SYSTEM_PROMPT = `你是一个连接到用户 issueMarkdown 笔记库的助手。
你可以通过工具搜索、读取、创建笔记。回答时:
- 先用 search_issues / get_library_stats 了解相关上下文
- 引用具体笔记时,带上文件名(如 IssueDir/20260501-...md)
- 用中文回答`;

// ─── ACP session 事件 ─────────────────────────────────────────

export interface SessionEvents {
    /** 流式文本片段 */
    onTextChunk: (text: string) => void;
    /** Agent 准备调用工具 */
    onToolCall: (call: { id: string; name: string; input: Record<string, unknown> }) => void;
    /** Agent 工具调用完成 */
    onToolCallComplete: (call: { id: string; name: string; result: string }) => void;
}

// ─── Agent ────────────────────────────────────────────────────

export class Agent {
    private readonly llm: LlmClient;
    private readonly history: LlmMessage[] = [
        { role: "system", content: DEFAULT_SYSTEM_PROMPT },
    ];

    constructor(
        private readonly services: IssueCoreServices,
        llmConfig: LlmConfig,
    ) {
        this.llm = new LlmClient(llmConfig);
    }

    /**
     * 处理一次 prompt turn。
     * - 把 ACP content blocks 转成 LLM user message
     * - 跑 LLM 循环,通过 events 把流式更新推回 caller
     * - 返回 stopReason 给 ACP `session/prompt` response
     */
    async runPromptTurn(
        prompt: ContentBlock[],
        events: SessionEvents,
        signal?: AbortSignal,
    ): Promise<StopReason> {
        const userText = prompt
            .map(block => (block.type === "text" ? block.text : `[${block.type} block]`))
            .join("\n");

        this.history.push({ role: "user", content: userText });

        const result = await this.llm.run(this.history, AGENT_TOOLS, {
            signal,
            onTextChunk: events.onTextChunk,
            onToolCallStart: events.onToolCall,
            onToolCallComplete: events.onToolCallComplete,
            executeTool: async ({ name, input }) => this._executeTool(name, input),
        });

        // assistant 消息追加到历史,保留多轮对话
        this.history.push({ role: "assistant", content: result.text || null });
        return result.stopReason;
    }

    /** 把 LLM 的 tool call 路由到 issue-core service */
    private async _executeTool(name: string, input: Record<string, unknown>): Promise<string> {
        switch (name) {
            case "search_issues": {
                const query = String(input.query ?? "").trim();
                const limit = typeof input.limit === "number" ? input.limit : 10;
                if (!query) { return "请提供搜索关键词"; }
                const r = await this.services.query.searchByKeyword(query, { limit });
                if (r.matches.length === 0) {
                    return `未找到匹配「${query}」的笔记。`;
                }
                return r.matches.map((m, i) => {
                    const head = `${i + 1}. [${m.issue.title}](IssueDir/${m.issue.fileName})`;
                    return m.snippet ? `${head}\n   > ${m.snippet}` : head;
                }).join("\n");
            }
            case "read_issue": {
                const fileName = String(input.fileName ?? "").trim();
                if (!fileName) { return "请提供 fileName"; }
                const issue = await this.services.issues.get(fileName);
                if (!issue) { return `未找到 ${fileName}`; }
                const raw = await this.services.issues.getRaw(fileName);
                const TRIM = 12000;
                if (raw.length > TRIM) {
                    return `# ${issue.title}\n\n[文件总长 ${raw.length} 字符,显示前 ${TRIM}]\n\n${raw.slice(0, TRIM)}`;
                }
                return raw;
            }
            case "create_issue": {
                const title = String(input.title ?? "").trim();
                const body = String(input.body ?? "").trim();
                const description = input.description ? String(input.description) : undefined;
                if (!title) { return "请提供 title"; }
                const fm: Record<string, unknown> = { issue_title: title };
                if (description) { fm.issue_description = description; }
                const fullBody = body.startsWith("# ") ? body : `# ${title}\n\n${body}`;
                const created = await this.services.issues.create({ frontmatter: fm, body: fullBody });
                await this.services.tree.createNodes([created.fileName]);
                return `✓ 已创建 [${title}](IssueDir/${created.fileName})`;
            }
            case "kb_query": {
                const query = String(input.query ?? "").trim();
                const limit = typeof input.limit === "number" ? input.limit : 5;
                if (!query) { return "请提供 query"; }
                const r = await this.services.kb.query(query, { limit });
                if (r.totalMatched === 0) { return `未找到匹配 "${query}" 的 wiki 文章。`; }
                return r.hits.map(h => `### ${h.title}\n文件: ${h.fileName}\n> ${h.snippet}`).join("\n\n");
            }
            case "get_library_stats": {
                const stats = await this.services.query.getStats({ recentLimit: 10 });
                const typeLines = Object.entries(stats.typeCounts)
                    .filter(([, c]) => c > 0)
                    .map(([k, c]) => `- ${k}: ${c}`)
                    .join("\n");
                const recentLines = stats.recentUserNotes
                    .map((n, i) => `${i + 1}. [${n.title}](IssueDir/${n.fileName})`)
                    .join("\n");
                return `共 ${stats.totalFiles} 个文件\n\n类型分布:\n${typeLines}\n\n最近修改:\n${recentLines}`;
            }
            default:
                return `未知工具: ${name}`;
        }
    }
}
