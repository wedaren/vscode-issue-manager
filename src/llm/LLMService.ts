import * as vscode from "vscode";
import { getAllIssueMarkdowns } from "../data/IssueMarkdowns";
import { Logger } from "../core/utils/Logger";

export class LLMService {
    // 使用 VS Code LanguageModelChat.sendRequest 并基于 response.text 聚合结果，兼容 Cancellation
    private static async _sendRequestAndAggregate(
        model: vscode.LanguageModelChat,
        messages: vscode.LanguageModelChatMessage[],
        options?: { signal?: AbortSignal }
    ): Promise<string> {
        // 如果调用时已经被取消，立即抛出
        if (options?.signal?.aborted) {
            throw new Error("请求已取消");
        }

        const cts = new vscode.CancellationTokenSource();
        let onAbort: (() => void) | undefined;
        if (options?.signal) {
            onAbort = () => cts.cancel();
            try {
                options.signal.addEventListener("abort", onAbort);
            } catch {
                // ignore if cannot attach
                onAbort = undefined;
            }
        }

        const resp = await model.sendRequest(messages, undefined, cts.token);
        let full = "";
        try {
            for await (const chunk of resp.text) {
                if (cts.token.isCancellationRequested) {
                    throw new Error("请求已取消");
                }
                full += String(chunk);
            }
        } finally {
            // 移除外部 AbortSignal 的监听器（如果已添加）
            try {
                if (options?.signal && onAbort) {
                    options.signal.removeEventListener("abort", onAbort);
                }
            } catch {
                // ignore
            }
            cts.dispose();
        }
        return full;
    }

    /**
     * 选择模型并发送请求，若未找到模型则返回 null。
     */
    public static async _request(
        messages: vscode.LanguageModelChatMessage[],
        options?: { signal?: AbortSignal; modelFamily?: string }
    ): Promise<{ text: string; modelFamily?: string } | null> {
        const logger = Logger.getInstance();
        const startMs = Date.now();
        const promptChars = messages.reduce((s, m) => s + String((m as any).content ?? '').length, 0);
        logger.info(`[LLM._request] 开始 | 指定模型=${options?.modelFamily ?? '(VS Code配置)'} | 消息数=${messages.length} | prompt大小=${promptChars}字`);

        if (options?.signal?.aborted) {
            logger.warn('[LLM._request] 已取消');
            throw new Error("请求已取消");
        }

        const model = await LLMService.selectModel(options);
        if (!model) {
            logger.error('[LLM._request] 未找到可用模型');
            vscode.window.showErrorMessage(
                "未找到可用的 Copilot 模型。请确保已安装并登录 GitHub Copilot 扩展。"
            );
            return null;
        }

        const modelFamily = (model as any)?.family || (model as any)?.model?.family;
        logger.info(`[LLM._request] 选中模型=${modelFamily}`);

        try {
            const text = await LLMService._sendRequestAndAggregate(model, messages, options);
            logger.info(`[LLM._request] 完成 | 模型=${modelFamily} | 响应长度=${text.length}字 | 耗时=${Date.now() - startMs}ms`);
            return { text, modelFamily };
        } catch (e) {
            logger.error(`[LLM._request] 失败 | 模型=${modelFamily} | 耗时=${Date.now() - startMs}ms`, e as Error);
            throw e;
        }
    }

    /**
     * 对外的聊天接口：接收一组 `LanguageModelChatMessage`，返回聚合后的文本结果。
     */
    public static async chat(
        messages: vscode.LanguageModelChatMessage[],
        options?: { signal?: AbortSignal; modelFamily?: string }
    ): Promise<{ text: string; modelFamily?: string } | null> {
        return LLMService._request(messages, options);
    }

    /**
     * 流式调用：对每个接收到的 chunk 调用 onChunk，并返回最终聚合文本与模型信息。
     * 支持通过 options.modelFamily 指定模型，优先级高于 VS Code 配置。
     */
    public static async stream(
        messages: vscode.LanguageModelChatMessage[],
        onChunk: (chunk: string) => void,
        options?: { signal?: AbortSignal; modelFamily?: string }
    ): Promise<{ text: string; modelFamily?: string } | null> {
        const logger = Logger.getInstance();
        const startMs = Date.now();
        const promptChars = messages.reduce((s, m) => s + String((m as any).content ?? '').length, 0);
        logger.info(`[LLM.stream] 开始 | 指定模型=${options?.modelFamily ?? '(VS Code配置)'} | 消息数=${messages.length} | prompt大小=${promptChars}字`);

        if (options?.signal?.aborted) {
            logger.warn('[LLM.stream] 已取消');
            throw new Error('请求已取消');
        }

        const model = await LLMService.selectModel(options);
        if (!model) {
            logger.error('[LLM.stream] 未找到可用模型');
            vscode.window.showErrorMessage('未找到可用的 Copilot 模型。请确保已安装并登录 GitHub Copilot 扩展。');
            return null;
        }

        const modelFamily = (model as any)?.family || (model as any)?.model?.family;
        logger.info(`[LLM.stream] 选中模型=${modelFamily}`);

        const cts = new vscode.CancellationTokenSource();
        let onAbort: (() => void) | undefined;
        if (options?.signal) {
            onAbort = () => cts.cancel();
            try {
                options.signal.addEventListener('abort', onAbort);
            } catch {
                onAbort = undefined;
            }
        }

        const resp = await model.sendRequest(messages, undefined, cts.token);
        let full = '';
        let chunkCount = 0;
        try {
            for await (const chunk of resp.text) {
                const s = String(chunk);
                full += s;
                chunkCount++;
                try {
                    onChunk(s);
                } catch (e) {
                    // 忽略回调错误，继续流
                    logger.warn('onChunk callback failed', e as Error ?? e);
                }

                if (cts.token.isCancellationRequested) {
                    logger.warn(`[LLM.stream] 取消 | 模型=${modelFamily} | 已收刽${chunkCount}个chunk`);
                    throw new Error('请求已取消');
                }
            }
        } catch (e) {
            if (!cts.token.isCancellationRequested) {
                logger.error(`[LLM.stream] 流式错误 | 模型=${modelFamily} | 耗时=${Date.now() - startMs}ms`, e as Error);
            }
            throw e;
        } finally {
            try {
                if (options?.signal && onAbort) {
                    options.signal.removeEventListener('abort', onAbort);
                }
            } catch { }
            cts.dispose();
        }

        logger.info(`[LLM.stream] 完成 | 模型=${modelFamily} | chunks=${chunkCount} | 响应长度=${full.length}字 | 耗时=${Date.now() - startMs}ms`);
        return { text: full, modelFamily };
    }

