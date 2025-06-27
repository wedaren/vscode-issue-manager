import * as vscode from 'vscode';
import { getAllMarkdownIssues } from '../utils/markdown';

export class LLMService {
    public static async getSuggestions(text: string): Promise<{ optimized: string[], similar: { title: string, filePath: string }[] }> {
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
            const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });

            if (!model) {
                vscode.window.showErrorMessage('未找到可用的 Copilot 模型。请确保已安装并登录 GitHub Copilot 扩展。');
                return { optimized: [], similar: [] };
            }

            const response = await model.sendRequest([
                vscode.LanguageModelChatMessage.User(prompt)
            ]);
            const fragments: string[] = [];
            for await (const fragment of response.stream) {
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
            vscode.window.showErrorMessage(`调用 Copilot API 失败: ${error}`);
            console.error('Copilot API error:', error);
            return { optimized: [], similar: [] };
        }
    }
}
