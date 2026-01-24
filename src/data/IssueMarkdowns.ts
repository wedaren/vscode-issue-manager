import * as vscode from "vscode";
import * as path from "path";
import * as yaml from "js-yaml";
import * as os from "os";
import { getIssueDir } from "../config";
import { Logger } from "../core/utils/Logger";
import { getRelativeToNoteRoot, resolveIssueUri } from "../utils/pathUtils";
import * as cacheStorage from "../data/issueMarkdownCacheStorage";
import { generateFileName, getTimestampFromFileName } from "../utils/fileUtils";
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
    /**
     * 与该 issue 关联的外部文件列表（通常为工作文件/笔记）。
     * - 存储为 wiki-link 形式，带 `file:` 前缀，例如: `[[file:notes/foo.md]]` 或 `[[file:/abs/path/to/file.md]]`。
     * - 可选地包含行范围片段，例如 `[[file:notes/foo.md#L10-L12]]` 或 `[[file:/abs/path/to/file.md#L5]]`。
     * - 优先以相对于 `issueDir` 的相对路径存储（例如 `notes/foo.md`），再使用 `file:` 前缀；如果文件不在 `issueDir` 内，则使用绝对路径并加 `file:` 前缀。
     * - 用途：记录该问题关联的工作文件、参考笔记或其它资源，供 UI 展示或自动化脚本使用。
     */
    issue_linked_files?: string[];
    /**
     * 与该 issue 关联的工作区或项目路径（用于快速在新窗口或当前窗口打开工作区）。
     * - 存储为 `file:` 前缀的路径或 workspace 文件路径，例如 `file:/Users/me/project` 或 `/path/to/project.code-workspace`。
     * - 建议存储相对路径或绝对路径，UI 会将其渲染为可点击的 `[[workspace:...]]` 链接。
     */
    issue_linked_workspace?: string[];
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

export async function getIssueMarkdownContent(uri: vscode.Uri): Promise<string> {
    const contentBytes = await vscode.workspace.fs.readFile(uri);
    const data = Buffer.from(contentBytes)
        .toString("utf-8")
        .replace(/^---\s*[\s\S]*?---\s*/, "");
    return data;
}

export type IssueMarkdown = {
    title: string;
    uri: vscode.Uri;
    frontmatter?: FrontmatterData | null;
    // 文件的修改时间与创建时间（来自 vscode.workspace.fs.stat）
    mtime: number;
    ctime: number;
};

/**
 * 类型守卫：判断对象是否为 IssueMarkdown
 * 目的：避免在多个文件中重复实现相同的检查逻辑
 */
export function isIssueMarkdown(item: unknown): item is IssueMarkdown {
    return !!item && typeof item === "object" && "title" in item && "uri" in item;
}

export async function getIssueMarkdown(
    uriOrPath: vscode.Uri | string
): Promise<IssueMarkdown | null> {
    const uri = resolveIssueUri(uriOrPath);

    if (!uri || !isIssueMarkdownFile(uri)) {
        return null;
    }

    const key = uri.fsPath;
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        const mtime = stat.mtime;
        const fileName = path.basename(uri.fsPath);
        const ctime = getTimestampFromFileName(fileName) || stat.ctime;
        const cached = _issueMarkdownCache.get(key);
        if (
            cached &&
            cached.mtime === mtime &&
            (cached.title !== undefined || cached.frontmatter !== undefined)
        ) {
            return {
                title: cached.title ?? fallbackTitle(uri),
                uri,
                frontmatter: cached.frontmatter ?? null,
                mtime: cached.mtime,
                ctime,
            };
        }

        const contentBytes = await vscode.workspace.fs.readFile(uri);
        const content = Buffer.from(contentBytes).toString("utf-8");
        const { frontmatter, body } = extractFrontmatterAndBody(content);

        let title: string | undefined;
        if (frontmatter) {
            title = extractIssueTitleFromFrontmatter(frontmatter);
        }
        if (!title) {
            const titleFromContent = extractTitleFromContent(body);
            if (titleFromContent) title = titleFromContent;
        }
        title = title ?? path.basename(uri.fsPath, ".md");

        const entry: cacheStorage.IssueMarkdownCacheEntry = {
            mtime,
            ctime,
            frontmatter: frontmatter ?? null,
            title,
        };
        _issueMarkdownCache.set(key, entry);
        scheduleOnDidUpdate();
        cacheStorage.save(Object.fromEntries(_issueMarkdownCache.entries()));

        return { title, uri, frontmatter: frontmatter ?? null, mtime, ctime };
    } catch (err) {
        _issueMarkdownCache.delete(key);
        cacheStorage.save(Object.fromEntries(_issueMarkdownCache.entries()));
        return null;
    }
}

