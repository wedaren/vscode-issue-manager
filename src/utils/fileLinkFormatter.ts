/**
 * 文件链接格式化工具
 * 
 * 统一处理文件链接的格式化和解析，支持以下格式：
 * - [[file:/abs/path/to/file.md#L10]]        - 行号（单行）
 * - [[file:/abs/path/to/file.md#L10-L15]]    - 行范围
 * - [[file:/abs/path/to/file.md#L10:4]]      - 行号和列号
 * - [[file:/abs/path/to/file.md#L10:4-L15:8]] - 完整范围（行和列）
 */

/**
 * 位置信息接口
 */
export interface FileLocation {
    /** 文件路径（绝对路径或相对路径） */
    filePath: string;
    /** 起始行号（1-based，可选） */
    startLine?: number;
    /** 起始列号（1-based，可选） */
    startColumn?: number;
    /** 结束行号（1-based，可选） */
    endLine?: number;
    /** 结束列号（1-based，可选） */
    endColumn?: number;
}

/**
 * 格式化文件位置为统一的链接格式
 * 
 * @param location 文件位置信息
 * @returns 格式化的链接字符串，如 [[file:/path/to/file.md#L10:4-L15:8]]
 */
export function formatFileLink(location: FileLocation): string {
    let link = `file:${location.filePath}`;
    
    if (location.startLine !== undefined) {
        let fragment = `#L${location.startLine}`;
        
        // 添加起始列号（如果有）
        if (location.startColumn !== undefined) {
            fragment += `:${location.startColumn}`;
        }
        
        // 添加结束位置（如果有）  
        const isRange = location.endLine !== undefined &&  
            (location.startLine !== location.endLine ||  
            (location.endColumn !== undefined && location.startColumn !== location.endColumn));  

        if (isRange) {  
            fragment += `-L${location.endLine}`;  
            if (location.endColumn !== undefined) {  
                fragment += `:${location.endColumn}`;  
            }  
        }
        
        link += fragment;
    }
    
    return `[[${link}]]`;
}

/**
 * 解析文件链接字符串为位置信息
 * 
 * 支持以下格式：
 * - [[file:/path/to/file.md]]
 * - [[file:/path/to/file.md#L10]]
 * - [[file:/path/to/file.md#L10-L15]]
 * - [[file:/path/to/file.md#L10:4]]
 * - [[file:/path/to/file.md#L10:4-L15:8]]
 * 
 * @param link 链接字符串
 * @returns 解析后的位置信息，如果解析失败返回 null
 */
import * as path from 'path';

export function parseFileLink(link: string, baseIssueDir?: string): FileLocation | null {
    // 去除 [[ ]] 包裹
    const cleaned = link.trim().replace(/^\[\[|\]\]$/g, '');
    
    // 支持三种输入：
    // - 完整的 Markdown 内联链接，如 `[text](path)`
    // - 带前缀的 [[file:...]] / file:... 格式
    // - 直接传入的路径字符串（例如 IssueDir/xxxx.md 或 相对/绝对路径）
    // 优先识别 Markdown 内联链接
    const mdInlineMatch = cleaned.match(/^\[[^\]]+\]\(([^)]+)\)$/);
    let content: string;
    if (mdInlineMatch) {
        content = mdInlineMatch[1].trim();
    } else if (cleaned.startsWith('file:')) {
        // 移除 file: 前缀
        content = cleaned.substring(5);
    } else {
        // 直接将 cleaned 作为路径处理
        content = cleaned;
    }

    // 如果提供了 baseIssueDir，则把以 IssueDir 开头的路径映射到 baseIssueDir
    if (baseIssueDir) {
        const issueDirPrefix = /^IssueDir(?:[\\/]|$)/i;
        if (issueDirPrefix.test(content)) {
            // 将 IssueDir/relative 替换为 baseIssueDir/relative
            const relative = content.replace(/^IssueDir[\\/]{0,1}/i, '');
            content = path.join(baseIssueDir, relative);
        }
    }
    
    // 分离路径和 fragment
    const hashIndex = content.indexOf('#');
    let filePath: string;
    let fragment: string | undefined;
    
    if (hashIndex !== -1) {
        filePath = content.substring(0, hashIndex);
        fragment = content.substring(hashIndex + 1);
    } else {
        filePath = content;
    }
    
    const location: FileLocation = {
        filePath: filePath.trim()
    };
    
    // 解析 fragment（如果存在）
    if (fragment) {
        const parsed = parseFileFragment(fragment);
        if (parsed) {
            if (parsed.startLine !== undefined) location.startLine = parsed.startLine;
            if (parsed.startColumn !== undefined) location.startColumn = parsed.startColumn;
            if (parsed.endLine !== undefined) location.endLine = parsed.endLine;
            if (parsed.endColumn !== undefined) location.endColumn = parsed.endColumn;
        }
    }
    
    return location;
}

/**
 * 解析 fragment（例如 `L10`, `L10:4`, `L10-L15`, `L10:4-L15:8`）为位置对象
 * 返回 null 表示无法解析
 */
export function parseFileFragment(fragment: string): {
    startLine?: number;
    startColumn?: number;
    endLine?: number;
    endColumn?: number;
} | null {
    if (!fragment) return null;

    const rangeMatch = fragment.match(/^L(\d+)(?::(\d+))?(?:-L(\d+)(?::(\d+))?)?$/);
    if (!rangeMatch) return null;

    const parsed: {
        startLine?: number;
        startColumn?: number;
        endLine?: number;
        endColumn?: number;
    } = {};

    parsed.startLine = parseInt(rangeMatch[1], 10);
    if (rangeMatch[2]) parsed.startColumn = parseInt(rangeMatch[2], 10);
    if (rangeMatch[3]) {
        parsed.endLine = parseInt(rangeMatch[3], 10);
        if (rangeMatch[4]) parsed.endColumn = parseInt(rangeMatch[4], 10);
    }

    return parsed;
}

/**
 * 从 VS Code 编辑器选区创建文件位置
 * 
 * @param editor VS Code 编辑器实例
 * @returns 文件位置信息
 */
export function createLocationFromEditor(editor: {
    document: { uri: { fsPath: string } };
    selection: {
        isEmpty: boolean;
        start: { line: number; character: number };
        end: { line: number; character: number };
        active: { line: number; character: number };
    };
}): FileLocation {
    const location: FileLocation = {
        filePath: editor.document.uri.fsPath
    };
    
    if (!editor.selection.isEmpty) {
        // 有选区，记录范围（转换为 1-based）
        location.startLine = editor.selection.start.line + 1;
        location.startColumn = editor.selection.start.character + 1;
        location.endLine = editor.selection.end.line + 1;
        location.endColumn = editor.selection.end.character + 1;
    } else {
        // 无选区，记录光标位置（转换为 1-based）
        location.startLine = editor.selection.active.line + 1;
        location.startColumn = editor.selection.active.character + 1;
    }
    
    return location;
}

/**
 * 验证文件链接格式是否有效
 * 
 * @param link 链接字符串
 * @returns 是否为有效的文件链接格式
 */
export function isValidFileLink(link: string, baseIssueDir?: string): boolean {
    return parseFileLink(link, baseIssueDir) !== null;
}