    /**
     * 带工具调用的流式请求。
     * 当 LLM 请求调用工具时，自动执行工具并将结果反馈给 LLM 继续生成。
     * 循环直到 LLM 不再调用工具为止。
     */
    public static async streamWithTools(
        messages: vscode.LanguageModelChatMessage[],
        tools: vscode.LanguageModelChatTool[],
        onChunk: (chunk: string) => void,
        onToolCall: (toolName: string, input: Record<string, unknown>) => Promise<string>,
        options?: {
            signal?: AbortSignal;
            modelFamily?: string;
            /** 工具调用状态回调（用于 UI 显示） */
            onToolStatus?: (status: { toolName: string; phase: 'calling' | 'done'; result?: string }) => void;
            /** LLM 决定调用工具时触发（每轮一次），传入本轮文本和待调用工具列表 */
            onToolsDecided?: (info: { roundText: string; toolNames: string[]; round: number }) => void;
            /** 最大工具调用轮次（防止无限循环） */
            maxToolRounds?: number;
        },
    ): Promise<{ text: string; modelFamily?: string } | null> {
        const logger = Logger.getInstance();
        const startMs = Date.now();
        const maxRounds = options?.maxToolRounds ?? 10;

        logger.info(`[LLM.streamWithTools] 开始 | 工具数=${tools.length} | 消息数=${messages.length}`);

        if (options?.signal?.aborted) {
            throw new Error('请求已取消');
        }

        const model = await LLMService.selectModel(options);
        if (!model) {
            vscode.window.showErrorMessage('未找到可用的 Copilot 模型。请确保已安装并登录 GitHub Copilot 扩展。');
            return null;
        }

        const modelFamily = (model as any)?.family || (model as any)?.model?.family;
        const cts = new vscode.CancellationTokenSource();
        let onAbort: (() => void) | undefined;
        if (options?.signal) {
            onAbort = () => cts.cancel();
            try { options.signal.addEventListener('abort', onAbort); } catch { onAbort = undefined; }
        }

        // 使用工作副本的消息列表，在工具调用循环中追加
        const workingMessages = [...messages];
        let fullText = '';
        let round = 0;

        try {
            while (round < maxRounds) {
                if (cts.token.isCancellationRequested) { throw new Error('请求已取消'); }

                round++;
                logger.info(`[LLM.streamWithTools] 第 ${round} 轮请求`);

                const resp = await model.sendRequest(workingMessages, { tools }, cts.token);

                // 收集本轮的文本和工具调用
                let roundText = '';
                const toolCalls: vscode.LanguageModelToolCallPart[] = [];

                for await (const part of resp.stream) {
                    if (cts.token.isCancellationRequested) { throw new Error('请求已取消'); }

                    if (part instanceof vscode.LanguageModelTextPart) {
                        roundText += part.value;
                        try { onChunk(part.value); } catch { /* 忽略回调错误 */ }
                    } else if (part instanceof vscode.LanguageModelToolCallPart) {
                        toolCalls.push(part);
                    }
                }

                fullText += roundText;

                // 如果没有工具调用，表示 LLM 完成了回复
                if (toolCalls.length === 0) {
                    break;
                }

                // 通知调用方：LLM 决定调用哪些工具
                try {
                    options?.onToolsDecided?.({
                        roundText,
                        toolNames: toolCalls.map(tc => tc.name),
                        round,
                    });
                } catch { /* 回调错误不阻塞 */ }

                // 处理工具调用
                // 1. 将本轮助手回复（包含文本和工具调用）添加到消息列表
                const assistantParts: Array<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart> = [];
                if (roundText) {
                    assistantParts.push(new vscode.LanguageModelTextPart(roundText));
                }
                assistantParts.push(...toolCalls);
                workingMessages.push(vscode.LanguageModelChatMessage.Assistant(assistantParts));

                // 2. 执行每个工具调用并收集结果
                const toolResultParts: vscode.LanguageModelToolResultPart[] = [];
                for (const tc of toolCalls) {
                    logger.info(`[LLM.streamWithTools] 调用工具: ${tc.name}`, tc.input);
                    options?.onToolStatus?.({ toolName: tc.name, phase: 'calling' });

                    try {
                        const result = await onToolCall(tc.name, tc.input as Record<string, unknown>);
                        toolResultParts.push(
                            new vscode.LanguageModelToolResultPart(tc.callId, [new vscode.LanguageModelTextPart(result)]),
                        );
                        options?.onToolStatus?.({ toolName: tc.name, phase: 'done', result });
                    } catch (e) {
                        const errMsg = e instanceof Error ? e.message : String(e);
                        toolResultParts.push(
                            new vscode.LanguageModelToolResultPart(tc.callId, [new vscode.LanguageModelTextPart(`工具执行失败: ${errMsg}`)]),
                        );
                        options?.onToolStatus?.({ toolName: tc.name, phase: 'done', result: `失败: ${errMsg}` });
                    }
                }

                // 3. 将工具结果作为 User 消息追加
                workingMessages.push(vscode.LanguageModelChatMessage.User(toolResultParts));
            }
        } finally {
            try {
                if (options?.signal && onAbort) {
                    options.signal.removeEventListener('abort', onAbort);
                }
            } catch { /* ignore */ }
            cts.dispose();
        }

        logger.info(`[LLM.streamWithTools] 完成 | 轮次=${round} | 响应长度=${fullText.length}字 | 耗时=${Date.now() - startMs}ms`);
        return { text: fullText, modelFamily };
    }

