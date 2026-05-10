/**
 * 搜索/统计的纯辅助函数。**不依赖 vscode**。
 */

/** type 参数值 → frontmatter 类型索引键的映射 */
export const TYPE_FILTER_MAP: Record<string, string> = {
    role: "chat_role",
    conversation: "chat_conversation",
    log: "chat_execution_log",
    tool_call: "chat_tool_call",
    group: "chat_group",
    memory: "role_memory",
    chrome_chat: "chrome_chat",
};

/** 从 frontmatter 提取文件类型的显示标签 */
export function getTypeTag(fm: Record<string, unknown> | null | undefined): string {
    if (!fm) { return "笔记"; }
    if (fm.board_type === "survey") { return "调查板"; }
    if (fm.chat_role) { return "角色"; }
    if (fm.chat_conversation) { return "对话"; }
    if (fm.chat_execution_log) { return "日志"; }
    if (fm.chat_tool_call) { return "工具调用"; }
    if (fm.chat_group) { return "群组"; }
    if (fm.role_memory) { return "记忆"; }
    if (fm.chrome_chat) { return "浏览器对话"; }
    return "笔记";
}

/** 提取关键词周围的上下文片段 */
export function extractSnippet(text: string, keyword: string, contextChars = 40): string | null {
    const lower = text.toLowerCase();
    const idx = lower.indexOf(keyword.toLowerCase());
    if (idx === -1) { return null; }
    const start = Math.max(0, idx - contextChars);
    const end = Math.min(text.length, idx + keyword.length + contextChars);
    let snippet = text.slice(start, end).replace(/\n+/g, " ").trim();
    if (start > 0) { snippet = "…" + snippet; }
    if (end < text.length) { snippet += "…"; }
    return snippet;
}

/** 计算子串出现次数 */
export function countOccurrences(text: string, sub: string): number {
    if (!sub) { return 0; }
    let count = 0;
    let pos = 0;
    while ((pos = text.indexOf(sub, pos)) !== -1) {
        count++;
        pos += sub.length;
    }
    return count;
}

/** 把 mtime(毫秒)格式化为相对时间描述 */
export function formatAge(mtime: number, now: number = Date.now()): string {
    const diff = now - mtime;
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) { return "刚刚"; }
    if (mins < 60) { return `${mins}分钟前`; }
    const hours = Math.floor(mins / 60);
    if (hours < 24) { return `${hours}小时前`; }
    const days = Math.floor(hours / 24);
    return `${days}天前`;
}

/** 判断 frontmatter 是否带任何系统类型标记(用于"用户笔记"过滤) */
export function isSystemTypedFrontmatter(fm: Record<string, unknown> | null | undefined): boolean {
    if (!fm) { return false; }
    if (fm.board_type === "survey") { return true; }
    return Object.values(TYPE_FILTER_MAP).some(key => fm[key] === true);
}
