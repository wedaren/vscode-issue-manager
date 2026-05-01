/**
 * 极简 OpenAI-compatible streaming LLM client。
 *
 * 不依赖 vscode。从 FetchAdapter 简化而来,只保留 ACP PoC 必需的功能:
 * - OpenAI Chat Completions 流式协议
 * - 工具调用循环(`tool_calls` 格式)
 * - 流式 chunk + tool call 通过 callback 推出
 *
 * 配置通过环境变量:
 *   ACP_AGENT_API_URL   - 完整的 chat completions endpoint(必须)
 *   ACP_AGENT_API_KEY   - Bearer token(可选,本地 Ollama 等不需要)
 *   ACP_AGENT_MODEL     - 模型名(必须)
 */

export interface LlmTool {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

export interface LlmMessage {
    role: "system" | "user" | "assistant" | "tool";
    content: string | null;
    tool_calls?: LlmPendingToolCall[];
    tool_call_id?: string;
    name?: string;
}

interface LlmPendingToolCall {
    id: string;
    type: "function";
    function: {
        name: string;
        arguments: string;
    };
}

interface OpenAIStreamChunk {
    choices: Array<{
        delta: {
            content?: string | null;
            tool_calls?: Array<{
                index: number;
                id?: string;
                type?: string;
                function?: { name?: string; arguments?: string };
            }>;
        };
        finish_reason: string | null;
    }>;
}

export type StopReason = "end_turn" | "max_tokens" | "max_turn_requests" | "cancelled" | "refusal";

export interface RunOptions {
    /** 单轮 LLM 调用的 abort 信号 */
    signal?: AbortSignal;
    /** 最大工具调用轮次,超出后强制要求 LLM 不再调工具 */
    maxToolRounds?: number;
    /** 文本流式 chunk(每个增量) */
    onTextChunk?: (chunk: string) => void;
    /**
     * Agent 决定调用工具时触发(在执行前)。
     * 用于上层 ACP server 推送 `tool_call` notification。
     */
    onToolCallStart?: (call: { id: string; name: string; input: Record<string, unknown> }) => void;
    /** 工具执行函数:接收 name + input,返回结果文本(必由调用方提供) */
    executeTool: (call: { id: string; name: string; input: Record<string, unknown> }) => Promise<string>;
    /** 工具执行完毕(传入结果)。用于推送 tool_call_complete notification。 */
    onToolCallComplete?: (call: { id: string; name: string; result: string }) => void;
}

export interface LlmConfig {
    apiUrl: string;
    apiKey?: string;
    model: string;
}

export class LlmClient {
    constructor(private readonly config: LlmConfig) {}

    /**
     * 跑完整对话循环(可能多轮工具调用)。
     * 返回最后一轮的纯文本 + stopReason。
     */
    async run(
        messages: LlmMessage[],
        tools: LlmTool[],
        opts: RunOptions,
    ): Promise<{ text: string; stopReason: StopReason }> {
        const maxToolRounds = opts.maxToolRounds ?? 30;
        let toolRounds = 0;
        const working: LlmMessage[] = [...messages];

        const oaiTools = tools.map(t => ({
            type: "function" as const,
            function: { name: t.name, description: t.description, parameters: t.inputSchema },
        }));

        while (true) {
            if (opts.signal?.aborted) {
                return { text: "", stopReason: "cancelled" };
            }
            const passTools = toolRounds < maxToolRounds && oaiTools.length > 0;
            const round = await this._stream(working, passTools ? oaiTools : [], opts);

            if (round.toolCalls.length === 0) {
                return { text: round.text, stopReason: "end_turn" };
            }

            // 有工具调用:追加 assistant 消息 + 执行 + 追加 tool 消息
            toolRounds++;
            working.push({
                role: "assistant",
                content: round.text || null,
                tool_calls: round.toolCalls,
            });
            for (const tc of round.toolCalls) {
                let inputObj: Record<string, unknown>;
                try { inputObj = JSON.parse(tc.function.arguments || "{}"); }
                catch { inputObj = {}; }
                opts.onToolCallStart?.({ id: tc.id, name: tc.function.name, input: inputObj });
                let result: string;
                try {
                    result = await opts.executeTool({ id: tc.id, name: tc.function.name, input: inputObj });
                } catch (err) {
                    result = `工具调用失败: ${err instanceof Error ? err.message : String(err)}`;
                }
                opts.onToolCallComplete?.({ id: tc.id, name: tc.function.name, result });
                working.push({
                    role: "tool",
                    content: result,
                    tool_call_id: tc.id,
                    name: tc.function.name,
                });
            }
            if (toolRounds >= maxToolRounds) {
                return { text: "", stopReason: "max_turn_requests" };
            }
        }
    }

    /** 单次 LLM 流式调用,返回完整文本 + 收集到的 tool_calls */
    private async _stream(
        messages: LlmMessage[],
        oaiTools: Array<{ type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }>,
        opts: RunOptions,
    ): Promise<{ text: string; toolCalls: LlmPendingToolCall[] }> {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (this.config.apiKey) { headers["Authorization"] = `Bearer ${this.config.apiKey}`; }

        const body: Record<string, unknown> = {
            model: this.config.model,
            messages,
            stream: true,
        };
        if (oaiTools.length > 0) {
            body["tools"] = oaiTools;
            body["tool_choice"] = "auto";
        }

        const res = await fetch(this.config.apiUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: opts.signal as RequestInit["signal"],
        });

        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 300)}`);
        }
        if (!res.body) { throw new Error("LLM 响应体为空"); }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const pending = new Map<number, LlmPendingToolCall>();
        let full = "";
        let buf = "";

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) { break; }
                buf += decoder.decode(value, { stream: true });
                const lines = buf.split("\n");
                buf = lines.pop() ?? "";

                for (const line of lines) {
                    const t = line.trim();
                    if (!t || t === "data: [DONE]") { continue; }
                    if (!t.startsWith("data: ")) { continue; }

                    let chunk: OpenAIStreamChunk;
                    try { chunk = JSON.parse(t.slice(6)) as OpenAIStreamChunk; }
                    catch { continue; }

                    const choice = chunk.choices?.[0];
                    if (!choice) { continue; }
                    const delta = choice.delta;

                    if (delta.content) {
                        full += delta.content;
                        opts.onTextChunk?.(delta.content);
                    }
                    if (delta.tool_calls) {
                        for (const tc of delta.tool_calls) {
                            const idx = tc.index;
                            if (!pending.has(idx)) {
                                pending.set(idx, {
                                    id: tc.id ?? `call_${idx}`,
                                    type: "function",
                                    function: { name: tc.function?.name ?? "", arguments: "" },
                                });
                            }
                            const existing = pending.get(idx)!;
                            if (tc.function?.name) { existing.function.name = tc.function.name; }
                            if (tc.function?.arguments) { existing.function.arguments += tc.function.arguments; }
                            if (tc.id) { existing.id = tc.id; }
                        }
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        return { text: full, toolCalls: [...pending.values()] };
    }
}
