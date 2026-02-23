import * as vscode from "vscode";
import { Logger } from "../core/utils/Logger";
import { LLMClient } from "./LLMClient";
import { ResponseParser } from "./ResponseParser";
import { getAllIssueMarkdowns } from "../data/IssueMarkdowns";

export class SearchService {
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
    }
  ]
}

用户问题描述: "${text}"

现有笔记列表（标题和文件路径）：
${JSON.stringify(allIssues.map(i => ({ title: i.title, filePath: i.uri.fsPath })), null, 2)}
`;

        try {
            const resp = await LLMClient.request([vscode.LanguageModelChatMessage.User(prompt)], options);
            if (!resp) return { optimized: [], similar: [] };

            const parsed = ResponseParser.parseJson<{ optimized: string[], similar: { title: string, filePath: string }[] }>(resp.text, "getSuggestions");
            if (parsed) {
                return {
                    optimized: Array.isArray(parsed.optimized) ? parsed.optimized : [],
                    similar: Array.isArray(parsed.similar) ? parsed.similar : []
                };
            }

            return { optimized: [], similar: [] };
        } catch (error) {
            if (options?.signal?.aborted) return { optimized: [], similar: [] };
            vscode.window.showErrorMessage(`调用 Copilot API 失败: ${error}`);
            Logger.getInstance().error("Copilot API error:", error);
            return { optimized: [], similar: [] };
        }
    }

    public static async searchIssueMarkdowns(
        query: string,
        options?: { signal?: AbortSignal }
    ): Promise<{ filePath: string; title?: string }[]> {
        const trimmed = (query || "").trim();
        if (!trimmed) return [];

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
${JSON.stringify(allIssues.map(i => ({ title: i.title, filePath: i.uri.fsPath })), null, 2)}
`;

        try {
            const resp = await LLMClient.request([vscode.LanguageModelChatMessage.User(prompt)], options);
            if (!resp) return [];

            const parsed = ResponseParser.parseJson<{ matches: { filePath: string, title?: string }[] }>(resp.text, "searchIssueMarkdowns");
            if (parsed && Array.isArray(parsed.matches)) {
                return parsed.matches
                    .filter(item => item && typeof item.filePath === "string")
                    .map(item => ({
                        filePath: item.filePath,
                        title: typeof item.title === "string" ? item.title : undefined
                    }));
            }

            return [];
        } catch (error) {
            if (options?.signal?.aborted) return [];
            Logger.getInstance().error("LLM searchIssueMarkdowns error:", error);
            return [];
        }
    }
}
