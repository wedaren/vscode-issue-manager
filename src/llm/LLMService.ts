import * as vscode from 'vscode';
import { getAllMarkdownIssues } from '../utils/markdown';

export class LLMService {
    public static async getSuggestions(
        text: string,
        options?: { signal?: AbortSignal }
    ): Promise<{ optimized: string[], similar: { title: string, filePath: string }[] }> {
        const allIssues = await getAllMarkdownIssues();

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
${JSON.stringify(allIssues, null, 2)}
`;

        try {
            const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4.1' });

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
            const fragments: string[] = [];
            for await (const fragment of response.stream) {
                if (options?.signal?.aborted) {
                    throw new Error('请求已取消');
                }
                // 确保 fragment 是一个对象并且有 value 属性
                if (typeof fragment === 'object' && fragment !== null && 'value' in fragment) {
                    fragments.push(fragment.value as string);
                } else {
                    // 如果 fragment 不是预期的对象，作为字符串直接添加（以防万一）
                    fragments.push(fragment as string);
                }
            }
            const fullResponse = fragments.join('');

            console.log('LLM Raw Response:', fullResponse); // 打印原始响应

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
            console.error('Copilot API error:', error);
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
            const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4.1' });
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

            const fragments: string[] = [];
            for await (const fragment of response.stream) {
                if (options?.signal?.aborted) {
                    throw new Error('请求已取消');
                }
                if (typeof fragment === 'object' && fragment !== null && 'value' in fragment) {
                    fragments.push(fragment.value as string);
                } else {
                    fragments.push(fragment as string);
                }
            }

            const fullResponse = fragments.join('');
            console.log('LLM generateTitle Raw Response:', fullResponse);

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
                    console.warn('解析 LLM 返回的 JSON 失败，回退到文本解析', err);
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
            console.error('generateTitle error:', error);
            // 不弹过多错误弹窗以免干扰用户，但显示一次性错误
            vscode.window.showErrorMessage('调用 Copilot 自动生成标题失败。');
            return '';
        }
    }
}
