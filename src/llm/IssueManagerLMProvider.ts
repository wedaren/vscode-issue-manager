/**
 * IssueManager LanguageModelChatProvider
 *
 * 将 issueManager.llm.customModels 中配置的自定义模型注册为 VS Code LanguageModelChatProvider，
 * 使其出现在 Copilot 模型选择器中，并通过 FetchAdapter 处理 HTTP 流式请求与工具调用。
 */
import * as vscode from 'vscode';
import { ModelRegistry } from './ModelRegistry';
import { runAddModelWizard } from './modelWizard';

// ─── 内部 OpenAI 格式类型 ─────────────────────────────────────

/** OpenAI Chat Completions API 消息格式（与 ModelAdapter.ts 保持一致） */
interface OpenAIMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
    }>;
    tool_call_id?: string;
}

/** OpenAI SSE streaming chunk 格式 */
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

// ─── Provider 实现 ────────────────────────────────────────────

/**
 * 将 issueManager 自定义模型注册为 VS Code LanguageModelChatProvider。
 * 支持文本流式响应与 OpenAI function-calling 格式的工具调用。
 * 监听 issueManager.llm.customModels 设置变更并自动刷新模型列表。
 */
export class IssueManagerLMProvider implements vscode.LanguageModelChatProvider {
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    /** 供 VS Code 订阅，当模型列表发生变化时触发刷新 */
    readonly onDidChange: vscode.Event<void> = this._onDidChange.event;

    private readonly _configWatcher: vscode.Disposable;

