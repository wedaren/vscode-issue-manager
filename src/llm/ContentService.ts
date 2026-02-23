import * as vscode from "vscode";
import { Logger } from "../core/utils/Logger";
import { LLMClient } from "./LLMClient";
import { ResponseParser } from "./ResponseParser";

export class ContentService {
    /**
     * 根据输入文本生成一个简洁精确的 Markdown 一级标题。
     */
    public static async generateTitleOptimized(
        text: string,
        options?: { signal?: AbortSignal }
    ): Promise<string> {
        if (!text || text.trim().length === 0) return "";

        const MAX_CHARS = 64000;
        let sentText = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
        const truncated = text.length > MAX_CHARS;

        const promptLines = [
            "请为下面的 Markdown 文本生成一个简洁、精确的一行标题（适合作为 Markdown 一级标题，去掉任何前导的 `#`）。",
            '仅返回一个 JSON 对象，格式为：{ "title": "生成的标题文本" }。不要添加其它说明、注释或代码块标签。'
        ];
        if (truncated) {
            promptLines.push("(注意：输入已被截断，只包含文件的前部分，因此请基于可见内容生成简洁标题，并尽量保持通用性)");
        }
        promptLines.push("原文如下：\n---\n" + sentText + "\n---");

        try {
            const resp = await LLMClient.request([vscode.LanguageModelChatMessage.User(promptLines.join("\n"))], options);
            if (!resp) return "";

            const jsonCandidate = ResponseParser.extractJson(resp.text);
            if (jsonCandidate) {
                try {
                    const parsed = JSON.parse(jsonCandidate) as { title?: string };
                    if (parsed.title?.trim()) {
                        return parsed.title.trim();
                    }
                } catch (err) {
                    Logger.getInstance().warn("解析 generateTitle JSON 失败", err);
                }
            }

            // 回退
            const titleMatch = resp.text.match(/"title"\s*:\s*"([^"]{1,200})"/i) || resp.text.match(/'title'\s*:\s*'([^']{1,200})'/i);
            if (titleMatch && titleMatch[1]) return titleMatch[1].trim();

            const lines = resp.text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            if (lines.length > 0) return lines[0].replace(/^#+\s*/, "").trim();

            return "";
        } catch (error) {
            if (options?.signal?.aborted) return "";
            Logger.getInstance().error("generateTitleOptimized error:", error);
            vscode.window.showErrorMessage("调用 Copilot 自动生成标题失败。");
            return "";
        }
    }

