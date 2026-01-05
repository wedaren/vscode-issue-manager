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
    private static async _request(
        messages: vscode.LanguageModelChatMessage[],
        options?: { signal?: AbortSignal }
    ): Promise<string | null> {
        if (options?.signal?.aborted) {
            throw new Error("请求已取消");
        }

        const model = await this.selectModel(options);
        if (!model) {
            vscode.window.showErrorMessage(
                "未找到可用的 Copilot 模型。请确保已安装并登录 GitHub Copilot 扩展。"
            );
            return null;
        }

        return await this._sendRequestAndAggregate(model, messages, options);
    }

    private static async selectModel(options?: {
        signal?: AbortSignal;
    }): Promise<vscode.LanguageModelChat | undefined> {
        const config = vscode.workspace.getConfiguration("issueManager");
        const preferredFamily = config.get<string>("llm.modelFamily") || "gpt-4.1";

        // 1. 尝试使用配置的模型
        let models = await vscode.lm.selectChatModels({
            vendor: "copilot",
            family: preferredFamily,
        });

        // 2. 如果没找到，尝试使用 gpt-4o (通常更强)
        if (models.length === 0 && preferredFamily !== "gpt-4o") {
            models = await vscode.lm.selectChatModels({ vendor: "copilot", family: "gpt-4o" });
        }

        // 3. 如果还没找到，尝试使用 gpt-4.1
        if (models.length === 0 && preferredFamily !== "gpt-4.1") {
            models = await vscode.lm.selectChatModels({ vendor: "copilot", family: "gpt-4.1" });
        }

        // 4. 如果还没找到，尝试任意 Copilot 模型
        if (models.length === 0) {
            models = await vscode.lm.selectChatModels({ vendor: "copilot" });
        }

        if (models.length > 0) {
            return models[0];
        }

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
            const fullResponse = await this._request(
                [vscode.LanguageModelChatMessage.User(prompt)],
                options
            );
            if (fullResponse === null) {
                return { optimized: [], similar: [] };
            }

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
            const fullResponse = await this._request(
                [vscode.LanguageModelChatMessage.User(prompt)],
                options
            );
            if (fullResponse === null) {
                return "";
            }
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
            const full = await this._request(
                [vscode.LanguageModelChatMessage.User(prompt)],
                options
            );
            if (full === null) {
                return "";
            }
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
7. 如果是技术问题，请提供代码示例或具体步骤。
`;

        try {
            const fullResponse = await this._request(
                [
                    vscode.LanguageModelChatMessage.User(systemPrompt),
                    vscode.LanguageModelChatMessage.User(`用户主题：${prompt}`),
                ],
                options
            );
            if (fullResponse === null) {
                return { title: "", content: "" };
            }
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

            return { title, content, modelFamily: `TODO:model.family` };
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
            const full = await this._request(
                [vscode.LanguageModelChatMessage.User(prompt)],
                options
            );
            if (full === null) {
                return [];
            }

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

        const prompt = `请基于下面的文本内容，生成 10 个规范的 git 分支名建议（例如 feature/xxx, fix/xxx, chore/xxx 等），同时为每个分支名提供一句简短的原因说明。仅返回一个 Markdown 格式的 \`\`\`json\n[{{"name":"feature/...","description":"..."}}, ...]\n\`\`\` 代码块，且不要添加任何其它说明或文本。文本：'''${text}'''`;

        try {
            const full = await this._request(
                [vscode.LanguageModelChatMessage.User(prompt)],
                options
            );
            if (full === null) {
                return [];
            }

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
            const full = await this._request([vscode.LanguageModelChatMessage.User(text)], options);
            if (full === null) {
                return "";
            }

            // 清理可能的 ```markdown ``` 包裹
            const codeBlockMatch = full.match(/```(?:markdown)?\s*([\s\S]*?)\s*```/i);
            const clean = codeBlockMatch && codeBlockMatch[1] ? codeBlockMatch[1] : full;

            return clean.trim();
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
