/**
 * 模型适配层
 *
 * 为 Copilot（vscode.LanguageModelChat）和 HTTP 兼容模型（OpenAI / Ollama / Anthropic）
 * 提供统一的流式调用接口，使上层 LLMService 无需感知底层实现差异。
 * Copilot 工具调用使用 VS Code 原生 API；HTTP 模型工具调用使用 OpenAI function-calling 格式。
 */
import * as vscode from 'vscode';
import type { ModelDescriptor } from './ModelRegistry';
import { ModelRegistry } from './ModelRegistry';

// ─── 公共接口 ─────────────────────────────────────────────────

/** 标准化的工具定义（同时兼容 vscode.LanguageModelChatTool 和 OpenAI tools 格式） */
export interface AdapterTool {
    name: string;
    description?: string;
    /** JSON Schema 定义的参数 */
    inputSchema: {
        type: 'object';
        properties?: Record<string, unknown>;
        required?: string[];
    };
}

/** 工具调用回调 */
export type OnToolCall = (toolName: string, input: Record<string, unknown>) => Promise<string>;

/** 流式输出回调 */
export type OnChunk = (chunk: string) => void;

/**
 * 统一的模型适配器接口。
 * 两种实现：CopilotAdapter（使用 vscode.LanguageModelChat）和 FetchAdapter（HTTP fetch）。
 */
export interface ModelAdapter {
    /** 描述符（含 contextWindow） */
    descriptor: ModelDescriptor;

    /**
     * 流式请求，无工具调用。
     * @param messages - 对话消息列表
     * @param onChunk - 每个流式 chunk 的回调
     * @param signal - 中止信号
     * @returns 完整响应文本
     */
    stream(
        messages: vscode.LanguageModelChatMessage[],
        onChunk: OnChunk,
        signal?: AbortSignal,
    ): Promise<string>;

    /**
     * 带工具调用的流式请求。
     * @param messages - 当前完整消息列表（含 system + history）
     * @param tools - 可调用的工具列表
     * @param onChunk - 每个文本 chunk 的回调
     * @param onToolCall - 工具调用执行回调，返回工具执行结果字符串
     * @param options - 额外选项
     */
    streamWithTools(
        messages: vscode.LanguageModelChatMessage[],
        tools: vscode.LanguageModelChatTool[],
        onChunk: OnChunk,
        onToolCall: OnToolCall,
        options?: {
            signal?: AbortSignal;
            maxToolRounds?: number;
            onToolStatus?: (status: { toolName: string; phase: 'calling' | 'done'; result?: string }) => void;
            onToolsDecided?: (info: { roundText: string; toolNames: string[]; round: number }) => void;
            onFinalRound?: (info: { round: number; toolCallsTotal: number }) => void;
            onRoundStart?: (info: { round: number }) => void;
        },
    ): Promise<string>;
}

// ─── Copilot 适配器 ───────────────────────────────────────────

/**
 * 包装 vscode.LanguageModelChat 为统一 ModelAdapter 接口。
 * 工具调用使用 VS Code 原生工具循环。
 */
export class CopilotAdapter implements ModelAdapter {
    constructor(
        public readonly descriptor: ModelDescriptor,
        private readonly _model: vscode.LanguageModelChat,
    ) {}

    async stream(
        messages: vscode.LanguageModelChatMessage[],
        onChunk: OnChunk,
        signal?: AbortSignal,
    ): Promise<string> {
        if (signal?.aborted) { throw new Error('请求已取消'); }
        const cts = new vscode.CancellationTokenSource();
        const onAbort = signal ? () => cts.cancel() : undefined;
        if (onAbort && signal) { signal.addEventListener('abort', onAbort, { once: true }); }

        const resp = await this._model.sendRequest(messages, undefined, cts.token);
        let full = '';
        try {
            for await (const chunk of resp.text) {
                if (cts.token.isCancellationRequested) { throw new Error('请求已取消'); }
                const s = String(chunk);
                full += s;
                onChunk(s);
            }
        } finally {
            if (onAbort && signal) { signal.removeEventListener('abort', onAbort); }
            cts.dispose();
        }
        return full;
    }

