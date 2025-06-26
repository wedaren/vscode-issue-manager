import * as vscode from 'vscode';
import { getAllMarkdownIssues } from '../utils/markdown';

export class LLMService {
    public static async getSuggestions(text: string): Promise<{ optimized: string[], similar: { title: string, filePath: string }[] }> {
        // Simulate LLM API call with a delay
        await new Promise(resolve => setTimeout(resolve, 1000)); // 模拟网络延迟

        const allIssues = await getAllMarkdownIssues();

        // Simulate LLM response based on the input text and available issues
        // In a real scenario, the LLM would analyze 'text' and 'allIssues'
        // to generate optimized phrases and identify truly similar issues.
        const optimizedSuggestions = [
            `优化建议: ${text} - 版本A`,
            `优化建议: ${text} - 版本B`,
            `优化建议: ${text} - 版本C`,
        ];

        // Simulate finding similar issues (e.g., by simple text matching or a more complex LLM logic)
        const similarIssues = allIssues.filter(issue => 
            issue.title.toLowerCase().includes(text.toLowerCase())
        ).slice(0, 5); // 限制最多5个相似笔记

        return {
            optimized: optimizedSuggestions,
            similar: similarIssues
        };
    }
}