    /**
     * 根据输入文本生成一个简明的摘要（3-5句话）。
     */
    public static async generateBriefSummary(
        text: string,
        options?: { signal?: AbortSignal }
    ): Promise<string> {
        if (!text || text.trim().length === 0) return "";

        const MAX_CHARS = 64000;
        let sentText = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
        const truncated = text.length > MAX_CHARS;

        const promptLines = [
            "请为下面的 Markdown 文本生成一个简明的摘要（3-5句话），概括其核心内容和关键要点。",
            '仅返回一个 JSON 对象，格式为：{ "summary": "生成的摘要文本" }。不要添加其它说明、注释或代码块标签。'
        ];
        if (truncated) {
            promptLines.push("(注意：输入已被截断，只包含文件的前部分，请基于可见内容生成简明摘要)");
        }
        promptLines.push("原文如下：\n---\n" + sentText + "\n---");

        try {
            const resp = await LLMClient.request([vscode.LanguageModelChatMessage.User(promptLines.join("\n"))], options);
            if (!resp) return "";

            const jsonCandidate = ResponseParser.extractJson(resp.text);
            if (jsonCandidate) {
                try {
                    const parsed = JSON.parse(jsonCandidate) as { summary?: string };
                    if (parsed.summary?.trim()) {
                        return parsed.summary.trim();
                    }
                } catch (err) {
                    Logger.getInstance().warn("解析 generateBriefSummary JSON 失败", err);
                }
            }

            const summaryMatch = resp.text.match(/"summary"\s*:\s*"([^"]{1,500})"/i) || resp.text.match(/'summary'\s*:\s*'([^']{1,500})'/i);
            if (summaryMatch && summaryMatch[1]) return summaryMatch[1].trim();

            const paragraphs = resp.text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
            if (paragraphs.length > 0) return paragraphs[0].substring(0, 500).trim();

            return "";
        } catch (error) {
            if (options?.signal?.aborted) return "";
            Logger.getInstance().error("generateBriefSummary error:", error);
            vscode.window.showErrorMessage("调用 Copilot 自动生成摘要失败。");
            return "";
        }
    }

    /**
     * 翻译给定文本到目标语言。
     */
    public static async translate(
        text: string,
        targetLang: string,
        options?: { signal?: AbortSignal }
    ): Promise<string> {
        if (!text || text.trim().length === 0) return "";

        const MAX_CHARS = 200000;
        let sentText = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
        const truncated = text.length > MAX_CHARS;

        const promptLines = [
            `请将下面的 Markdown 文本翻译为 ${targetLang}，保持专有名词、术语与人名不被不必要地翻译，保持原有的 Markdown 结构（标题、代码块、列表等）。`,
            "仅返回翻译后的 Markdown 正文，不要包含额外说明、步骤或标记。"
        ];
        if (truncated) promptLines.push("(注意：原文已被截断，仅提供部分内容，请尽量基于可见内容进行连贯翻译)");
        promptLines.push("原文如下：\n---\n" + sentText + "\n---");

        try {
            const resp = await LLMClient.request([vscode.LanguageModelChatMessage.User(promptLines.join("\n"))], options);
            if (!resp) return "";

            return ResponseParser.extractMarkdownBlockOrText(resp.text);
        } catch (error) {
            if (options?.signal?.aborted) return "";
            Logger.getInstance().error("translate error:", error);
            vscode.window.showErrorMessage("调用 Copilot 翻译失败。");
            return "";
        }
    }

    public static async generateDocument(
        prompt: string,
        options?: { signal?: AbortSignal }
    ): Promise<{ title: string; content: string; modelFamily?: string }> {
        if (!prompt || prompt.trim().length === 0) return { title: "", content: "" };

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
            const resp = await LLMClient.request([
                vscode.LanguageModelChatMessage.User(systemPrompt),
                vscode.LanguageModelChatMessage.User(`用户主题：${prompt}`)
            ], options);
            if (!resp) return { title: "", content: "" };

            let cleanContent = ResponseParser.extractMarkdownBlockOrText(resp.text);

            const lines = cleanContent.split("\n");
            let title = "未命名文档";
            let content = cleanContent;

            const firstLineIndex = lines.findIndex(l => l.trim().length > 0);
            if (firstLineIndex !== -1) {
                const firstLine = lines[firstLineIndex].trim();
                if (firstLine.startsWith("# ")) {
                    title = firstLine.replace(/^#\s+/, "").trim();
                } else {
                    title = firstLine.replace(/^#+\s*/, "").trim();
                }
            }

            return { title, content, modelFamily: resp.modelFamily };
        } catch (error) {
            if (options?.signal?.aborted) return { title: "", content: "" };
            Logger.getInstance().error("generateDocument error:", error);
            throw error;
        }
    }

    public static async rewriteContent(
        text: string,
        options?: { signal?: AbortSignal }
    ): Promise<string> {
        if (!text || text.trim().length === 0) return "";
        try {
            const resp = await LLMClient.request([vscode.LanguageModelChatMessage.User(text)], options);
            return resp ? resp.text : "";
        } catch (error) {
            if (options?.signal?.aborted) return "";
            Logger.getInstance().error("rewriteContent error:", error);
            vscode.window.showErrorMessage("调用 Copilot 改写失败。");
            return "";
        }
    }
}