    async streamWithTools(
        messages: vscode.LanguageModelChatMessage[],
        tools: vscode.LanguageModelChatTool[],
        onChunk: OnChunk,
        onToolCall: OnToolCall,
        options?: Parameters<ModelAdapter['streamWithTools']>[4],
    ): Promise<string> {
        // 委托给 LLMService 的 Copilot 工具循环（保持现有成熟实现）
        // 此方法在 LLMService.streamWithTools() 中被直接使用，这里不重复实现
        throw new Error('CopilotAdapter.streamWithTools 应由 LLMService 内部处理，请勿直接调用');
    }
}

// ─── HTTP Fetch 适配器（OpenAI 兼容 / Ollama） ────────────────

/** OpenAI Chat Completion API 消息格式 */
interface OpenAIMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    /** DeepSeek Thinking 模式推理内容，多轮时必须原样传回 */
    reasoning_content?: string | null;
    tool_calls?: OpenAIToolCall[];
    tool_call_id?: string;
    name?: string;
}

interface OpenAIToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

interface OpenAIStreamChunk {
    choices: Array<{
        delta: {
            content?: string | null;
            /** DeepSeek Thinking 模式推理内容（streaming chunk） */
            reasoning_content?: string | null;
            tool_calls?: Array<{
                index: number;
                id?: string;
                type?: string;
                function?: {
                    name?: string;
                    arguments?: string;
                };
            }>;
        };
        finish_reason: string | null;
    }>;
}

/**
 * HTTP Fetch 适配器，兼容 OpenAI Chat Completions API 格式。
 * 支持 OpenAI、Ollama（/api/chat 转换为 /v1/chat/completions）、任意兼容服务。
 */
export class FetchAdapter implements ModelAdapter {
    constructor(
        public readonly descriptor: ModelDescriptor,
        private readonly _apiKey?: string,
    ) {}

    async stream(
        messages: vscode.LanguageModelChatMessage[],
        onChunk: OnChunk,
        signal?: AbortSignal,
    ): Promise<string> {
        const oaiMessages = convertMessages(messages);
        return this._fetchStream(oaiMessages, [], onChunk, signal);
    }

    async streamWithTools(
        messages: vscode.LanguageModelChatMessage[],
        tools: vscode.LanguageModelChatTool[],
        onChunk: OnChunk,
        onToolCall: OnToolCall,
        options?: Parameters<ModelAdapter['streamWithTools']>[4],
    ): Promise<string> {
        const signal = options?.signal;
        const maxToolRounds = options?.maxToolRounds ?? 30;
        let toolCallRounds = 0;
        let fullText = '';
        let round = 0;

        const oaiTools = tools.map(t => ({
            type: 'function' as const,
            function: {
                name: t.name,
                description: t.description,
                parameters: (t.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} },
            },
        }));

        let workingMessages: OpenAIMessage[] = convertMessages(messages);

