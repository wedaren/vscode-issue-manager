import * as vscode from "vscode";

/**
 * QuickPick 项的扩展类型，支持多种模式的统一处理
 */
export type QuickPickItemWithId = vscode.QuickPickItem & {
    id?: string;
    /**
     * 可选的执行器：在用户确认该项时调用，接收当前输入值和可选上下文
     */
    execute?: (
        input?: string,
        ctx?: { quickPick?: vscode.QuickPick<QuickPickItemWithId> }
    ) => Promise<void> | void;
    /**
     * 可选的通用过滤函数，接收上下文并返回是否应展示该项。
     * ctx = { issueId?: string; uri?: vscode.Uri }
     */
    require?: (ctx: { issueId?: string; uri?: vscode.Uri }) => boolean | Promise<boolean>;
    // LLM 模式相关字段
    template?: string;
    fileUri?: vscode.Uri;
    systemPrompt?: string;
    isCustom?: boolean;
    buttons?: vscode.QuickInputButton[];
};

/**
 * 支持的模式类型
 */
export type Mode = "command" | "issue" | "llm" | "create" | "mtime" | "ctime" | "vtime"| "history";

/**
 * 统一入口接受的初始参数类型
 */
export type InitialArg = { 
    mode?: Mode; 
    text?: string;
};

/**
 * 多词过滤函数：支持空格分词，每个词都要匹配（对中文友好）
 */
export function filterItems(
    items: QuickPickItemWithId[],
    searchText: string
): QuickPickItemWithId[] {
    if (!searchText || !searchText.trim()) {
        return items;
    }
    const keywords = searchText.trim().toLowerCase().split(/\s+/);
    return items.filter(item => {
        const hay = [item.label, item.description || ""]
            .join(" ")
            .toLowerCase();
        return keywords.every(k => hay.includes(k));
    });
}
