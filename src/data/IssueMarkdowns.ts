import * as vscode from "vscode";
import * as path from "path";
import * as yaml from "js-yaml";
import * as os from "os";
import { getIssueDir } from "../config";
import { Logger } from "../core/utils/Logger";
import { getRelativeToNoteRoot, resolveIssueUri } from "../utils/pathUtils";
import * as cacheStorage from "../data/issueMarkdownCacheStorage";
/**
 * 从 Markdown 文件内容中提取第一个一级标题。
 * @param content 文件内容。
 * @returns 第一个一级标题的文本，如果找不到则返回 undefined。
 */
function extractTitleFromContent(content: string): string | undefined {
    const match = content.match(/^#\s+(.*)/m);
    return match ? match[1].trim() : undefined;
}

/**
 * Frontmatter 数据结构
 */
export interface FrontmatterData {
    issue_root_file?: string;
    issue_parent_file?: string | null;
    issue_children_files?: string[];
    issue_title?: string[] | string;
    issue_description?: string;
    issue_prompt?: boolean;
    [key: string]: unknown; // 支持其他字段
}

function isValidObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * 从 frontmatter 的 `issue_title` 字段安全提取字符串标题（支持 string 或 string[]）。
 */
export function extractIssueTitleFromFrontmatter(
    fm: FrontmatterData | null | undefined
): string | undefined {
    if (!fm) {
        return undefined;
    }
    const issueTitle = fm.issue_title;
    if (typeof issueTitle === "string" && issueTitle.trim()) {
        return issueTitle.trim();
    }
    if (Array.isArray(issueTitle) && issueTitle.length > 0 && typeof issueTitle[0] === "string") {
        return issueTitle[0].trim();
    }
    return undefined;
}

/**
 * 分离 frontmatter 与正文，返回解析后的 frontmatter（如果存在）和剩余 body 文本。
 */
function extractFrontmatterAndBody(content: string): {
    frontmatter: FrontmatterData | null;
    body: string;
} {
    if (!content.startsWith("---")) {
        return { frontmatter: null, body: content };
    }
    const lines = content.split(/\r?\n/);
    let endIndex = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === "---") {
            endIndex = i;
            break;
        }
    }
    if (endIndex === -1) {
        return { frontmatter: null, body: content };
    }
    const body = lines.slice(endIndex + 1).join("\n");
    const yamlContent = lines.slice(1, endIndex).join("\n");
    try {
        const parsed = yaml.load(yamlContent);
        if (isValidObject(parsed)) {
            return { frontmatter: parsed as FrontmatterData, body };
        }
    } catch (error) {
        Logger.getInstance().warn("解析 frontmatter 失败", error);
    }
    return { frontmatter: null, body };
}

/**
 * 获取问题目录中所有 Markdown 文件;
 * @returns 问题目录中所有 Markdown 文件
 */
async function getAllIssueMarkdownFiles(): Promise<vscode.Uri[]> {
    const issueDir = getIssueDir();
    if (!issueDir) {
        return [];
    }

    const files = await vscode.workspace.findFiles(
        new vscode.RelativePattern(issueDir, "**/*.md"),
        "**/.issueManager/**"
    );
    return files;
}

export type IssueMarkdown = {
    title: string;
    uri: vscode.Uri;
    frontmatter?: FrontmatterData | null;
};

/**
 * 获取问题目录中所有 Markdown 文件的标题和 URI。
 * @returns 包含标题和 URI 的对象数组。
 */
export async function getAllIssueMarkdowns(): Promise<IssueMarkdown[]> {
    const files = await getAllIssueMarkdownFiles();
    const issues: IssueMarkdown[] = [];

    for (const file of files) {
        const title = await getIssueMarkdownTitle(file);
        const frontmatter = await getIssueMarkdownFrontmatter(file);
        issues.push({ title, uri: file, frontmatter });
    }

    return issues;
}

type IssueMarkdownCacheEntry = {
    mtime: number;
    frontmatter?: FrontmatterData | null;
    title?: string;
};

// 统一缓存：同时保存 frontmatter 与 title，基于 mtime 验证有效性
const _issueMarkdownCache = new Map<string, IssueMarkdownCacheEntry>();

// 尝试加载磁盘缓存（不阻塞启动流程）
void (async () => {
    const obj = await cacheStorage.load();
    if (!obj) {
        return;
    }
    for (const [k, v] of Object.entries(obj)) {
        _issueMarkdownCache.set(k, v as IssueMarkdownCacheEntry);
    }
    Logger.getInstance().debug("[IssueMarkdowns] loaded cache from storage", {
        size: _issueMarkdownCache.size,
    });
})();