        while (true) {
            if (signal?.aborted) { throw new Error('请求已取消'); }
            options?.onRoundStart?.({ round });
            round++;

            const shouldPassTools = toolCallRounds < maxToolRounds && oaiTools.length > 0;
            const roundText = await this._fetchStream(
                workingMessages,
                shouldPassTools ? oaiTools : [],
                onChunk,
                signal,
                (toolCalls) => {
                    // tool_calls 收集完成后的回调，reasoning_content 作为 roundText 传出供上层展示
                    if (toolCalls.length > 0) {
                        options?.onToolsDecided?.({
                            roundText: this._lastRoundReasoningContent,
                            toolNames: toolCalls.map(tc => tc.function.name),
                            round,
                        });
                    }
                },
            );

            // 检查是否有工具调用（从流中收集到的）
            const pendingToolCalls = this._lastRoundToolCalls;
            this._lastRoundToolCalls = [];

            if (pendingToolCalls.length === 0) {
                // 无工具调用：这是最终回复
                fullText = roundText;
                options?.onFinalRound?.({ round, toolCallsTotal: toolCallRounds });
                break;
            }

            // 有工具调用：追加 assistant 消息 + 执行工具 + 追加工具结果
            toolCallRounds++;
            const assistantMsg: OpenAIMessage = {
                role: 'assistant',
                content: roundText || null,
                tool_calls: pendingToolCalls.map((tc, i) => ({
                    id: tc.id || `call_${i}`,
                    type: 'function',
                    function: { name: tc.function.name, arguments: tc.function.arguments || '{}' },
                })),
            };
            // DeepSeek Thinking 模式：多轮时必须原样传回 reasoning_content
            const lastReasoning = this._lastRoundReasoningContent;
            if (lastReasoning) { assistantMsg.reasoning_content = lastReasoning; }
            workingMessages.push(assistantMsg);

            for (const tc of pendingToolCalls) {
                const toolName = tc.function.name;
                const toolInput = safeParseJSON(tc.function.arguments || '{}');
                options?.onToolStatus?.({ toolName, phase: 'calling' });
                let result: string;
                try {
                    result = await onToolCall(toolName, toolInput);
                } catch (e) {
                    result = `工具调用失败: ${e instanceof Error ? e.message : String(e)}`;
                }
                options?.onToolStatus?.({ toolName, phase: 'done', result });
                workingMessages.push({
                    role: 'tool',
                    content: result,
                    tool_call_id: tc.id || `call_0`,
                    name: toolName,
                });
            }
        }