    private static async selectModel(options?: {
        signal?: AbortSignal;
        modelFamily?: string; // 外部传入的指定模型 family，优先级高于 VS Code 配置
    }): Promise<vscode.LanguageModelChat | undefined> {
        const logger = Logger.getInstance();
        const config = vscode.workspace.getConfiguration("issueManager");
        const configFamily = config.get<string>("llm.modelFamily") || "gpt-5-mini";
        // 如果调用方指定了 modelFamily，优先使用；否则回落到 VS Code 配置
        const preferredFamily = options?.modelFamily || configFamily;

        logger.info(`[LLM.selectModel] 查找模型 | 外部指定=${options?.modelFamily ?? '无'} | VSCode配置=${configFamily} | 实际使用=${preferredFamily}`);

        // 1. 尝试使用指定的模型
        let models = await vscode.lm.selectChatModels({
            vendor: "copilot",
            family: preferredFamily,
        });

        // 2. 如果没找到，且是外部指定的模型，记录警告
        if (models.length === 0 && options?.modelFamily) {
            logger.warn(`[LLM.selectModel] 未找到指定模型 family="${options.modelFamily}"，尝试回落`);
        }

        // 3. 回落到 gpt-5-mini
        if (models.length === 0 && preferredFamily !== "gpt-5-mini") {
            models = await vscode.lm.selectChatModels({ vendor: "copilot", family: "gpt-5-mini" });
            if (models.length > 0) { logger.info('[LLM.selectModel] 回落到 gpt-5-mini'); }
        }

        // 4. 回落到 gpt-4o
        if (models.length === 0 && preferredFamily !== "gpt-4o") {
            models = await vscode.lm.selectChatModels({ vendor: "copilot", family: "gpt-4o" });
            if (models.length > 0) { logger.info('[LLM.selectModel] 回落到 gpt-4o'); }
        }

        // 5. 回落到 gpt-4.1
        if (models.length === 0 && preferredFamily !== "gpt-4.1") {
            models = await vscode.lm.selectChatModels({ vendor: "copilot", family: "gpt-4.1" });
            if (models.length > 0) { logger.info('[LLM.selectModel] 回落到 gpt-4.1'); }
        }

        // 6. 回落到任意 Copilot 模型
        if (models.length === 0) {
            models = await vscode.lm.selectChatModels({ vendor: "copilot" });
            if (models.length > 0) { logger.info(`[LLM.selectModel] 回落到任意可用模型: ${(models[0] as any)?.family}`); }
        }

        if (models.length > 0) {
            const chosen = models[0];
            const chosenFamily = (chosen as any)?.family ?? '未知';
            logger.info(`[LLM.selectModel] 最终选中: ${chosenFamily}`);
            return chosen;
        }

        logger.error('[LLM.selectModel] 未找到任何可用的 Copilot 模型');
        return undefined;
    }