/**
 * 获取问题目录中所有 Markdown 文件的标题和 URI（并行加载）。
 * - 默认按文件修改时间 `mtime` 降序（最近更新的排在前面）；可通过 `sortBy: "ctime"` 改为按创建时间降序。
 * - 参数：`{ sortBy?: "mtime" | "ctime" }`，默认 `{ sortBy: "mtime" }`。
 */
export async function getAllIssueMarkdowns(
    { sortBy = "mtime" }: { sortBy?: "mtime" | "ctime" } = {}
): Promise<IssueMarkdown[]> {
    const issueDir = getIssueDir();
    if (!issueDir) return [];

    // 仅获取 issueDir 根目录下的 Markdown 文件（非递归）
    const files = await vscode.workspace.findFiles(
        new vscode.RelativePattern(issueDir, "*.md"),
        "**/.issueManager/**"
    );

    // 并行加载所有文件的元信息，单个文件出错时忽略
    const entries = await Promise.all(
        files.map(async f => {
            try {
                return await getIssueMarkdown(f);
            } catch {
                return null;
            }
        })
    );

    const issues = entries.filter((e): e is IssueMarkdown => !!e);

    return issues.sort((a, b) => {
        if (sortBy === "ctime") return b.ctime - a.ctime;
        return b.mtime - a.mtime; 
    });
}


// 统一缓存：同时保存 frontmatter 与 title，基于 mtime 验证有效性
const _issueMarkdownCache = new Map<vscode.Uri["fsPath"], cacheStorage.IssueMarkdownCacheEntry>();

// 尝试加载磁盘缓存（不阻塞启动流程）
void (async () => {
    const obj = await cacheStorage.load();
    if (!obj) {
        return;
    }
    for (const [k, v] of Object.entries(obj)) {
        _issueMarkdownCache.set(k, v as cacheStorage.IssueMarkdownCacheEntry);
    }
    Logger.getInstance().debug("[IssueMarkdowns] loaded cache from storage", {
        size: _issueMarkdownCache.size,
    });
})();

/**
 * 应用文件内容编辑（替换整个文件内容）并保存
 * @param uri 文件 URI
 * @param newContent 新的完整文件内容
 * @param originalContent 原始文件内容，用于比较是否有变化
 * @returns 如果成功返回 true，否则返回 false
 */
async function applyContentEdit(
    uri: vscode.Uri,
    newContent: string,
    originalContent: string
): Promise<boolean> {
    if (newContent === originalContent) {
        return true;
    }

    try {
        // 直接写入文件，避免打开编辑器。
        await vscode.workspace.fs.writeFile(uri, Buffer.from(newContent, "utf8"));
        // 写盘成功后刷新已打开的编辑器（如果存在且无未保存更改）
        await refreshOpenEditorsIfNeeded(uri, newContent);
        return true;
    } catch (err) {
        Logger.getInstance().error("applyContentEdit 失败", err);
        return false;
    }
}

/**
 * 在写盘后刷新已经打开的编辑器（不会覆盖有未保存修改的编辑器）
 */