        return fullText;
    }

    // 跨 _fetchStream 调用传递 tool_calls 和 reasoning_content（内部状态）
    private _lastRoundToolCalls: OpenAIToolCall[] = [];
    private _lastRoundReasoningContent: string = '';

    private async _fetchStream(
        messages: OpenAIMessage[],
        tools: Array<{ type: 'function'; function: { name: string; description?: string; parameters: Record<string, unknown> } }>,
        onChunk: OnChunk,
        signal?: AbortSignal,
        onToolCallsCollected?: (toolCalls: OpenAIToolCall[]) => void,
    ): Promise<string> {
        const endpoint = this._buildEndpoint();
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this._apiKey) { headers['Authorization'] = `Bearer ${this._apiKey}`; }

        const body: Record<string, unknown> = {
            model: this.descriptor.model,
            messages,
            stream: true,
        };
        if (tools.length > 0) { body['tools'] = tools; body['tool_choice'] = 'auto'; }

        // 思考模式参数注入（o-series / Claude Extended Thinking / DeepSeek-R1）
        const caps = this.descriptor.capabilities;
        if (caps?.supportsThinking && caps.thinkingBudget) {
            const budgetTokens: Record<string, number> = { low: 2048, medium: 8192, high: 32768 };
            const tokens = budgetTokens[caps.thinkingBudget] ?? 8192;
            // OpenAI o-series: reasoning_effort
            body['reasoning_effort'] = caps.thinkingBudget;
            // Anthropic: thinking block
            body['thinking'] = { type: 'enabled', budget_tokens: tokens };
            // DeepSeek: max_tokens with reasoning
            body['max_tokens'] = tokens * 4;
        }

        const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: signal as RequestInit['signal'],
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            const hint = response.status === 401 || response.status === 403
                ? ' — API Key 无效或未配置，请右键模型节点重新添加'
                : '';
            throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}${hint}`);
        }

        if (!response.body) { throw new Error('响应体为空'); }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let full = '';
        let reasoningFull = '';
        const pendingToolCalls: Map<number, OpenAIToolCall> = new Map();
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) { break; }
                buffer += decoder.decode(value, { stream: true });

                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed === 'data: [DONE]') { continue; }
                    if (!trimmed.startsWith('data: ')) { continue; }

                    let chunk: OpenAIStreamChunk;
                    try {
                        chunk = JSON.parse(trimmed.slice(6)) as OpenAIStreamChunk;
                    } catch { continue; }

                    const choice = chunk.choices?.[0];
                    if (!choice) { continue; }

                    const delta = choice.delta;
                    if (delta.reasoning_content) {
                        reasoningFull += delta.reasoning_content;
                    }
                    if (delta.content) {
                        full += delta.content;
                        onChunk(delta.content);
                    }

                    // 累积 tool_calls（多个 chunk 拼接 arguments）
                    if (delta.tool_calls) {
                        for (const tc of delta.tool_calls) {
                            const idx = tc.index;
                            if (!pendingToolCalls.has(idx)) {
                                pendingToolCalls.set(idx, {
                                    id: tc.id ?? `call_${idx}`,
                                    type: 'function',
                                    function: { name: tc.function?.name ?? '', arguments: '' },
                                });
                            }
                            const existing = pendingToolCalls.get(idx)!;
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

        const collected = [...pendingToolCalls.values()];
        this._lastRoundToolCalls = collected;
        this._lastRoundReasoningContent = reasoningFull;
        onToolCallsCollected?.(collected);

        return full;
    }

    private _buildEndpoint(): string {
        const base = this.descriptor.endpoint ?? 'https://api.openai.com/v1';
        // Ollama 使用 /api/chat，OpenAI 兼容使用 /v1/chat/completions
        if (this.descriptor.provider === 'ollama') {
            const cleanBase = base.replace(/\/$/, '');
            return `${cleanBase}/v1/chat/completions`;
        }
        const cleanBase = base.replace(/\/$/, '');
        return cleanBase.endsWith('/chat/completions')
            ? cleanBase
            : `${cleanBase}/chat/completions`;
    }
}

// ─── 工厂函数 ──────────────────────────────────────────────────

/**
 * 根据模型描述符创建对应的 ModelAdapter 实例。
 * Copilot 模型需要传入已获取的 vscode.LanguageModelChat；
 * HTTP 模型从 SecretStorage 读取 API Key。
 * @param descriptor - 模型描述符
 * @param copilotModel - Copilot 模型实例（仅 provider=copilot 时使用）
 * @returns ModelAdapter 实例
 */
export async function createAdapter(
    descriptor: ModelDescriptor,
    copilotModel?: vscode.LanguageModelChat,
): Promise<ModelAdapter> {
    if (descriptor.provider === 'copilot') {
        if (!copilotModel) { throw new Error('Copilot adapter 需要传入 vscode.LanguageModelChat 实例'); }
        return new CopilotAdapter(descriptor, copilotModel);
    }
    const apiKey = await ModelRegistry.getApiKey(ModelRegistry.buildApiKeyName(descriptor.provider, descriptor.endpoint));
    return new FetchAdapter(descriptor, apiKey);
}

// ─── 工具函数 ──────────────────────────────────────────────────

/**
 * 将 vscode.LanguageModelChatMessage 数组转换为 OpenAI messages 格式。
 * VS Code role 1 = User, 2 = Assistant
 */
function convertMessages(messages: vscode.LanguageModelChatMessage[]): OpenAIMessage[] {
    return messages.map(m => {
        const roleNum = (m as { role?: number }).role;
        const role = roleNum === 2 ? 'assistant' : 'user';
        const parts = (m as { content?: unknown }).content;
        let content = '';
        if (typeof parts === 'string') {
            content = parts;
        } else if (Array.isArray(parts)) {
            content = parts.map((p: unknown) => {
                if (typeof p === 'string') { return p; }
                if (p && typeof p === 'object' && 'value' in p) { return String((p as { value: unknown }).value); }
                return '';
            }).join('');
        }
        return { role, content } as OpenAIMessage;
    });
}

/** 安全解析 JSON，失败时返回空对象 */
function safeParseJSON(s: string): Record<string, unknown> {
    try { return JSON.parse(s) as Record<string, unknown>; }
    catch { return {}; }
}
