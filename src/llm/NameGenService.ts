import * as vscode from "vscode";
import { Logger } from "../core/utils/Logger";
import { LLMClient } from "./LLMClient";
import { ResponseParser } from "./ResponseParser";

export class NameGenService {
    public static async generateProjectNames(
        text: string,
        options?: { signal?: AbortSignal }
    ): Promise<Array<{ name: string; description: string }>> {
        if (!text || text.trim().length === 0) return [];

        const prompt = `请基于下面的文本内容，生成 10 个适合作为项目名的候选。每个候选的 "name" 必须为驼峰命名（camelCase），仅使用英文单词或短语，不包含中文字符或额外标点；并为每个返回字段 "description"，该字段必须使用中文简要说明（解释为什么选择该名称、该名称与项目的关联或命名原因）。仅返回一个 Markdown 格式的 \`\`\`json\n[{"name":"...","description":"..."}, ...]\n\`\`\` 代码块，且不要添加任何其它说明或文本。文本：'''${text}'''`;

        try {
            const resp = await LLMClient.request([vscode.LanguageModelChatMessage.User(prompt)], options);
            if (!resp) return [];

            const parsed = ResponseParser.parseJson<Array<{ name?: string, label?: string, title?: string, description?: string }>>(resp.text, "generateProjectNames");

            if (parsed && Array.isArray(parsed)) {
                return parsed
                    .map(p => ({
                        name: String(p.name || p.label || p.title || ""),
                        description: String(p.description || "")
                    }))
                    .filter(p => p.name)
                    .slice(0, 6);
            }

            // 回退按行解析
            const lines = resp.text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            const candidates: Array<{ name: string; description: string }> = [];
            for (const ln of lines) {
                const m = ln.match(/^[-\d\.\)\s]*(?:"|')?(.*?)(?:"|')?\s*-\s*(.*)$/);
                if (m) {
                    candidates.push({ name: m[1].trim(), description: m[2].trim() });
                } else if (ln.length > 0 && candidates.length < 6 && !ln.includes("{") && !ln.includes("[")) {
                    candidates.push({ name: ln.replace(/^[-\d\.\)\s]*/, "").trim(), description: "" });
                }
            }

            return candidates.slice(0, 6);
        } catch (error) {
            if (options?.signal?.aborted) return [];
            Logger.getInstance().error("generateProjectNames error:", error);
            vscode.window.showErrorMessage("调用 Copilot 生成项目名失败。");
            return [];
        }
    }

    public static async generateGitBranchNames(
        text: string,
        options?: { signal?: AbortSignal }
    ): Promise<Array<{ name: string; description: string }>> {
        if (!text || text.trim().length === 0) return [];

        const prompt = `请基于下面的文本内容，生成 10 个规范的 git 分支名建议（例如 feature/xxx, fix/xxx, chore/xxx 等），同时为每个分支名提供一句简短的原因说明。仅返回一个 Markdown 格式的 \`\`\`json\n[{"name":"feature/...","description":"..."}, ...]\n\`\`\` 代码块，且不要添加任何其它说明或文本。文本：'''${text}'''`;

        try {
            const resp = await LLMClient.request([vscode.LanguageModelChatMessage.User(prompt)], options);
            if (!resp) return [];

            const parsed = ResponseParser.parseJson<Array<{ name?: string, label?: string, title?: string, description?: string }>>(resp.text, "generateGitBranchNames");

            if (parsed && Array.isArray(parsed)) {
                return parsed
                    .map(p => ({
                        name: String(p.name || p.label || p.title || ""),
                        description: String(p.description || "")
                    }))
                    .filter(p => p.name)
                    .slice(0, 6);
            }

            // 回退按行解析
            const lines = resp.text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            const candidates: Array<{ name: string; description: string }> = [];
            for (const ln of lines) {
                const m = ln.match(/^[-\d\.\)\s]*(?:"|')?(.*?)(?:"|')?\s*-\s*(.*)$/);
                if (m) {
                    candidates.push({ name: m[1].trim(), description: m[2].trim() });
                } else if (ln.length > 0 && candidates.length < 6 && !ln.includes("{") && !ln.includes("[")) {
                    candidates.push({ name: ln.replace(/^[-\d\.\)\s]*/, "").trim(), description: "" });
                }
            }

            return candidates.slice(0, 6);
        } catch (error) {
            if (options?.signal?.aborted) return [];
            Logger.getInstance().error("generateGitBranchNames error:", error);
            vscode.window.showErrorMessage("调用 Copilot 生成 Git 分支名失败。");
            return [];
        }
    }
}
