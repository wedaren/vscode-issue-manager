/**
 * issue-core 服务层的核心类型,**不依赖 vscode 模块**。
 * 扩展端和独立 MCP server 共用这一份类型。
 */

export interface TermDefinition {
    name: string;
    definition?: string;
    links?: string[];
    [key: string]: unknown;
}

/**
 * Frontmatter 数据结构。
 *
 * 与原 `src/data/IssueMarkdowns.ts` 完全一致;此处作为单一来源,
 * IssueMarkdowns.ts 改为从这里 re-export。
 */
export interface FrontmatterData {
    issue_root_file?: string;
    issue_parent_file?: string | null;
    issue_children_files?: string[];
    /**
     * 与该 issue 关联的外部文件列表(通常为工作文件/笔记)。
     * - 存储为 wiki-link 形式,带 `file:` 前缀,例如: `[[file:notes/foo.md]]` 或 `[[file:/abs/path/to/file.md]]`。
     * - 可选地包含行范围片段,例如 `[[file:notes/foo.md#L10-L12]]` 或 `[[file:/abs/path/to/file.md#L5]]`。
     * - 优先以相对于 `issueDir` 的相对路径存储(例如 `notes/foo.md`),再使用 `file:` 前缀;如果文件不在 `issueDir` 内,则使用绝对路径并加 `file:` 前缀。
     * - 用途:记录该问题关联的工作文件、参考笔记或其它资源,供 UI 展示或自动化脚本使用。
     */
    issue_linked_files?: string[];
    /**
     * 与该 issue 关联的工作区或项目路径(用于快速在新窗口或当前窗口打开工作区)。
     */
    issue_linked_workspace?: string[];
    issue_title?: string[] | string;
    issue_description?: string;
    issue_prompt?: boolean;
    /**
     * 问题的简明摘要(3-5句话),概括核心内容和关键要点。
     */
    issue_brief_summary?: string | string[];
    /** 术语定义列表 */
    terms?: TermDefinition[];
    /** 术语引用的 IssueMarkdown 文件列表(wiki-link 或路径) */
    terms_references?: string[];

    // ── 调查板（Board）字段 ────────────────────────────────────────────
    /** 调查板类型标记，如 'survey' */
    board_type?: string;
    /** 调查板唯一标识 */
    board_id?: string;
    /** 调查板显示名称 */
    board_name?: string;
    /** 画布 X 偏移 */
    board_canvasX?: number;
    /** 画布 Y 偏移 */
    board_canvasY?: number;
    /** 画布缩放比例 */
    board_canvasScale?: number;
    /** 调查板上的条目列表 */
    board_items?: Array<{
        type: 'image' | 'issue';
        id: string;
        filePath: string;
        x: number;
        y: number;
        width: number;
        height: number;
        zIndex: number;
        /** issue 类型条目专有 */
        title?: string;
        /** issue 类型条目专有 */
        excerpt?: string;
    }>;

    [key: string]: unknown;
}

/**
 * Service 层的 issue markdown 表示,使用绝对路径而不是 `vscode.Uri`。
 * 扩展端 adapter 负责把 `absPath` 包装为 `vscode.Uri.file(absPath)`。
 */
export interface IssueMarkdownCore {
    /** 文件的绝对路径(node fs / vscode fs 通用) */
    absPath: string;
    /** 仅文件名(不含目录)。例如 `20260427-220004-278.md` */
    fileName: string;
    /** 标题(从 frontmatter 或正文一级标题中提取,fallback 为文件名) */
    title: string;
    /** frontmatter 解析结果,无 frontmatter 时为 null */
    frontmatter: FrontmatterData | null;
    /** 文件 mtime(毫秒) */
    mtime: number;
    /** 文件 ctime(毫秒,优先从文件名时间戳推断) */
    ctime: number;
}

/**
 * 解析 wiki-link 或文件路径后的中间结果。
 *
 * 注意:服务层的版本只携带字符串路径(`fsPath?: string`),
 * 不再包含 `vscode.Uri`。扩展端如需 Uri 可自行 `vscode.Uri.file(fsPath)`。
 */
export type LinkedFileParseResult = {
    raw: string;
    /** path 部分(去掉 `file:` 前缀和 `#fragment`) */
    linkPath: string;
    /** 解析后的绝对 fs 路径(如果可推断) */
    fsPath?: string;
    lineStart?: number;
    lineEnd?: number;
    colStart?: number;
    colEnd?: number;
};

/**
 * 需要被索引的 frontmatter 布尔标记字段。
 * 扩展端用于构建类型倒排索引;MCP server 一侧也用同一份常量保证语义一致。
 */
export const INDEXED_TYPE_KEYS = [
    'chat_role',
    'chat_conversation',
    'chat_group',
    'chat_group_conversation',
    'chat_execution_log',
    'chat_tool_call',
    'chrome_chat',
    'role_memory',
    'role_auto_memory',
    'chat_plan',
] as const;

export type IndexedTypeKey = typeof INDEXED_TYPE_KEYS[number];

/**
 * Agent 系统自动生成文件的 frontmatter 类型键集合。
 * 这类文件不应触发问题总览刷新或 Git 自动提交(由 Agent 高频写入)。
 * 注意:`chat_role` 为用户手动创建,不在此列。
 */
export const AGENT_FILE_TYPE_KEYS: ReadonlySet<string> = new Set([
    'chat_conversation',
    'chat_group',
    'chat_group_conversation',
    'chat_execution_log',
    'chat_tool_call',
    'chrome_chat',
    'role_memory',
    'role_auto_memory',
    'chat_plan',
]);