/** 获取 Markdown 文件的 frontmatter（带简单 mtime 缓存） */
export async function getIssueMarkdownFrontmatter(
    uriOrPath: vscode.Uri | string
): Promise<FrontmatterData | null> {
    const uri = resolveIssueUri(uriOrPath);
    if (!uri) {
        return null;
    }
    const key = uri.toString();
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        const mtime = stat.mtime;
        const cached = _issueMarkdownCache.get(key);
        if (cached && cached.mtime === mtime && cached.frontmatter !== undefined) {
            return cached.frontmatter ?? null;
        }

        const contentBytes = await vscode.workspace.fs.readFile(uri);
        const content = Buffer.from(contentBytes).toString("utf-8");
        const data = extractFrontmatterAndBody(content);
        const entry: IssueMarkdownCacheEntry = {
            mtime,
            frontmatter: data.frontmatter,
        };
        // 如果已有 title 且未改变，可保留
        if (cached?.title) {
            entry.title = cached.title;
        }
        _issueMarkdownCache.set(key, entry);
        cacheStorage.save(Object.fromEntries(_issueMarkdownCache.entries()));
        return data.frontmatter;
    } catch (err) {
        _issueMarkdownCache.delete(key);
        cacheStorage.save(Object.fromEntries(_issueMarkdownCache.entries()));
        return null;
    }
}

/** 
 * 更新 Markdown 文件的 frontmatter（只替换或添加指定字段），并更新缓存。  
 * @param uriOrPath 要更新的文件的 URI 或路径。  
 * @param updates 一个包含要更新的 frontmatter 字段的对象。  
 * @returns 如果更新成功，则返回 true；否则返回 false。  
 */  
export async function updateIssueMarkdownFrontmatter(
    uriOrPath: vscode.Uri | string,
    updates: Partial<FrontmatterData>
): Promise<boolean> {
    const uri = resolveIssueUri(uriOrPath);
    if (!uri) {
        return false;
    }
    const key = uri.toString();
    try {
        const document = await vscode.workspace.openTextDocument(uri);
        const original = document.getText();
        const { frontmatter, body } = extractFrontmatterAndBody(original);

        const fm: FrontmatterData = (frontmatter ? { ...frontmatter } : {}) as FrontmatterData;
        for (const [k, v] of Object.entries(updates)) {
            // @ts-ignore
            fm[k] = v as any;
        }

        const fmYaml = yaml.dump(fm, { flowLevel: -1, lineWidth: -1 }).trim();
        const newContent = `---\n${fmYaml}\n---\n${body}`;

        if (newContent === original) {
            return true;
        }

        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(0, 0, document.lineCount, 0);
        edit.replace(uri, fullRange, newContent);

        const applied = await vscode.workspace.applyEdit(edit);
        if (!applied) {
            return false;
        }

        const doc = await vscode.workspace.openTextDocument(uri);
        if (doc.isDirty) {
            await doc.save();
        }

        // 更新缓存 mtime & frontmatter
        try {
            const stat = await vscode.workspace.fs.stat(uri);
            const mtime = stat.mtime;
            const cached = _issueMarkdownCache.get(key);
            _issueMarkdownCache.set(key, {
                mtime,
                frontmatter: fm,
                title: cached?.title,
            });
            cacheStorage.save(Object.fromEntries(_issueMarkdownCache.entries()));
            scheduleOnDidUpdate();
        } catch (e) {
            // 忽略缓存更新错误
            Logger.getInstance().warn('更新 frontmatter 后更新缓存失败', e);
        }

        return true;
    } catch (err) {
        Logger.getInstance().error('updateIssueMarkdownFrontmatter error:', err);
        return false;
    }
}

/** 从缓存获取标题，若未命中则触发预热 */
export function getIssueMarkdownTitleFromCache(uriOrPath: vscode.Uri | string) {
    const uri = resolveIssueUri(uriOrPath);
    if (!uri) {
        return uriOrPath.toString();
    }
    const key = uri.toString();
    const cached = _issueMarkdownCache.get(key);
    // 触发异步预热，但不等待
    getIssueMarkdownTitle(uri);
    if (cached?.title) {
        return cached.title;
    }
    return fallbackTitle(uri);
}

