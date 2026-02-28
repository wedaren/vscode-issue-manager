import * as vscode from "vscode";
import { Logger } from "../core/utils/Logger";

export class LLMClient {
    // 使用 VS Code LanguageModelChat.sendRequest 并基于 response.text 聚合结果，兼容 Cancellation
    private static async _sendRequestAndAggregate(
        model: vscode.LanguageModelChat,
        messages: vscode.LanguageModelChatMessage[],
        options?: { signal?: AbortSignal }
    ): Promise<string> {
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
    public static async request(
        messages: vscode.LanguageModelChatMessage[],
        options?: { signal?: AbortSignal; modelFamily?: string }
    ): Promise<{ text: string; modelFamily?: string } | null> {
        const logger = Logger.getInstance();
        const startMs = Date.now();
        const promptChars = messages.reduce((s, m) => s + String((m as any).content ?? '').length, 0);
        logger.info(`[LLMClient.request] 开始 | 指定模型=${options?.modelFamily ?? '(VS Code配置)'} | 消息数=${messages.length} | prompt大小=${promptChars}字`);

        if (options?.signal?.aborted) {
            logger.warn('[LLMClient.request] 已取消');
            throw new Error("请求已取消");
        }

        const model = await LLMClient.selectModel(options);
        if (!model) {
            logger.error('[LLMClient.request] 未找到可用模型');
            vscode.window.showErrorMessage(
                "未找到可用的 Copilot 模型。请确保已安装并登录 GitHub Copilot 扩展。"
            );
            return null;
        }

        const modelFamily = (model as any)?.family || (model as any)?.model?.family;
        logger.info(`[LLMClient.request] 选中模型=${modelFamily}`);

        try {
            const text = await LLMClient._sendRequestAndAggregate(model, messages, options);
            logger.info(`[LLMClient.request] 完成 | 模型=${modelFamily} | 响应长度=${text.length}字 | 耗时=${Date.now() - startMs}ms`);
            return { text, modelFamily };
        } catch (e) {
            logger.error(`[LLMClient.request] 失败 | 模型=${modelFamily} | 耗时=${Date.now() - startMs}ms`, e as Error);
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
        return LLMClient.request(messages, options);
    }

    /**
     * 流式调用：对每个接收到的 chunk 调用 onChunk，并返回最终聚合文本与模型信息。
     */
    public static async stream(
        messages: vscode.LanguageModelChatMessage[],
        onChunk: (chunk: string) => void,
        options?: { signal?: AbortSignal; modelFamily?: string }
    ): Promise<{ text: string; modelFamily?: string } | null> {
        const logger = Logger.getInstance();
        const startMs = Date.now();
        const promptChars = messages.reduce((s, m) => s + String((m as any).content ?? '').length, 0);
        logger.info(`[LLMClient.stream] 开始 | 指定模型=${options?.modelFamily ?? '(VS Code配置)'} | 消息数=${messages.length} | prompt大小=${promptChars}字`);

        if (options?.signal?.aborted) {
            logger.warn('[LLMClient.stream] 已取消');
            throw new Error('请求已取消');
        }

        const model = await LLMClient.selectModel(options);
        if (!model) {
            logger.error('[LLMClient.stream] 未找到可用模型');
            vscode.window.showErrorMessage('未找到可用的 Copilot 模型。请确保已安装并登录 GitHub Copilot 扩展。');
            return null;
        }

        const modelFamily = (model as any)?.family || (model as any)?.model?.family;
        logger.info(`[LLMClient.stream] 选中模型=${modelFamily}`);

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

        let full = '';
        let chunkCount = 0;
        try {
            const resp = await model.sendRequest(messages, undefined, cts.token);
            for await (const chunk of resp.text) {
                const s = String(chunk);
                full += s;
                chunkCount++;
                try {
                    onChunk(s);
                } catch (e) {
                    logger.warn('onChunk callback failed', e as Error ?? e);
                }

                if (cts.token.isCancellationRequested) {
                    logger.warn(`[LLMClient.stream] 取消 | 模型=${modelFamily} | 已收到${chunkCount}个chunk`);
                    throw new Error('请求已取消');
                }
            }
        } catch (e) {
            if (!cts.token.isCancellationRequested) {
                logger.error(`[LLMClient.stream] 流式错误 | 模型=${modelFamily} | 耗时=${Date.now() - startMs}ms`, e as Error);
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

        logger.info(`[LLMClient.stream] 完成 | 模型=${modelFamily} | chunks=${chunkCount} | 响应长度=${full.length}字 | 耗时=${Date.now() - startMs}ms`);
        return { text: full, modelFamily };
    }

    public static async selectModel(options?: {
        signal?: AbortSignal;
        modelFamily?: string;
    }): Promise<vscode.LanguageModelChat | undefined> {
        const logger = Logger.getInstance();
        const config = vscode.workspace.getConfiguration("issueManager");
        const configFamily = config.get<string>("llm.modelFamily") || "gpt-4.1";
        const preferredFamily = options?.modelFamily || configFamily;

        logger.info(`[LLMClient.selectModel] 查找模型 | 外部指定=${options?.modelFamily ?? '无'} | VSCode配置=${configFamily} | 实际使用=${preferredFamily}`);

        let models = await vscode.lm.selectChatModels({
            vendor: "copilot",
            family: preferredFamily,
        });

        if (models.length === 0 && options?.modelFamily) {
            logger.warn(`[LLMClient.selectModel] 未找到指定模型 family="${options.modelFamily}"，尝试回落`);
        }

        if (models.length === 0 && preferredFamily !== "gpt-4o") {
            models = await vscode.lm.selectChatModels({ vendor: "copilot", family: "gpt-4o" });
            if (models.length > 0) { logger.info('[LLMClient.selectModel] 回落到 gpt-4o'); }
        }

        if (models.length === 0 && preferredFamily !== "gpt-4.1") {
            models = await vscode.lm.selectChatModels({ vendor: "copilot", family: "gpt-4.1" });
            if (models.length > 0) { logger.info('[LLMClient.selectModel] 回落到 gpt-4.1'); }
        }

        if (models.length === 0) {
            models = await vscode.lm.selectChatModels({ vendor: "copilot" });
            if (models.length > 0) { logger.info(`[LLMClient.selectModel] 回落到任意可用模型: ${(models[0] as any)?.family}`); }
        }

        if (models.length > 0) {
            const chosen = models[0];
            const chosenFamily = (chosen as any)?.family ?? '未知';
            logger.info(`[LLMClient.selectModel] 最终选中: ${chosenFamily}`);
            return chosen;
        }

        logger.error('[LLMClient.selectModel] 未找到任何可用的 Copilot 模型');
        return undefined;
    }
}