    public static async getSuggestions(
        text: string,
        options?: { signal?: AbortSignal }
    ): Promise<{ optimized: string[]; similar: { title: string; filePath: string }[] }> {
        const allIssues = await getAllIssueMarkdowns();

        const prompt = `
你是一个智能问题管理助手。用户会给你一个问题描述，你需要完成以下任务：
1. 根据用户的问题描述，生成3-4个优化后的、更清晰、更简洁的问题标题建议。
2. 从提供的现有笔记列表中，找出最多5个与用户问题描述语义最相关的笔记。请提供这些笔记的标题和文件路径。

请以 JSON 格式返回结果，格式如下：
{
  "optimized": [
    "优化标题1",
    "优化标题2"
  ],
  "similar": [
    {
      "title": "相似笔记标题1",
      "filePath": "/path/to/similar/note1.md"
    },
    {
      "title": "相似笔记标题2",
      "filePath": "/path/to/similar/note2.md"
    }
  ]
}

用户问题描述: "${text}"

现有笔记列表（标题和文件路径）：
${JSON.stringify(
            allIssues.map(i => ({ title: i.title, filePath: i.uri.fsPath })),
            null,
            2
        )}
`;

        try {
            const fullResp = await LLMService._request(
                [vscode.LanguageModelChatMessage.User(prompt)],
                options
            );
            if (fullResp === null) {
                return { optimized: [], similar: [] };
            }
            const fullResponse = fullResp.text;
            Logger.getInstance().info("LLM Raw Response:", fullResponse); // 打印原始响应

            // 尝试从响应中提取 JSON 部分
            const jsonMatch = fullResponse.match(/```json\n([\s\S]*?)\n```/);
            let jsonString = fullResponse;

            if (jsonMatch && jsonMatch[1]) {
                jsonString = jsonMatch[1];
            } else {
                // 如果没有找到 ```json``` 块，尝试直接解析，但要确保它以 { 开头
                const firstBrace = fullResponse.indexOf("{");
                const lastBrace = fullResponse.lastIndexOf("}");
                if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                    jsonString = fullResponse.substring(firstBrace, lastBrace + 1);
                }
            }

            // 尝试解析 JSON
            const parsedResponse = JSON.parse(jsonString);

            return {
                optimized: parsedResponse.optimized || [],
                similar: parsedResponse.similar || [],
            };
        } catch (error) {
            if (options?.signal?.aborted) {
                // 被主动取消时静默返回空
                return { optimized: [], similar: [] };
            }
            vscode.window.showErrorMessage(`调用 Copilot API 失败: ${error}`);
            Logger.getInstance().error("Copilot API error:", error);
            return { optimized: [], similar: [] };
        }
    }

    /**
     * AI 搜索：从现有笔记中找出与输入最相关的问题文件路径
     */
    public static async searchIssueMarkdowns(
        query: string,
        options?: { signal?: AbortSignal }
    ): Promise<{ filePath: string; title?: string }[]> {
        const trimmed = (query || "").trim();
        if (!trimmed) {
            return [];
        }

        const allIssues = await getAllIssueMarkdowns();
        const prompt = `
你是一个问题管理助手。请根据用户的搜索关键词，从提供的笔记列表中选出最相关的笔记（最多 20 条）。

请仅返回 JSON，格式如下：
{
  "matches": [
    { "filePath": "/abs/path/to/note.md", "title": "标题" }
  ]
}

用户搜索关键词: "${trimmed}"

笔记列表（标题与路径）：
${JSON.stringify(
            allIssues.map(i => ({ title: i.title, filePath: i.uri.fsPath })),
            null,
            2
        )}
`;

        try {
            const fullResp = await LLMService._request(
                [vscode.LanguageModelChatMessage.User(prompt)],
                options
            );
            if (fullResp === null) {
                return [];
            }

            const fullResponse = fullResp.text;
            Logger.getInstance().info("LLM searchIssueMarkdowns Raw Response:", fullResponse);

            const jsonBlockMatch = fullResponse.match(/```json\s*([\s\S]*?)\s*```/i);
            let jsonCandidate = "";
            if (jsonBlockMatch && jsonBlockMatch[1]) {
                jsonCandidate = jsonBlockMatch[1];
            } else {
                const firstBrace = fullResponse.indexOf("{");
                const lastBrace = fullResponse.lastIndexOf("}");
                if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                    jsonCandidate = fullResponse.substring(firstBrace, lastBrace + 1);
                }
            }

            if (!jsonCandidate) {
                return [];
            }

            const parsed = JSON.parse(jsonCandidate);
            const matches = Array.isArray(parsed?.matches) ? parsed.matches : [];
            return matches
                .filter((item: any) => item && typeof item.filePath === "string")
                .map((item: any) => ({
                    filePath: item.filePath,
                    title: typeof item.title === "string" ? item.title : undefined
                }));
        } catch (error) {
            if (options?.signal?.aborted) {
                return [];
            }
            Logger.getInstance().error("LLM searchIssueMarkdowns error:", error);
            return [];
        }
    }

    /**
     * 根据输入文本生成一个简洁精确的 Markdown 一级标题（单条）。
     * 如果失败或没有生成结果，返回空字符串。
     */
    public static async generateTitle(
        text: string,
        options?: { signal?: AbortSignal }
    ): Promise<string> {
        if (!text || text.trim().length === 0) {
            return "";
        }

        const prompt = `请为以下文本生成一个简洁、精确的 Markdown 一级标题。仅返回 JSON 格式，内容如下：{ "title": "生成的标题文本" }。不要添加任何额外说明或标记。文本内容：『${text}』`;

        try {
            const fullResp = await LLMService._request(
                [vscode.LanguageModelChatMessage.User(prompt)],
                options
            );
            if (fullResp === null) {
                return "";
            }
            const fullResponse = fullResp.text;
            Logger.getInstance().info("LLM generateTitle Raw Response:", fullResponse);

            // 1) 优先尝试提取 ```json``` 区块中的 JSON
            const jsonBlockMatch = fullResponse.match(/```json\s*([\s\S]*?)\s*```/i);
            let jsonCandidate = "";
            if (jsonBlockMatch && jsonBlockMatch[1]) {
                jsonCandidate = jsonBlockMatch[1];
            } else {
                // 2) 尝试提取页面中第一个完整的 JSON 对象（匹配最外层的 {...}）
                const firstBrace = fullResponse.indexOf("{");
                const lastBrace = fullResponse.lastIndexOf("}");
                if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                    jsonCandidate = fullResponse.substring(firstBrace, lastBrace + 1);
                }
            }

            if (jsonCandidate) {
                try {
                    const parsed = JSON.parse(jsonCandidate);
                    if (
                        parsed &&
                        typeof parsed.title === "string" &&
                        parsed.title.trim().length > 0
                    ) {
                        return parsed.title.trim();
                    }
                } catch (err) {
                    Logger.getInstance().warn("解析 LLM 返回的 JSON 失败，回退到文本解析", err);
                    // 继续进行文本解析
                }
            }

            // 回退：从纯文本中提取第一行非空文本并清洗 Markdown 前缀
            const lines = fullResponse
                .split(/\r?\n/)
                .map(l => l.trim())
                .filter(Boolean);
            if (lines.length > 0) {
                const first = lines[0].replace(/^#+\s*/, "").trim();
                return first;
            }

            return "";
        } catch (error) {
            if (options?.signal?.aborted) {
                return "";
            }
            Logger.getInstance().error("generateTitle error:", error);
            // 不弹过多错误弹窗以免干扰用户，但显示一次性错误
            vscode.window.showErrorMessage("调用 Copilot 自动生成标题失败。");
            return "";
        }
    }

    /**
     * 更强壮的标题生成器：改进 prompt、支持截断、增强 JSON 提取与回退解析。
     */
    public static async generateTitleOptimized(
        text: string,
        options?: { signal?: AbortSignal }
    ): Promise<string> {
        if (!text || text.trim().length === 0) {
            return "";
        }

        // 截断以防超长内容导致模型拒绝或超时
        const MAX_CHARS = 64000;
        let sentText = text;
        let truncated = false;
        if (text.length > MAX_CHARS) {
            sentText = text.slice(0, MAX_CHARS);
            truncated = true;
        }

        const promptLines: string[] = [];
        promptLines.push(
            "请为下面的 Markdown 文本生成一个简洁、精确的一行标题（适合作为 Markdown 一级标题，去掉任何前导的 `#`）。"
        );
        promptLines.push(
            '仅返回一个 JSON 对象，格式为：{ "title": "生成的标题文本" }。不要添加其它说明、注释或代码块标签。'
        );
        if (truncated) {
            promptLines.push(
                "(注意：输入已被截断，只包含文件的前部分，因此请基于可见内容生成简洁标题，并尽量保持通用性)"
            );
        }
        promptLines.push("原文如下：");
        promptLines.push("---");
        promptLines.push(sentText);
        promptLines.push("---");

        const prompt = promptLines.join("\n");

        try {
            const fullResp = await LLMService._request(
                [vscode.LanguageModelChatMessage.User(prompt)],
                options
            );
            if (fullResp === null) {
                return "";
            }
            const full = fullResp.text;
            Logger.getInstance().info("LLM generateTitleOptimized Raw Response:", full);

            // 1) 尝试提取 ```json ``` 区块
            const jsonBlockMatch = full.match(/```json\s*([\s\S]*?)\s*```/i);
            let jsonCandidate = "";
            if (jsonBlockMatch && jsonBlockMatch[1]) {
                jsonCandidate = jsonBlockMatch[1];
            }

            // 2) 如果没有，尝试提取第一个平衡的 JSON 对象
            function extractFirstBalancedJson(s: string): string | null {
                const first = s.indexOf("{");
                if (first === -1) {
                    return null;
                }
                let depth = 0;
                for (let i = first; i < s.length; i++) {
                    const ch = s[i];
                    if (ch === "{") {
                        depth++;
                    } else if (ch === "}") {
                        depth--;
                    }
                    if (depth === 0) {
                        return s.substring(first, i + 1);
                    }
                }
                return null;
            }

            if (!jsonCandidate) {
                const balanced = extractFirstBalancedJson(full);
                if (balanced) {
                    jsonCandidate = balanced;
                }
            }

            // 3) 解析 JSON
            if (jsonCandidate) {
                try {
                    const parsed = JSON.parse(jsonCandidate);
                    if (
                        parsed &&
                        typeof parsed.title === "string" &&
                        parsed.title.trim().length > 0
                    ) {
                        return parsed.title.trim();
                    }
                } catch (err) {
                    Logger.getInstance().warn(
                        "解析 LLM generateTitleOptimized JSON 失败，尝试其它解析策略",
                        err
                    );
                }
            }

            // 4) 直接使用键值正则提取 "title": "..."
            const titleMatch =
                full.match(/"title"\s*:\s*"([^"]{1,200})"/i) ||
                full.match(/'title'\s*:\s*'([^']{1,200})'/i);
            if (titleMatch && titleMatch[1]) {
                return titleMatch[1].trim();
            }

            // 5) 回退：取第一行非空并清理 Markdown 前缀
            const lines = full
                .split(/\r?\n/)
                .map(l => l.trim())
                .filter(Boolean);
            if (lines.length > 0) {
                const first = lines[0].replace(/^#+\s*/, "").trim();
                return first;
            }

            return "";
        } catch (error) {
            if (options?.signal?.aborted) {
                return "";
            }
            Logger.getInstance().error("generateTitleOptimized error:", error);
            vscode.window.showErrorMessage("调用 Copilot 自动生成标题失败。");
            return "";
        }
    }

    /**
     * 使用 LLM 翻译给定文本到目标语言。
     * - 会对超长输入进行截断提示（以防模型拒绝或超时）。
     * - 返回模型生成的翻译文本（不包含原始 frontmatter）。
     */
    public static async translate(
        text: string,
        targetLang: string,
        options?: { signal?: AbortSignal }
    ): Promise<string> {
        if (!text || text.trim().length === 0) {
            return "";
        }

        const MAX_CHARS = 200000; // 保守截断，避免超长
        let sentText = text;
        let truncated = false;
        if (text.length > MAX_CHARS) {
            sentText = text.slice(0, MAX_CHARS);
            truncated = true;
        }

        const promptLines: string[] = [];
        promptLines.push(`请将下面的 Markdown 文本翻译为 ${targetLang}，保持专有名词、术语与人名不被不必要地翻译，保持原有的 Markdown 结构（标题、代码块、列表等）。`);
        promptLines.push('仅返回翻译后的 Markdown 正文，不要包含额外说明、步骤或标记。');
        if (truncated) {
            promptLines.push('(注意：原文已被截断，仅提供部分内容，请尽量基于可见内容进行连贯翻译)');
        }
        promptLines.push('原文如下：');
        promptLines.push('---');
        promptLines.push(sentText);
        promptLines.push('---');

        const prompt = promptLines.join('\n');

        try {
            const fullResp = await LLMService._request(
                [vscode.LanguageModelChatMessage.User(prompt)],
                options
            );
            if (fullResp === null) {
                return "";
            }
            const full = fullResp.text;
            Logger.getInstance().info('LLM translate Raw Response:', full);

            // 尝试提取代码块或直接返回文本
            // 如果响应包含 ```markdown``` 块，提取其中内容
            const mdBlock = full.match(/```(?:markdown)?\n([\s\S]*?)\n```/i);
            if (mdBlock && mdBlock[1]) {
                return mdBlock[1].trim();
            }

            // 否则直接返回全部文本
            return full.trim();
        } catch (error) {
            if (options?.signal?.aborted) {
                return "";
            }
            Logger.getInstance().error('LLM translate error:', error);
            vscode.window.showErrorMessage('调用 Copilot 翻译失败。');
            return "";
        }
    }

    /**
     * 根据输入文本生成一个简明的摘要（3-5句话）。
     * 如果失败或没有生成结果，返回空字符串。
     */
    public static async generateBriefSummary(
        text: string,
        options?: { signal?: AbortSignal }
    ): Promise<string> {
        if (!text || text.trim().length === 0) {
            return "";
        }

        // 截断以防超长内容导致模型拒绝或超时
        const MAX_CHARS = 64000;
        let sentText = text;
        let truncated = false;
        if (text.length > MAX_CHARS) {
            sentText = text.slice(0, MAX_CHARS);
            truncated = true;
        }

        const promptLines: string[] = [];
        promptLines.push(
            "请为下面的 Markdown 文本生成一个简明的摘要（3-5句话），概括其核心内容和关键要点。"
        );
        promptLines.push(
            '仅返回一个 JSON 对象，格式为：{ "summary": "生成的摘要文本" }。不要添加其它说明、注释或代码块标签。'
        );
        if (truncated) {
            promptLines.push(
                "(注意：输入已被截断，只包含文件的前部分，请基于可见内容生成简明摘要)"
            );
        }
        promptLines.push("原文如下：");
        promptLines.push("---");
        promptLines.push(sentText);
        promptLines.push("---");

        const prompt = promptLines.join("\n");

        try {
            const fullResp = await LLMService._request(
                [vscode.LanguageModelChatMessage.User(prompt)],
                options
            );
            if (fullResp === null) {
                return "";
            }
            const full = fullResp.text;
            Logger.getInstance().info("LLM generateBriefSummary Raw Response:", full);

            // 1) 尝试提取 ```json ``` 区块
            const jsonBlockMatch = full.match(/```json\s*([\s\S]*?)\s*```/i);
            let jsonCandidate = "";
            if (jsonBlockMatch && jsonBlockMatch[1]) {
                jsonCandidate = jsonBlockMatch[1];
            }

            // 2) 如果没有，尝试提取第一个平衡的 JSON 对象
            function extractFirstBalancedJson(s: string): string | null {
                const first = s.indexOf("{");
                if (first === -1) {
                    return null;
                }
                let depth = 0;
                for (let i = first; i < s.length; i++) {
                    const ch = s[i];
                    if (ch === "{") {
                        depth++;
                    } else if (ch === "}") {
                        depth--;
                    }
                    if (depth === 0) {
                        return s.substring(first, i + 1);
                    }
                }
                return null;
            }

            if (!jsonCandidate) {
                const balanced = extractFirstBalancedJson(full);
                if (balanced) {
                    jsonCandidate = balanced;
                }
            }

            // 3) 解析 JSON
            if (jsonCandidate) {
                try {
                    const parsed = JSON.parse(jsonCandidate);
                    if (
                        parsed &&
                        typeof parsed.summary === "string" &&
                        parsed.summary.trim().length > 0
                    ) {
                        return parsed.summary.trim();
                    }
                } catch (err) {
                    Logger.getInstance().warn(
                        "解析 LLM generateBriefSummary JSON 失败，尝试其它解析策略",
                        err
                    );
                }
            }

            // 4) 直接使用键值正则提取 "summary": "..."
            const summaryMatch =
                full.match(/"summary"\s*:\s*"([^"]{1,500})"/i) ||
                full.match(/'summary'\s*:\s*'([^']{1,500})'/i);
            if (summaryMatch && summaryMatch[1]) {
                return summaryMatch[1].trim();
            }

            // 5) 回退：取第一段非空文本（最多500字符）
            const paragraphs = full
                .split(/\n\n+/)
                .map(p => p.trim())
                .filter(Boolean);
            if (paragraphs.length > 0) {
                const first = paragraphs[0].substring(0, 500).trim();
                return first;
            }

            return "";
        } catch (error) {
            if (options?.signal?.aborted) {
                return "";
            }
            Logger.getInstance().error("generateBriefSummary error:", error);
            vscode.window.showErrorMessage("调用 Copilot 自动生成摘要失败。");
            return "";
        }
    }

    /**
     * 根据用户输入生成一篇完整的 Markdown 文档。
     * @param prompt 用户的主题或问题
     * @param options 可选参数
     */
    public static async generateDocument(
        prompt: string,
        options?: { signal?: AbortSignal }
    ): Promise<{ title: string; content: string; modelFamily?: string }> {
        if (!prompt || prompt.trim().length === 0) {
            return { title: "", content: "" };
        }

        const systemPrompt = `
你是一个专业的深度研究助手和技术文档撰写专家。
请根据用户的主题或问题，进行深入分析，并撰写一篇结构清晰、内容详实的 Markdown 文档。

要求：
1. 直接返回 Markdown 格式的内容，不要使用 JSON。
2. 文档的第一行必须是文档的一级标题（# 标题）。
3. 从第二行开始是正文内容。
4. 内容应包含引言、核心分析/解决方案、结论等部分。
5. 适当使用二级标题、列表、代码块等 Markdown 语法来增强可读性。
6. 语气专业、客观。
`;

        try {
            const fullResp = await LLMService._request(
                [
                    vscode.LanguageModelChatMessage.User(systemPrompt),
                    vscode.LanguageModelChatMessage.User(`用户主题：${prompt}`),
                ],
                options
            );
            if (fullResp === null) {
                return { title: "", content: "" };
            }
            const fullResponse = fullResp.text;
            const modelFamily = fullResp.modelFamily;
            Logger.getInstance().debug("LLM generateDocument Raw Response:", fullResponse);

            // 清理可能存在的 Markdown 代码块标记
            let cleanContent = fullResponse;
            const codeBlockMatch =
                fullResponse.match(/^```markdown\s*([\s\S]*?)\s*```$/i) ||
                fullResponse.match(/^```\s*([\s\S]*?)\s*```$/i);
            if (codeBlockMatch && codeBlockMatch[1]) {
                cleanContent = codeBlockMatch[1];
            }

            // 提取标题和内容
            const lines = cleanContent.split("\n");
            let title = "未命名文档";
            let content = cleanContent;

            // 查找第一个非空行作为标题
            const firstLineIndex = lines.findIndex(l => l.trim().length > 0);
            if (firstLineIndex !== -1) {
                const firstLine = lines[firstLineIndex].trim();
                if (firstLine.startsWith("# ")) {
                    title = firstLine.replace(/^#\s+/, "").trim();
                    // 如果第一行是标题，内容可以保留原样，或者去掉标题行（取决于需求，通常保留标题在文档中更好）
                    // 这里我们保留完整内容，因为 createIssueFile 可能会使用 content 作为文件内容
                } else {
                    // 如果第一行不是 # 开头，尝试把它当做标题
                    title = firstLine.replace(/^#+\s*/, "").trim();
                }
            }

            return { title, content, modelFamily };
        } catch (error) {
            if (options?.signal?.aborted) {
                return { title: "", content: "" };
            }
            Logger.getInstance().error("generateDocument error:", error);
            throw error; // 重新抛出异常
        }
    }

    /**
     * 根据文本生成若干项目名候选和简要说明，返回数组 { name, description }
     */
    public static async generateProjectNames(
        text: string,
        options?: { signal?: AbortSignal }
    ): Promise<Array<{ name: string; description: string }>> {
        if (!text || text.trim().length === 0) {
            return [];
        }

        const prompt = `请基于下面的文本内容，生成 10 个适合作为项目名的候选。每个候选的 "name" 必须为驼峰命名（camelCase），仅使用英文单词或短语，不包含中文字符或额外标点；并为每个返回字段 "description"，该字段必须使用中文简要说明（解释为什么选择该名称、该名称与项目的关联或命名原因）。仅返回一个 Markdown 格式的 \`\`\`json\n[{"name":"...","description":"..."}, ...]\n\`\`\` 代码块，且不要添加任何其它说明或文本。文本：'''${text}'''`;

        try {
            const fullResp = await LLMService._request(
                [vscode.LanguageModelChatMessage.User(prompt)],
                options
            );
            if (fullResp === null) {
                return [];
            }
            const full = fullResp.text;

            // 尝试提取 JSON
            const jsonBlockMatch = full.match(/```json\s*([\s\S]*?)\s*```/i);
            let jsonCandidate = "";
            if (jsonBlockMatch && jsonBlockMatch[1]) {
                jsonCandidate = jsonBlockMatch[1];
            } else {
                const first = full.indexOf("[");
                const last = full.lastIndexOf("]");
                if (first !== -1 && last !== -1 && last > first) {
                    jsonCandidate = full.substring(first, last + 1);
                }
            }

            if (jsonCandidate) {
                try {
                    const parsed = JSON.parse(jsonCandidate);
                    if (Array.isArray(parsed)) {
                        return parsed
                            .map(p => ({
                                name: String(p.name || p.label || p.title || ""),
                                description: String(p.description || ""),
                            }))
                            .filter(p => p.name);
                    }
                } catch (err) {
                    Logger.getInstance().warn(
                        "解析 generateProjectNames JSON 失败，回退到文本解析",
                        err
                    );
                }
            }

            // 回退：按行解析，取前几行作为 name，后半部分为说明
            const lines = full
                .split(/\r?\n/)
                .map(l => l.trim())
                .filter(Boolean);
            const candidates: Array<{ name: string; description: string }> = [];
            for (const ln of lines) {
                const m = ln.match(/^[-\d\.\)\s]*(?:"|')?(.*?)(?:"|')?\s*-\s*(.*)$/);
                if (m) {
                    candidates.push({ name: m[1].trim(), description: m[2].trim() });
                } else if (ln.length > 0) {
                    if (candidates.length < 6) {
                        candidates.push({
                            name: ln.replace(/^[-\d\.\)\s]*/, "").trim(),
                            description: "",
                        });
                    }
                }
            }

            return candidates.slice(0, 6);
        } catch (error) {
            if (options?.signal?.aborted) {
                return [];
            }
            Logger.getInstance().error("generateProjectNames error:", error);
            vscode.window.showErrorMessage("调用 Copilot 生成项目名失败。");
            return [];
        }
    }

    /**
     * 根据文本生成若干 git 分支名候选和简要说明，返回数组 { name, description }
     */
    public static async generateGitBranchNames(
        text: string,
        options?: { signal?: AbortSignal }
    ): Promise<Array<{ name: string; description: string }>> {
        if (!text || text.trim().length === 0) {
            return [];
        }

        const prompt = `请基于下面的文本内容，生成 10 个规范的 git 分支名建议（例如 feature/xxx, fix/xxx, chore/xxx 等），同时为每个分支名提供一句简短的原因说明。仅返回一个 Markdown 格式的 \`\`\`json\n[{"name":"feature/...","description":"..."}, ...]\n\`\`\` 代码块，且不要添加任何其它说明或文本。文本：'''${text}'''`;

        try {
            const fullResp = await LLMService._request(
                [vscode.LanguageModelChatMessage.User(prompt)],
                options
            );
            if (fullResp === null) {
                return [];
            }
            const full = fullResp.text;

            const jsonBlockMatch = full.match(/```json\s*([\s\S]*?)\s*```/i);
            let jsonCandidate = "";
            if (jsonBlockMatch && jsonBlockMatch[1]) {
                jsonCandidate = jsonBlockMatch[1];
            } else {
                const first = full.indexOf("[");
                const last = full.lastIndexOf("]");
                if (first !== -1 && last !== -1 && last > first) {
                    jsonCandidate = full.substring(first, last + 1);
                }
            }

            if (jsonCandidate) {
                try {
                    const parsed = JSON.parse(jsonCandidate);
                    if (Array.isArray(parsed)) {
                        return parsed
                            .map(p => ({
                                name: String(p.name || p.label || p.title || ""),
                                description: String(p.description || ""),
                            }))
                            .filter(p => p.name);
                    }
                } catch (err) {
                    Logger.getInstance().warn(
                        "解析 generateGitBranchNames JSON 失败，回退到文本解析",
                        err
                    );
                }
            }

            const lines = full
                .split(/\r?\n/)
                .map(l => l.trim())
                .filter(Boolean);
            const candidates: Array<{ name: string; description: string }> = [];
            for (const ln of lines) {
                const m = ln.match(/^[-\d\.\)\s]*(?:"|')?(.*?)(?:"|')?\s*-\s*(.*)$/);
                if (m) {
                    candidates.push({ name: m[1].trim(), description: m[2].trim() });
                } else if (ln.length > 0) {
                    if (candidates.length < 6) {
                        candidates.push({
                            name: ln.replace(/^[-\d\.\)\s]*/, "").trim(),
                            description: "",
                        });
                    }
                }
            }

            return candidates.slice(0, 6);
        } catch (error) {
            if (options?.signal?.aborted) {
                return [];
            }
            Logger.getInstance().error("generateGitBranchNames error:", error);
            vscode.window.showErrorMessage("调用 Copilot 生成 Git 分支名失败。");
            return [];
        }
    }

    public static async rewriteContent(
        text: string,
        options?: { signal?: AbortSignal }
    ): Promise<string> {
        if (!text || text.trim().length === 0) {
            return "";
        }

        try {
            const fullResp = await LLMService._request([vscode.LanguageModelChatMessage.User(text)], options);
            if (fullResp === null) {
                return "";
            }
            return fullResp.text;

            // // 清理可能的 ```markdown ``` 包裹
            // const codeBlockMatch = full.match(/```(?:markdown)?\s*([\s\S]*?)\s*```/i);
            // const clean = codeBlockMatch && codeBlockMatch[1] ? codeBlockMatch[1] : full;

            // return clean.trim();
        } catch (error) {
            if (options?.signal?.aborted) {
                return "";
            }
            Logger.getInstance().error("rewriteContent error:", error);
            vscode.window.showErrorMessage("调用 Copilot 改写失败。");
            return "";
        }
    }
}
