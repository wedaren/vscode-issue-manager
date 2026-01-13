import * as vscode from "vscode";
import * as path from "path";
import * as yaml from "js-yaml";
import * as os from "os";
import { getIssueDir } from "../config";
import { Logger } from "../core/utils/Logger";
import { getRelativeToNoteRoot, resolveIssueUri } from "../utils/pathUtils";
import * as cacheStorage from "../data/issueMarkdownCacheStorage";
import { generateFileName } from "../utils/fileUtils";
import { addFocus } from "./focusedManager";
import { IssueNode, createIssueNodes } from "./issueTreeManager";


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
    const data = Buffer.from(contentBytes).toString("utf-8").replace(/^---\s*[\s\S]*?---\s*/, "");
    return data;
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
 * 类型守卫：判断对象是否为 IssueMarkdown
 * 目的：避免在多个文件中重复实现相同的检查逻辑
 */
export function isIssueMarkdown(item: unknown): item is IssueMarkdown {
    return !!item && typeof item === 'object' && 'title' in item && 'uri' in item;
}

export async function getIssueMarkdown(file: vscode.Uri): Promise<IssueMarkdown> {
    const title = await getIssueMarkdownTitle(file);
    const frontmatter = await getIssueMarkdownFrontmatter(file);
    return { title, uri: file, frontmatter };
}
/**
 * 获取问题目录中所有 Markdown 文件的标题和 URI。
 * @returns 包含标题和 URI 的对象数组。
 */
export async function getAllIssueMarkdowns(): Promise<IssueMarkdown[]> {
    const files = await getAllIssueMarkdownFiles();
    const issues: IssueMarkdown[] = [];

    for (const file of files) {
        const issueMarkdown = await getIssueMarkdown(file);
        issues.push(issueMarkdown);
    }

    return issues;
}

type IssueMarkdownCacheEntry = {
    mtime: number;
    frontmatter?: FrontmatterData | null;
    title?: string;
};

// 统一缓存：同时保存 frontmatter 与 title，基于 mtime 验证有效性
const _issueMarkdownCache = new Map<vscode.Uri['fsPath'], IssueMarkdownCacheEntry>();

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
    const key = uri.fsPath;
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
    const key = uri.fsPath;
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
    const key = uri.fsPath;
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
    const key = uri.fsPath;
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
    } catch (error: any) {
        // 如果是文件不存在的常见情况，降为 warn 级别以避免日志噪音
        const isNotFound = error && (error.code === 'FileNotFound' || error.code === 'ENOENT' || (error.name && error.name.includes('FileNotFound')) || (error.message && error.message.includes('ENOENT')));
        if (isNotFound) {
            // TODO ，避免基于 issueid 读取标题时报错
            // Logger.getInstance().warn(`读取文件失败（文件不存在） ${uri.fsPath}`);
        } else {
            // Logger.getInstance().error(`读取文件时出错 ${uri.fsPath}:`, error);
        }
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
        for (const { uri } of prompts) {
            const data = await vscode.workspace.fs.readFile(uri);
            const text = Buffer.from(data).toString("utf8");
            const { body,frontmatter } = extractFrontmatterAndBody(text);
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
            if (u && u.scheme === 'file' && u.fsPath) {
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
 * 查找所有在 frontmatter.issue_linked_workspace 中包含指定 workspace 路径或其父路径的 issue markdown
 */
export async function findNotesLinkedToWorkspace(workspaceUri: vscode.Uri): Promise<IssueMarkdown[]> {
    const targetFs = normalizeFsPath(workspaceUri.fsPath);
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
            if (s.startsWith("workspace:")) {
                try {
                    const u = vscode.Uri.parse(s);
                    if (u && u.fsPath) s = u.fsPath;
                } catch {}
            }
            try {
                const candidate = normalizeFsPath(s);
                // 匹配相等或 target 包含 candidate（candidate 是父路径）
                if (candidate === targetFs || targetFs.startsWith(candidate + path.sep)) {
                    res.push(issue);
                    break;
                }
            } catch {}
        }
    }

    return res;
}


export function getIssueMarkdownContextValues(){
    return 'issueMarkdown';
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
  return !relativePath.startsWith('..') && !path.isAbsolute(relativePath) ? relativePath : null;
}
/**
 * 检查文件是否为问题目录下的 Markdown 文件
 * @param fileUri 文件的 URI
 * @returns 如果是问题目录下的 Markdown 文件返回 true，否则返回 false
 */

export function isIssueMarkdownFile(fileUri: vscode.Uri): boolean {
  if (fileUri.scheme !== 'file' || !fileUri.fsPath.endsWith('.md')) {
    return false;
  }

  return getIssueFilePath(fileUri) !== null;
}
/**
 * 仅负责在磁盘上创建新的问题文件。
 * 文件名格式：YYYYMMDD-HHmmss-SSS.md，兼具可读性和唯一性。
 * @param title 问题标题
 * @returns 新建文件的 URI，如果失败则返回 null。
 */
export async function createIssueMarkdown(title: string, content?: string): Promise<vscode.Uri | null> {
	const issueDir = getIssueDir();
	if (!issueDir) {
		vscode.window.showErrorMessage('问题目录未配置。');
		return null;
	}
	const filename = generateFileName();
	const filePath = vscode.Uri.file(path.join(issueDir, filename));

	// 如果外部传入了 content，则直接使用；否则根据 title 生成最小内容
	const finalContent = (typeof content === 'string' && content.length > 0) ? content : `# ${title}\n\n`;
	const contentBytes = Buffer.from(finalContent, 'utf8');

	await vscode.workspace.fs.writeFile(filePath, contentBytes);
	await vscode.window.showTextDocument(filePath);

	return filePath;
}


/**
 * 与 `createIssueMarkdown` 类似，但不会在创建后自动打开编辑器。
 * 供需要“创建但不打开”场景（例如后台填充）使用。
 */
export async function createIssueMarkdownSilent(title: string, content?: string): Promise<vscode.Uri | null> {
	const issueDir = getIssueDir();
	if (!issueDir) {
		vscode.window.showErrorMessage('问题目录未配置。');
		return null;
	}
	const filename = generateFileName();
	const filePath = vscode.Uri.file(path.join(issueDir, filename));

	const finalContent = (typeof content === 'string' && content.length > 0) ? content : `# ${title}\n\n`;
	const contentBytes = Buffer.from(finalContent, 'utf8');

	await vscode.workspace.fs.writeFile(filePath, contentBytes);
	// 注意：与 createIssueMarkdown 不同，这里不调用 showTextDocument，从而实现“静默创建”。
	return filePath;
}

/**
 * 将指定文件路径的多个 issue 添加到 tree.json 数据中。
 * @param issueUris 要添加的问题文件的 URI 数组
 * @param parentId 父节点的 ID，如果为 null 则作为根节点
 * @param isAddToFocused 是否将新添加的节点添加到关注列表
 */
export async function addIssueToTree(issueUris: vscode.Uri[], parentId?: string, isAddToFocused: boolean = false): Promise<IssueNode[] | null> {
	const res = await createIssueNodes(issueUris, parentId);
	if (!res) { return null; }

	const ids = res.map(node => node.id);
	if (isAddToFocused) {
		addFocus(ids);
	}

	vscode.commands.executeCommand('issueManager.refreshAllViews');
	return res;
}

