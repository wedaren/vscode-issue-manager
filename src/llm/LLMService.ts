import * as vscode from 'vscode';
import { getAllIssueMarkdowns } from '../data/IssueMarkdowns';
import { Logger } from '../core/utils/Logger';

export class LLMService {
    private static async _aggregateStream(stream: AsyncIterable<unknown>, signal?: AbortSignal): Promise<string> {
        const fragments: string[] = [];
        for await (const fragment of stream) {
            if (signal?.aborted) {
                throw new Error('请求已取消');
            }
            if (typeof fragment === 'object' && fragment !== null && 'value' in fragment) {
                fragments.push(String((fragment as { value: unknown }).value));
            } else {
                fragments.push(String(fragment));
            }
        }
        return fragments.join('');
    }

    private static async selectModel(options?: { signal?: AbortSignal }): Promise<vscode.LanguageModelChat | undefined> {
        const config = vscode.workspace.getConfiguration('issueManager');
        const preferredFamily = config.get<string>('llm.modelFamily') || 'gpt-4.1';

        // 1. 尝试使用配置的模型
        let models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: preferredFamily });
        
        // 2. 如果没找到，尝试使用 gpt-4o (通常更强)
        if (models.length === 0 && preferredFamily !== 'gpt-4o') {
            models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
        }

        // 3. 如果还没找到，尝试使用 gpt-4.1
        if (models.length === 0 && preferredFamily !== 'gpt-4.1') {
            models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4.1' });
        }

        // 4. 如果还没找到，尝试任意 Copilot 模型
        if (models.length === 0) {
            models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
        }

        if (models.length > 0) {
            return models[0];
        }
        
        return undefined;
    }

    public static async getSuggestions(
        text: string,
        options?: { signal?: AbortSignal }
    ): Promise<{ optimized: string[], similar: { title: string, filePath: string }[] }> {
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
${JSON.stringify(allIssues.map(i=>({ title: i.title, filePath: i.uri.fsPath })), null, 2)}
`;

        try {
            const model = await this.selectModel(options);

            if (!model) {
                vscode.window.showErrorMessage('未找到可用的 Copilot 模型。请确保已安装并登录 GitHub Copilot 扩展。');
                return { optimized: [], similar: [] };
            }

            // 支持取消：如果 options.signal 被触发则抛出异常
            if (options?.signal?.aborted) {
                throw new Error('请求已取消');
            }
            // sendRequest 不传 signal，改为仅在循环中判断
            const response = await model.sendRequest([
                vscode.LanguageModelChatMessage.User(prompt)
            ]);
            const fullResponse = await this._aggregateStream(response.stream, options?.signal);

            Logger.getInstance().info('LLM Raw Response:', fullResponse); // 打印原始响应

            // 尝试从响应中提取 JSON 部分
            const jsonMatch = fullResponse.match(/```json\n([\s\S]*?)\n```/);
            let jsonString = fullResponse;

            if (jsonMatch && jsonMatch[1]) {
                jsonString = jsonMatch[1];
            } else {
                // 如果没有找到 ```json``` 块，尝试直接解析，但要确保它以 { 开头
                const firstBrace = fullResponse.indexOf('{');
                const lastBrace = fullResponse.lastIndexOf('}');
                if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                    jsonString = fullResponse.substring(firstBrace, lastBrace + 1);
                }
            }

            // 尝试解析 JSON
            const parsedResponse = JSON.parse(jsonString);

            return {
                optimized: parsedResponse.optimized || [],
                similar: parsedResponse.similar || []
            };
        } catch (error) {
            if (options?.signal?.aborted) {
                // 被主动取消时静默返回空
                return { optimized: [], similar: [] };
            }
            vscode.window.showErrorMessage(`调用 Copilot API 失败: ${error}`);
            Logger.getInstance().error('Copilot API error:', error);
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
        if (!text || text.trim().length === 0) { return ''; }

    const prompt = `请为以下文本生成一个简洁、精确的 Markdown 一级标题。仅返回 JSON 格式，内容如下：{ "title": "生成的标题文本" }。不要添加任何额外说明或标记。文本内容：『${text}』`;

        try {
            const model = await this.selectModel(options);
            if (!model) {
                vscode.window.showErrorMessage('未找到可用的 Copilot 模型，无法自动生成标题。');
                return '';
            }

            if (options?.signal?.aborted) {
                throw new Error('请求已取消');
            }

            const response = await model.sendRequest([
                vscode.LanguageModelChatMessage.User(prompt)
            ]);
            const fullResponse = await this._aggregateStream(response.stream, options?.signal);
            Logger.getInstance().info('LLM generateTitle Raw Response:', fullResponse);

            // 1) 优先尝试提取 ```json``` 区块中的 JSON
            const jsonBlockMatch = fullResponse.match(/```json\s*([\s\S]*?)\s*```/i);
            let jsonCandidate = '';
            if (jsonBlockMatch && jsonBlockMatch[1]) {
                jsonCandidate = jsonBlockMatch[1];
            } else {
                // 2) 尝试提取页面中第一个完整的 JSON 对象（匹配最外层的 {...}）
                const firstBrace = fullResponse.indexOf('{');
                const lastBrace = fullResponse.lastIndexOf('}');
                if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                    jsonCandidate = fullResponse.substring(firstBrace, lastBrace + 1);
                }
            }

            if (jsonCandidate) {
                try {
                    const parsed = JSON.parse(jsonCandidate);
                    if (parsed && typeof parsed.title === 'string' && parsed.title.trim().length > 0) {
                        return parsed.title.trim();
                    }
                } catch (err) {
                    Logger.getInstance().warn('解析 LLM 返回的 JSON 失败，回退到文本解析', err);
                    // 继续进行文本解析
                }
            }

            // 回退：从纯文本中提取第一行非空文本并清洗 Markdown 前缀
            const lines = fullResponse.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            if (lines.length > 0) {
                const first = lines[0].replace(/^#+\s*/, '').trim();
                return first;
            }

            return '';
        } catch (error) {
            if (options?.signal?.aborted) {
                return '';
            }
            Logger.getInstance().error('generateTitle error:', error);
            // 不弹过多错误弹窗以免干扰用户，但显示一次性错误
            vscode.window.showErrorMessage('调用 Copilot 自动生成标题失败。');
            return '';
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
    ): Promise<{ title: string, content: string, modelFamily?: string }> {
        if (!prompt || prompt.trim().length === 0) { 
            return { title: '', content: '' }; 
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
            const model = await this.selectModel(options);
            if (!model) {
                vscode.window.showErrorMessage('未找到可用的 Copilot 模型。');
                return { title: '', content: '' };
            }

            if (options?.signal?.aborted) {
                throw new Error('请求已取消');
            }

            const response = await model.sendRequest([
                vscode.LanguageModelChatMessage.User(systemPrompt),
                vscode.LanguageModelChatMessage.User(`用户主题：${prompt}`)
            ]);

            const fullResponse = await this._aggregateStream(response.stream, options?.signal);
            Logger.getInstance().debug('LLM generateDocument Raw Response:', fullResponse);

            // 清理可能存在的 Markdown 代码块标记
            let cleanContent = fullResponse;
            const codeBlockMatch = fullResponse.match(/^```markdown\s*([\s\S]*?)\s*```$/i) || fullResponse.match(/^```\s*([\s\S]*?)\s*```$/i);
            if (codeBlockMatch && codeBlockMatch[1]) {
                cleanContent = codeBlockMatch[1];
            }

            // 提取标题和内容
            const lines = cleanContent.split('\n');
            let title = '未命名文档';
            let content = cleanContent;
            
            // 查找第一个非空行作为标题
            const firstLineIndex = lines.findIndex(l => l.trim().length > 0);
            if (firstLineIndex !== -1) {
                const firstLine = lines[firstLineIndex].trim();
                if (firstLine.startsWith('# ')) {
                    title = firstLine.replace(/^#\s+/, '').trim();
                    // 如果第一行是标题，内容可以保留原样，或者去掉标题行（取决于需求，通常保留标题在文档中更好）
                    // 这里我们保留完整内容，因为 createIssueFile 可能会使用 content 作为文件内容
                } else {
                    // 如果第一行不是 # 开头，尝试把它当做标题
                    title = firstLine.replace(/^#+\s*/, '').trim();
                }
            }

            return { title, content, modelFamily: model.family };

        } catch (error) {
            if (options?.signal?.aborted) {
                return { title: '', content: '' };
            }
            Logger.getInstance().error('generateDocument error:', error);
            throw error; // 重新抛出异常  
        }
    }

    public static async rewriteContent(
        text: string,
        options?: { signal?: AbortSignal; }
    ): Promise<string> {
        if (!text || text.trim().length === 0) { return ''; }

        try {
            const model = await this.selectModel(options);
            if (!model) {
                vscode.window.showErrorMessage('未找到可用的 Copilot 模型。');
                return '';
            }

            if (options?.signal?.aborted) {
                throw new Error('请求已取消');
            }

            const response = await model.sendRequest([
                vscode.LanguageModelChatMessage.User(text)
            ]);

            const full = await this._aggregateStream(response.stream, options?.signal);

            // 清理可能的 ```markdown ``` 包裹
            const codeBlockMatch = full.match(/```(?:markdown)?\s*([\s\S]*?)\s*```/i);
            const clean = codeBlockMatch && codeBlockMatch[1] ? codeBlockMatch[1] : full;

            return clean.trim();
        } catch (error) {
            if (options?.signal?.aborted) {
                return '';
            }
            Logger.getInstance().error('rewriteContent error:', error);
            vscode.window.showErrorMessage('调用 Copilot 改写失败。');
            return '';
        }
    }
}