async function refreshOpenEditorsIfNeeded(uri: vscode.Uri, newContent: string): Promise<void> {
    let warned = false;
    for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document.uri.toString() !== uri.toString()) continue;

        if (editor.document.isDirty) {
            if (!warned) {
                Logger.getInstance().warn(
                    "文件在编辑器中有未保存修改，跳过自动刷新：" + uri.fsPath
                );
                try {
                    vscode.window.showWarningMessage(
                        "检测到当前编辑器有未保存更改，未自动应用磁盘更新。"
                    );
                } catch {}
                warned = true;
            }
            continue;
        }

        try {
            const fullRange = new vscode.Range(0, 0, editor.document.lineCount, 0);
            const applied = await editor.edit(eb => eb.replace(fullRange, newContent));
            if (applied) {
                if (editor.document.isDirty) {
                    await editor.document.save();
                }
            }
        } catch (e) {
            Logger.getInstance().warn("刷新打开的编辑器失败", e);
        }
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

    try {
        const contentBytes = await vscode.workspace.fs.readFile(uri);
        const original = Buffer.from(contentBytes).toString("utf8");
        const { frontmatter, body } = extractFrontmatterAndBody(original);

        // 合并更新
        const fm: FrontmatterData = (frontmatter ? { ...frontmatter } : {}) as FrontmatterData;
        for (const [k, v] of Object.entries(updates)) {
            // @ts-ignore
            fm[k] = v as any;
        }

        // 生成新内容
        const fmYaml = yaml.dump(fm, { flowLevel: -1, lineWidth: -1 }).trim();
        const newContent = `---\n${fmYaml}\n---\n${body}`;

        // 应用文件编辑
        const success = await applyContentEdit(uri, newContent, original);
        if (!success) {
            return false;
        }

        // 刷新缓存
        await getIssueMarkdown(uri);

        return true;
    } catch (err) {
        Logger.getInstance().error("updateIssueMarkdownFrontmatter error:", err);
        return false;
    }
}

/**
 * 更新 Markdown 文件的正文（保留或使用现有 frontmatter），并更新缓存。
 * @param uriOrPath 要更新的文件的 URI 或路径。
 * @param newBody 新的正文内容（不包括 frontmatter 部分）。
 * @returns 如果更新成功，则返回 true；否则返回 false。
 */
export async function updateIssueMarkdownBody(
    uriOrPath: vscode.Uri | string,
    newBody: string
): Promise<boolean> {
    const uri = resolveIssueUri(uriOrPath);
    if (!uri) {
        return false;
    }

    try {
        const contentBytes = await vscode.workspace.fs.readFile(uri);
        const original = Buffer.from(contentBytes).toString("utf8");
        const { frontmatter } = extractFrontmatterAndBody(original);

        // 生成新内容（保留原有 frontmatter）
        const fm: FrontmatterData | null = frontmatter ? { ...frontmatter } : null;
        const fmYaml = fm ? yaml.dump(fm, { flowLevel: -1, lineWidth: -1 }).trim() : null;
        const newContent = fmYaml ? `---\n${fmYaml}\n---\n${newBody}` : newBody;

        // 应用文件编辑
        const success = await applyContentEdit(uri, newContent, original);
        if (!success) {
            return false;
        }

        // 刷新缓存
        await getIssueMarkdown(uri);

        return true;
    } catch (err) {
        Logger.getInstance().error("updateIssueMarkdownBody error:", err);
        return false;
    }
}

/**
 * 创建一个新的 issue Markdown 文件（在 `issueDir` 下），并将 frontmatter 与 body 写入文件。
 * - 确保 `issueDir` 存在后在其下创建文件
 * - 文件名由 `generateFileName()` 自动生成（保证唯一且可读）
 * - 写盘完成后会调用缓存刷新以更新 `mtime`/`ctime`/`title`/`frontmatter`
 *
 * 参数说明：调用者应传入一个对象：`{ frontmatter, markdownBody }`。
 * - `frontmatter`: 可选，`Partial<FrontmatterData> | null`，会被序列化为 YAML 放在文档顶部（若为 null 则不写 frontmatter）
 * - `markdownBody`: 可选，文件正文内容（不包含 frontmatter 封头）
 *
 * 返回值：成功返回所创建文件的 `vscode.Uri`，失败返回 `null`。
 */
export async function createIssueMarkdown(opts?: {
    frontmatter?: Partial<FrontmatterData> | null;
    markdownBody?: string;
}): Promise<vscode.Uri | null> {
    const { frontmatter = null, markdownBody = "" } = opts ?? {};
    const issueDir = getIssueDir();
    if (!issueDir) {
        vscode.window.showErrorMessage("问题目录（issueManager.issueDir）未配置，无法创建问题。");
        return null;
    }

    try {
        // 确保目录存在
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(issueDir));

        // 生成文件名：使用统一的 generateFileName()
        const finalName = generateFileName();

        const targetPath = path.join(issueDir, finalName);
        const uri = vscode.Uri.file(targetPath);

        // 生成内容（包含 frontmatter，如果有的话）
        const fmYaml = frontmatter
            ? yaml.dump(frontmatter, { flowLevel: -1, lineWidth: -1 }).trim()
            : null;
        const content = fmYaml ? `---\n${fmYaml}\n---\n${markdownBody}` : markdownBody;

        // 写入文件
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"));

        // 刷新缓存
        await getIssueMarkdown(uri);

        return uri;
    } catch (e) {
        Logger.getInstance().error("createIssueMarkdown 失败", e);
        return null;
    }
}

