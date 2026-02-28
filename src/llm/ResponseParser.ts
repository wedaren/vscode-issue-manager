import { Logger } from "../core/utils/Logger";

/**
 * 专门处理 LLM 文本响应的解析工具类
 */
export class ResponseParser {
    /**
     * 从生成的 LLM 文本中提取有效的 JSON 字符串，尝试多种策略
     */
    public static extractJson(text: string): string {
        if (!text) return "";

        // 1. 尝试匹配 markdown 中的 ```json 代码块
        const jsonBlockMatch = text.match(/```json\s*([\s\S]*?)\s*```/i);
        if (jsonBlockMatch && jsonBlockMatch[1]) {
            return jsonBlockMatch[1];
        }

        // 2. 尝试提取第一个闭合的大括号或中括号 JSON 结构
        const balanced = this.extractFirstBalancedJson(text);
        if (balanced) {
            return balanced;
        }

        return text;
    }

    /**
     * 自动解析文本为特定的泛型类型，并在失败时记录警告
     */
    public static parseJson<T>(text: string, context: string): T | null {
        const jsonStr = this.extractJson(text);
        if (!jsonStr) return null;

        try {
            return JSON.parse(jsonStr) as T;
        } catch (err) {
            Logger.getInstance().warn(`[ResponseParser] 解析 JSON 失败 (${context}):`, err);
            return null;
        }
    }

    /**
     * 从字符串中提取第一个顶层闭合的 `{...}` 或 `[...]`
     */
    public static extractFirstBalancedJson(s: string): string | null {
        // Find whichever comes first: '{' or '['
        const firstObj = s.indexOf("{");
        const firstArr = s.indexOf("[");

        let first = -1;
        let isArray = false;

        if (firstObj === -1 && firstArr === -1) {
            return null;
        } else if (firstObj !== -1 && firstArr === -1) {
            first = firstObj;
        } else if (firstObj === -1 && firstArr !== -1) {
            first = firstArr;
            isArray = true;
        } else {
            if (firstObj < firstArr) {
                first = firstObj;
            } else {
                first = firstArr;
                isArray = true;
            }
        }

        const openChar = isArray ? "[" : "{";
        const closeChar = isArray ? "]" : "}";
        let depth = 0;

        for (let i = first; i < s.length; i++) {
            const ch = s[i];
            if (ch === openChar) {
                depth++;
            } else if (ch === closeChar) {
                depth--;
            }

            if (depth === 0) {
                return s.substring(first, i + 1);
            }
        }

        return null;
    }

    /**
     * 提取纯文本内容，移除 markdown 代码块包裹（如 ```markdown ... ```）
     */
    public static extractMarkdownBlockOrText(text: string): string {
        if (!text) return "";
        const match = text.match(/```(?:markdown)?\s*([\s\S]*?)\s*```/i);
        if (match && match[1]) {
            return match[1].trim();
        }
        return text.trim();
    }
}