    constructor() {
        // 监听自定义模型配置变更，通知 VS Code 刷新模型列表
        this._configWatcher = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('issueManager.llm.customModels')) {
                this._onDidChange.fire();
            }
        });
    }

    /**
     * 返回当前可用的自定义模型元数据列表。
     * - silent=true（后台静默探测）：直接返回已有列表，不弹窗提示
     * - silent=false（用户主动点击）：若无模型则自动弹出添加向导，引导用户配置
     * @param options - { silent: boolean }
     */
    async provideLanguageModelChatInformation(
        options: { silent: boolean },
        _token: vscode.CancellationToken,
    ): Promise<vscode.LanguageModelChatInformation[]> {
        let descriptors = ModelRegistry.getCustomModelDescriptors().filter(m => !m.disabled);

        // 用户主动点击（非静默）且无模型时，弹出添加向导
        if (!options.silent && descriptors.length === 0) {
            const saved = await runAddModelWizard();
            if (saved) {
                // 向导完成后刷新树视图，并重新读取最新模型列表
                void vscode.commands.executeCommand('issueManager.refreshAllViews');
                this._onDidChange.fire();
                descriptors = ModelRegistry.getCustomModelDescriptors().filter(m => !m.disabled);
            }
        }

        return descriptors.map(m => {
            const ctxWindow = m.contextWindow ?? 128_000;
            const maxOutput = 8_192;
            return {
                id: m.id,
                name: m.displayName,
                family: m.model,
                version: '1.0.0',
                maxInputTokens: Math.max(ctxWindow - maxOutput, 4_096),
                maxOutputTokens: maxOutput,
                tooltip: `端点：${m.endpoint ?? 'https://api.openai.com/v1'}`,
                capabilities: {
                    imageInput: m.capabilities?.supportsVision,
                    toolCalling: m.capabilities?.supportsTools !== false,
                },
            };
        });
    }

    /**
     * 处理 Copilot 发来的聊天请求，通过 HTTP 流式调用对应的自定义模型端点。
     * 支持文本流式输出与工具调用（OpenAI function-calling 格式）。
     * @param model - VS Code 提供的模型元数据（含 id）
     * @param messages - 对话消息列表
     * @param options - 含 tools 工具定义列表
     * @param progress - 流式响应写入接口
     * @param token - 取消令牌
     */
    async provideLanguageModelChatResponse(
        model: vscode.LanguageModelChatInformation,
        messages: readonly vscode.LanguageModelChatRequestMessage[],
        options: vscode.ProvideLanguageModelChatResponseOptions,
        progress: vscode.Progress<vscode.LanguageModelResponsePart>,
        token: vscode.CancellationToken,
    ): Promise<void> {
        // 查找对应的描述符（含 endpoint 和 provider）
        const descriptor = ModelRegistry.getCustomModelDescriptors().find(m => m.id === model.id);
        if (!descriptor) {
            throw new Error(`IssueManagerLMProvider：未找到模型 ${model.id}`);
        }

        // 读取 API Key
        const apiKey = await ModelRegistry.getApiKey(
            ModelRegistry.buildApiKeyName(descriptor.provider, descriptor.endpoint),
        );

        // 转换消息格式
        const oaiMessages = this._convertMessages(messages);

        // 构建请求端点
        const endpoint = this._buildEndpoint(
            descriptor.endpoint ?? 'https://api.openai.com/v1',
            descriptor.provider,
        );

        // 请求头
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey) { headers['Authorization'] = `Bearer ${apiKey}`; }

        // 转换工具定义为 OpenAI 格式
        const oaiTools = (options.tools ?? []).map(t => ({
            type: 'function' as const,
            function: {
                name: t.name,
                description: t.description,
                parameters: (t.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} },
            },
        }));

        // 请求体
        const body: Record<string, unknown> = {
            model: descriptor.model,
            messages: oaiMessages,
            stream: true,
        };
        if (oaiTools.length > 0) {
            body['tools'] = oaiTools;
            body['tool_choice'] = 'auto';
        }

        // 将 CancellationToken 转换为 AbortController
        const abortCtrl = new AbortController();
        const cancelDisposable = token.onCancellationRequested(() => abortCtrl.abort());

        try {
            await this._streamRequest(endpoint, headers, body, abortCtrl.signal, progress);
        } finally {
            cancelDisposable.dispose();
        }
    }

    /**
     * 估算文本或消息的 token 数量（按字符数 / 4 简单估算）。
     * @param _model - 模型元数据（本实现未使用）
     * @param text - 待估算的文本或消息
     */
    async provideTokenCount(
        _model: vscode.LanguageModelChatInformation,
        text: string | vscode.LanguageModelChatRequestMessage,
        _token: vscode.CancellationToken,
    ): Promise<number> {
        if (typeof text === 'string') {
            return Math.ceil(text.length / 4);
        }
        // 提取消息中所有文本部分合并后估算
        const content = (text.content as unknown[])
            .filter((p): p is vscode.LanguageModelTextPart => p instanceof vscode.LanguageModelTextPart)
            .map(p => p.value)
            .join('');
        return Math.ceil(content.length / 4);
    }

    /**
     * 释放配置监听器与事件发射器资源。
     */
    dispose(): void {
        this._configWatcher.dispose();
        this._onDidChange.dispose();
    }

    // ─── 内部方法 ─────────────────────────────────────────────

    /**
     * 将 VS Code LanguageModelChatRequestMessage[] 转换为 OpenAI messages 格式。
     * - User 消息中的 ToolResultPart → 'tool' 角色消息
     * - Assistant 消息中的 ToolCallPart → 'assistant' + tool_calls
     */
    private _convertMessages(
        messages: readonly vscode.LanguageModelChatRequestMessage[],
    ): OpenAIMessage[] {
        const result: OpenAIMessage[] = [];

        for (const msg of messages) {
            const role = msg.role === vscode.LanguageModelChatMessageRole.User ? 'user' : 'assistant';

            let textContent = '';
            const toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = [];
            const toolResults: Array<{ callId: string; content: string }> = [];

            for (const part of msg.content) {
                if (part instanceof vscode.LanguageModelTextPart) {
                    textContent += part.value;
                } else if (part instanceof vscode.LanguageModelToolCallPart) {
                    toolCalls.push({
                        id: part.callId,
                        type: 'function',
                        function: {
                            name: part.name,
                            arguments: JSON.stringify(part.input),
                        },
                    });
                } else if (part instanceof vscode.LanguageModelToolResultPart) {
                    // 工具结果内容：提取文本部分拼接
                    const content = (part.content as unknown[])
                        .filter((p): p is vscode.LanguageModelTextPart => p instanceof vscode.LanguageModelTextPart)
                        .map(p => p.value)
                        .join('');
                    toolResults.push({ callId: part.callId, content });
                }
            }

            if (toolResults.length > 0) {
                // 每个工具结果对应一条 'tool' 角色消息
                for (const tr of toolResults) {
                    result.push({ role: 'tool', content: tr.content, tool_call_id: tr.callId });
                }
            } else if (toolCalls.length > 0) {
                result.push({ role: 'assistant', content: textContent || null, tool_calls: toolCalls });
            } else {
                result.push({ role, content: textContent });
            }
        }

        return result;
    }

    /**
     * 构建 OpenAI /chat/completions 完整端点 URL。
     *
     * 兼容三种常见写法：
     * - 已是完整路径：https://api.example.com/v1/chat/completions  → 原样返回
     * - 标准 /v1 结尾：https://api.openai.com/v1                  → 追加 /chat/completions
     * - 非标路径结尾：https://api.kimi.com/coding                 → 追加 /chat/completions
     *   （不强制要求 /v1，避免 404）
     */
    private _buildEndpoint(baseUrl: string, provider: string): string {
        const clean = baseUrl.replace(/\/$/, '');
        // 已包含完整路径，直接使用
        if (clean.endsWith('/chat/completions')) { return clean; }
        // Ollama 本地服务：若未含 /v1 则补上
        if (provider === 'ollama') {
            return clean.endsWith('/v1')
                ? `${clean}/chat/completions`
                : `${clean}/v1/chat/completions`;
        }
        // OpenAI 兼容服务：有 /v1 就直接追加，没有也直接追加（不强制插入 /v1）
        return `${clean}/chat/completions`;
    }

    /**
     * 执行单次 HTTP SSE 流式请求，将文本 chunk 和工具调用上报给 VS Code progress。
     * 注意：VS Code 负责工具调用的执行循环，provider 只负责单轮 HTTP 调用。
     * @param endpoint - 完整的 API 端点 URL
     * @param headers - 请求头（含 Authorization）
     * @param body - JSON 请求体（已序列化前）
     * @param signal - AbortSignal
     * @param progress - 流式报告接口
     */
    private async _streamRequest(
        endpoint: string,
        headers: Record<string, string>,
        body: Record<string, unknown>,
        signal: AbortSignal,
        progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    ): Promise<void> {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: signal as RequestInit['signal'],
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            let hint = '';
            if (response.status === 401 || response.status === 403) {
                hint = ' — API Key 无效或未配置，请在侧边栏问题管理器 > AI 模型 > 右键"更新 API Key"';
            } else if (response.status === 404) {
                hint = `\n调用地址：${endpoint}\n请检查模型端点配置是否正确（右键模型节点 > 删除 > 重新添加）`;
            }
            throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}${hint}`);
        }

        if (!response.body) { throw new Error('响应体为空'); }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        // 累积工具调用（多 chunk 拼接 arguments）
        const pendingToolCalls = new Map<number, { id: string; name: string; arguments: string }>();

        try {
            while (true) {
                if (signal.aborted) { break; }
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
                    // 文本内容：直接流式上报
                    if (delta.content) {
                        progress.report(new vscode.LanguageModelTextPart(delta.content));
                    }

                    // 工具调用：累积各 chunk 的 arguments（分片传输）
                    if (delta.tool_calls) {
                        for (const tc of delta.tool_calls) {
                            const idx = tc.index;
                            if (!pendingToolCalls.has(idx)) {
                                pendingToolCalls.set(idx, {
                                    id: tc.id ?? `call_${idx}`,
                                    name: tc.function?.name ?? '',
                                    arguments: '',
                                });
                            }
                            const existing = pendingToolCalls.get(idx)!;
                            if (tc.id) { existing.id = tc.id; }
                            if (tc.function?.name) { existing.name = tc.function.name; }
                            if (tc.function?.arguments) { existing.arguments += tc.function.arguments; }
                        }
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        // 流结束后，统一上报所有累积的工具调用
        for (const [, tc] of pendingToolCalls) {
            let input: Record<string, unknown> = {};
            try {
                input = JSON.parse(tc.arguments || '{}') as Record<string, unknown>;
            } catch { /* arguments 解析失败时保持空对象 */ }
            progress.report(new vscode.LanguageModelToolCallPart(tc.id, tc.name, input));
        }
    }
}