/** 从缓存获取标题，若未命中则触发预热 */
export function getIssueMarkdownTitleFromCache(uriOrPath: vscode.Uri | string) {
    const uri = resolveIssueUri(uriOrPath);
    if (!uri) {
        return uriOrPath.toString();
    }
    const key = uri.fsPath;
    const cached = _issueMarkdownCache.get(key);
    // 触发异步预热，但不等待
    getIssueMarkdown(uri);
    if (cached?.title) {
        return cached.title;
    }
    return fallbackTitle(uri);
}

/** 标题兜底：优先返回相对于笔记根的相对路径，否则返回完整路径 */
function fallbackTitle(uri: vscode.Uri): string {
    return getRelativeToNoteRoot(uri.fsPath) ?? uri.fsPath;
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
        for (const { uri } of prompts) {
            const data = await vscode.workspace.fs.readFile(uri);
            const text = Buffer.from(data).toString("utf8");
            const { body, frontmatter } = extractFrontmatterAndBody(text);
            const description = frontmatter?.issue_description;
            const label = extractIssueTitleFromFrontmatter(frontmatter) ?? fallbackTitle(uri);
            res.push({
                uri,
                label,
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

// -------------------- Related notes lookup helpers --------------------
export type LinkedFileParseResult = {
    raw: string;
    linkPath: string; // path portion after file: prefix and without fragment
    fsPath?: string; // resolved absolute fsPath if possible
    lineStart?: number;
    lineEnd?: number;
};

function normalizeFsPath(p: string): string {
    // Normalize and resolve path separators
    return path.normalize(p);
}

/**
 * 解析可能的 wiki-link 或文件路径，返回 path 与可选行范围
 * 支持格式：[[file:notes/foo.md#L10-L12]]、[[notes/foo.md#L5]]、file:/abs/path、/abs/path、notes/foo.md
 */
export function parseLinkedFileString(raw: string): LinkedFileParseResult {
    const res: LinkedFileParseResult = { raw, linkPath: raw };
    let s = raw.trim();

    // 支持 [[...|display]] 形式，取 | 前面的真实路径
    if (s.startsWith("[[") && s.endsWith("]]")) {
        s = s.slice(2, -2).trim();
        const pipeIdx = s.indexOf("|");
        if (pipeIdx !== -1) {
            s = s.slice(0, pipeIdx).trim();
        }
    }

    // 如果以 file: 开头，尝试解析为 file URI
    if (s.startsWith("file:")) {
        try {
            const u = vscode.Uri.parse(s);
            if (u && u.scheme === "file" && u.fsPath) {
                // 使用 fsPath 并保留 fragment（如果有）
                s = u.fsPath + (u.fragment ? `#${u.fragment}` : "");
            } else {
                // 如果解析不成功，剥离前缀继续作为普通路径处理
                s = s.slice(5);
            }
        } catch {
            s = s.slice(5);
        }
    }

    // 分离 fragment (#)
    let pathPart = s;
    let frag = "";
    const hashIndex = s.indexOf("#");
    if (hashIndex !== -1) {
        pathPart = s.slice(0, hashIndex).trim();
        frag = s.slice(hashIndex + 1).trim();
    }

    res.linkPath = pathPart;

    // 解析 fragment 中的行范围，支持 L10, L10-L12, 10-12 等形式
    if (frag) {
        const m = frag.match(/(?:L)?(\d+)(?:-(?:L)?(\d+))?/i);
        if (m) {
            res.lineStart = parseInt(m[1], 10);
            if (m[2]) {
                res.lineEnd = parseInt(m[2], 10);
            }
        }
    }

    // 如果 linkPath 看起来是绝对路径或以 / 开头，则填充 fsPath
    try {
        if (res.linkPath && (path.isAbsolute(res.linkPath) || res.linkPath.startsWith(path.sep))) {
            res.fsPath = normalizeFsPath(res.linkPath);
        }
    } catch (e) {
        // ignore
    }

    return res;
}

/**
 * 查找所有把指定文件作为关联写入 frontmatter.issue_linked_files 的 issue markdown
 */
export async function findNotesLinkedToFile(fileUri: vscode.Uri): Promise<IssueMarkdown[]> {
    const targetFs = normalizeFsPath(fileUri.fsPath);
    const all = await getAllIssueMarkdowns();
    const res: IssueMarkdown[] = [];

    for (const issue of all) {
        const fm = issue.frontmatter;
        if (!fm || !fm.issue_linked_files || fm.issue_linked_files.length === 0) continue;
        const issueDir = path.dirname(issue.uri.fsPath);
        for (const raw of fm.issue_linked_files) {
            try {
                const parsed = parseLinkedFileString(raw);
                let candidateFs: string | undefined;
                if (parsed.fsPath) {
                    candidateFs = parsed.fsPath;
                } else if (parsed.linkPath) {
                    // 相对路径相对于 issue 文件目录解析
                    const maybe = path.resolve(issueDir, parsed.linkPath);
                    candidateFs = normalizeFsPath(maybe);
                }

                if (!candidateFs) continue;
                if (candidateFs === targetFs) {
                    res.push(issue);
                    break;
                }
            } catch (e) {
                // ignore individual parse errors
            }
        }
    }

    return res;
}

/**
 * 查找所有在 frontmatter.issue_linked_workspace 中包含指定 workspace 路径的 issue markdown
 */
export async function findNotesLinkedToWorkspace(fileUri: vscode.Uri): Promise<IssueMarkdown[]> {
    const targetFs = normalizeFsPath(fileUri.fsPath);
    const all = await getAllIssueMarkdowns();
    const res: IssueMarkdown[] = [];

    for (const issue of all) {
        const fm = issue.frontmatter;
        if (!fm || !fm.issue_linked_workspace || fm.issue_linked_workspace.length === 0) continue;
        for (const raw of fm.issue_linked_workspace) {
            let s = raw.trim();
            if (s.startsWith("[[") && s.endsWith("]]")) {
                s = s.slice(2, -2).trim();
            }

            // 统一得到要检查的路径：支持带或不带 "workspace:" 前缀
            let pathToCheck = s;
            if (pathToCheck.startsWith("workspace:")) {
                try {
                    const u = vscode.Uri.parse(pathToCheck);
                    if (u && u.fsPath) {
                        pathToCheck = u.fsPath;
                    } else {
                        pathToCheck = pathToCheck.substring("workspace:".length);
                    }
                } catch (e) {
                    // 解析为 URI 失败时，去掉前缀作为普通路径处理
                    pathToCheck = pathToCheck.substring("workspace:".length);
                }
            }

            try {
                const candidate = normalizeFsPath(pathToCheck);
                // 匹配相等或 target 包含 candidate（candidate 是父路径）
                if (candidate === targetFs || targetFs.startsWith(candidate + path.sep)) {
                    res.push(issue);
                    break;
                }
            } catch (e) {
                Logger.getInstance().warn(`无法解析 issue_linked_workspace 中的路径: ${raw}`, e);
            }
        }
    }

    return res;
}

export function getIssueMarkdownContextValues() {
    return "issueMarkdown";
}
/**
 * 获取 IssueMarkdown 相对于问题目录的路径
 * @param uri 文件的 URI
 * @returns 相对于问题目录的路径，如果文件不在问题目录内则返回 null
 */

export function getIssueFilePath(uri: vscode.Uri): string | null {
    const issueDir = getIssueDir();
    if (!issueDir) {
        return null;
    }

    const relativePath = path.relative(issueDir, uri.fsPath);
    // 如果 relativePath 不以 '..' 开头，并且不是绝对路径，则说明文件在 issueDir 目录内
    return !relativePath.startsWith("..") && !path.isAbsolute(relativePath) ? relativePath : null;
}
/**
 * 检查文件是否为问题目录下的 Markdown 文件
 * @param fileUri 文件的 URI
 * @returns 如果是问题目录下的 Markdown 文件返回 true，否则返回 false
 */

export function isIssueMarkdownFile(fileUri: vscode.Uri): boolean {
    if (fileUri.scheme !== "file" || !fileUri.fsPath.endsWith(".md")) {
        return false;
    }

    return getIssueFilePath(fileUri) !== null;
}