/** 标题兜底：优先返回相对于笔记根的相对路径，否则返回完整路径 */
function fallbackTitle(uri: vscode.Uri): string {
    return getRelativeToNoteRoot(uri.fsPath) ?? uri.fsPath;
}
/**
 * 从 frontmatter 的 `issue_title` 优先取标题，其次解析 H1，再回退到文件名
 */
export async function getIssueMarkdownTitle(uriOrPath: vscode.Uri | string): Promise<string> {
    const uri = resolveIssueUri(uriOrPath);
    if (!uri) {
        return uriOrPath.toString();
    }

    let title: string | undefined;
    const key = uri.toString();
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        const mtime = stat.mtime;
        const cached = _issueMarkdownCache.get(key);
        if (cached && cached.mtime === mtime && cached.title !== undefined) {
            return cached.title;
        }

        // 1) 优先从 frontmatter 中读取 issue_title

        const fm = await getIssueMarkdownFrontmatter(uri);
        if (fm) {
            // 优先从 frontmatter 的 issue_title 字段获取标题，支持字符串或字符串数组
            title = extractIssueTitleFromFrontmatter(fm);
        }
        if (!title) {
            // 2) 回退到 H1 标题（需要读取文件内容）

            const contentBytes = await vscode.workspace.fs.readFile(uri);
            const content = Buffer.from(contentBytes).toString("utf-8");
            const titleFromContent = extractTitleFromContent(content);
            if (titleFromContent) {
                title = titleFromContent;
            }
        }

        title = title ?? path.basename(uri.fsPath, ".md");
        const prevTitle = cached?.title;
        if (title !== prevTitle) {
            _issueMarkdownCache.set(key, {
                mtime,
                title,
                frontmatter: cached?.frontmatter,
            });
            scheduleOnDidUpdate();
            cacheStorage.save(Object.fromEntries(_issueMarkdownCache.entries()));
            Logger.getInstance().debug("[IssueMarkdowns] get and update title", {
                [key]: title,
            });
        } else if (cached && cached.mtime !== mtime) {
            // 更新 mtime 保持一致
            _issueMarkdownCache.set(key, { ...cached, mtime });
            cacheStorage.save(Object.fromEntries(_issueMarkdownCache.entries()));
        }
    } catch (error) {
        Logger.getInstance().error(`读取文件时出错 ${uri.fsPath}:`, error);
    }
    title = title ?? fallbackTitle(uri);
    return title;
}
const onTitleUpdateEmitter = new vscode.EventEmitter<void>();
let _debounceTimer: ReturnType<typeof setTimeout> | undefined;
const DebounceDelayMillis = 200;

function scheduleOnDidUpdate(): void {
    if (_debounceTimer) {
        clearTimeout(_debounceTimer);
    }
    _debounceTimer = setTimeout(() => {
        try {
            onTitleUpdateEmitter.fire();
        } catch {}
        _debounceTimer = undefined;
    }, DebounceDelayMillis);
}

export const onTitleUpdate = onTitleUpdateEmitter.event;

// -------------------- Prompt management (migrated from src/prompts/PromptManager.ts) --------------------
export interface PromptFile {
    uri: vscode.Uri;
    label: string;
    description?: string;
    template: string;
    systemPrompt?: string;
}

export async function getPromptDir(): Promise<vscode.Uri> {
    const config = vscode.workspace.getConfiguration("issueManager");
    const issueDir = config.get<string>("issueDir") || "";

    if (issueDir && issueDir.trim().length > 0) {
        return vscode.Uri.file(path.join(issueDir, "copilot-prompts"));
    }

    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        return vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, "copilot-prompts");
    }

    return vscode.Uri.file(path.join(os.homedir(), ".copilot-prompts"));
}

export async function getAllPrompts(): Promise<PromptFile[]> {
    const prompts = (await getAllIssueMarkdowns()).filter(m => m.frontmatter?.issue_prompt);
    const res: PromptFile[] = [];
    try {
        for (const { frontmatter, uri } of prompts) {
            const data = await vscode.workspace.fs.readFile(uri);
            const text = Buffer.from(data).toString("utf8");
            const { body } = extractFrontmatterAndBody(text);
            const description = frontmatter?.issue_description;
            res.push({
                uri,
                label: extractIssueTitleFromFrontmatter(frontmatter) ?? fallbackTitle(uri),
                description,
                template: body.trim(),
                systemPrompt: undefined,
            });
        }
    } catch (err) {
        Logger.getInstance().error("加载 prompts 失败", err);
    }
    return res;
}
