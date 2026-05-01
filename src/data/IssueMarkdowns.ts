import * as vscode from "vscode";
import * as path from "path";
import * as jsYaml from "js-yaml";
import * as os from "os";
import { getIssueDir } from "../config";
import { Logger } from "../core/utils/Logger";
import { getRelativeToNoteRoot, resolveIssueUri } from "../utils/pathUtils";
import * as cacheStorage from "../data/issueMarkdownCacheStorage";
import { generateFileName, getTimestampFromFileName } from "../utils/fileUtils";
import {
    extractTitleFromContent,
    extractFrontmatterAndBody,
    extractIssueTitleFromFrontmatter,
    isAgentFileFrontmatter,
} from "../services/issue-core/frontmatter";
import { INDEXED_TYPE_KEYS, type IndexedTypeKey } from "../services/issue-core/types";

// 重新导出纯类型与纯函数,保持原有 import 路径(`from "../data/IssueMarkdowns"`)兼容。
export type { FrontmatterData, TermDefinition } from "../services/issue-core/types";
export {
    isValidObject,
    extractFrontmatterLines,
    normalizeYamlScalar,
    buildTermLocationMap,
    extractIssueTitleFromFrontmatter,
    extractFrontmatterAndBody,
} from "../services/issue-core/frontmatter";

import type { FrontmatterData } from "../services/issue-core/types";

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
    // 视图时间：最后在编辑器中打开的时间，用于按访问时间排序
    vtime?: number;
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
                vtime: cached.vtime ?? mtime,
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
            frontmatter: frontmatter ?? null,
            title,
            vtime: cached?.vtime ?? mtime, // 保留已有的 vtime 或使用 mtime
        };
        _issueMarkdownCache.set(key, entry);
        updateTypeIndex(key, frontmatter);
        // 仅在标题实际变更时通知订阅者，避免正文编辑触发多余的视图刷新
        // agent 系统文件（高频写入）走独立事件，不触发问题总览刷新
        if (!cached || cached.title !== title) {
            if (isAgentFileFrontmatter(frontmatter as Record<string, unknown> | null | undefined)) {
                scheduleOnAgentFileUpdate();
            } else {
                scheduleOnDidUpdate();
            }
        }
        cacheStorage.save(Object.fromEntries(_issueMarkdownCache.entries()));

        return { title, uri, frontmatter: frontmatter ?? null, mtime, ctime, vtime: entry.vtime };
    } catch (err) {
        _issueMarkdownCache.delete(key);
        removeFromTypeIndex(key);
        cacheStorage.save(Object.fromEntries(_issueMarkdownCache.entries()));
        return null;
    }
}

/**
 * 获取问题目录中所有 Markdown 文件的标题和 URI（并行加载）。
 * - 默认按文件修改时间 `mtime` 降序（最近更新的排在前面）；可通过 `sortBy` 参数改为其他排序方式。
 * - 参数：`{ sortBy?: "mtime" | "ctime" | "vtime" }`，默认 `{ sortBy: "mtime" }`。
 * - `"vtime"` 按最后查看时间排序，适合按访问频率排列。
 */
export async function getAllIssueMarkdowns(
    { sortBy = "mtime" }: { sortBy?: "mtime" | "ctime" | "vtime" } = {}
): Promise<IssueMarkdown[]> {
    const issueDir = getIssueDir();
    if (!issueDir) return [];

    // ── 热路径：缓存就绪后直接从内存返回，零文件 I/O ──
    if (_cacheReady) {
        return getAllFromCache(issueDir, sortBy);
    }

    // ── 冷路径：首次加载（缓存尚未就绪），走 findFiles 全扫描 ──
    const files = await vscode.workspace.findFiles(
        new vscode.RelativePattern(issueDir, "*.md"),
        "**/.issueManager/**"
    );

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

    return sortIssueMarkdowns(issues, sortBy);
}

/** 从内存缓存构建 IssueMarkdown 列表（零 I/O，O(N) 遍历 + O(N log N) 排序） */
function getAllFromCache(issueDir: string, sortBy: "mtime" | "ctime" | "vtime"): IssueMarkdown[] {
    const issueDirNorm = path.normalize(issueDir);
    const results: IssueMarkdown[] = [];

    for (const [fsPath, cached] of _issueMarkdownCache) {
        // 仅保留 issueDir 根目录下的 .md 文件（非子目录）
        if (!fsPath.endsWith('.md')) { continue; }
        if (path.normalize(path.dirname(fsPath)) !== issueDirNorm) { continue; }

        const uri = vscode.Uri.file(fsPath);
        const fileName = path.basename(fsPath);
        const ctime = getTimestampFromFileName(fileName) || cached.mtime;
        results.push({
            title: cached.title ?? path.basename(fsPath, '.md'),
            uri,
            frontmatter: (cached.frontmatter ?? null) as FrontmatterData | null,
            mtime: cached.mtime,
            ctime,
            vtime: cached.vtime ?? cached.mtime,
        });
    }

    return sortIssueMarkdowns(results, sortBy);
}

/** 按指定字段降序排序 */
function sortIssueMarkdowns(issues: IssueMarkdown[], sortBy: "mtime" | "ctime" | "vtime"): IssueMarkdown[] {
    return issues.sort((a, b) => {
        if (sortBy === "ctime") return b.ctime - a.ctime;
        if (sortBy === "vtime") return (b.vtime ?? b.mtime) - (a.vtime ?? a.mtime);
        return b.mtime - a.mtime;
    });
}


// 统一缓存：同时保存 frontmatter 与 title，基于 mtime 验证有效性
const _issueMarkdownCache = new Map<vscode.Uri["fsPath"], cacheStorage.IssueMarkdownCacheEntry>();

// ─── frontmatter 类型倒排索引 ────────────────────────────────────
//
// 按 frontmatter 中的布尔标记字段分类索引，如 "chat_role"、"chat_conversation" 等。
// 查询 O(K)（K = 该类型文件数），无需 findFiles 全目录扫描。
//
// 索引键 = frontmatter 中值为 true 的字段名（如 "chat_role"）
// 索引值 = 该类型所有文件的 fsPath 集合

/** frontmatter 类型 → 文件路径集合 */
const _typeIndex = new Map<string, Set<string>>();

/**
 * 根据缓存检查 URI 对应的文件是否为 agent 系统自动生成文件。
 * 仅查缓存，不触发磁盘读取。
 * @param uri - 文件 URI
 * @returns 如果是 agent 系统文件则返回 true
 */
export function isAgentFileUri(uri: vscode.Uri): boolean {
    const cached = _issueMarkdownCache.get(uri.fsPath);
    return isAgentFileFrontmatter(cached?.frontmatter as Record<string, unknown> | null | undefined);
}

/** 更新某个文件在类型索引中的条目（先清旧、再加新） */
function updateTypeIndex(fsPath: string, frontmatter: Record<string, unknown> | null | undefined): void {
    // 先从所有类型集合中移除该路径
    for (const typeKey of INDEXED_TYPE_KEYS) {
        _typeIndex.get(typeKey)?.delete(fsPath);
    }
    // 按当前 frontmatter 重新加入
    if (frontmatter) {
        for (const typeKey of INDEXED_TYPE_KEYS) {
            if (frontmatter[typeKey] === true) {
                let set = _typeIndex.get(typeKey);
                if (!set) { set = new Set(); _typeIndex.set(typeKey, set); }
                set.add(fsPath);
            }
        }
    }
}

/** 从类型索引中移除某个文件（文件被删除时调用） */
function removeFromTypeIndex(fsPath: string): void {
    for (const typeKey of INDEXED_TYPE_KEYS) {
        _typeIndex.get(typeKey)?.delete(fsPath);
    }
}

/**
 * 按 frontmatter 类型查询文件列表（从索引中获取，O(K) 复杂度）。
 *
 * 返回的 IssueMarkdown 直接从内存缓存重建，不触发文件 I/O。
 * 注意：如果缓存条目的 mtime 已过期，此处不做验证（由后续的
 * getIssueMarkdown 调用负责刷新），确保查询始终 O(K)。
 */
export function getIssueMarkdownsByType(typeKey: IndexedTypeKey): IssueMarkdown[] {
    const pathSet = _typeIndex.get(typeKey);
    if (!pathSet || pathSet.size === 0) { return []; }

    const results: IssueMarkdown[] = [];
    for (const fsPath of pathSet) {
        const cached = _issueMarkdownCache.get(fsPath);
        if (!cached) { continue; } // 索引残留（理论上不应出现）
        const uri = vscode.Uri.file(fsPath);
        const fileName = path.basename(fsPath);
        const ctime = getTimestampFromFileName(fileName) || cached.mtime;
        results.push({
            title: cached.title ?? path.basename(fsPath, '.md'),
            uri,
            frontmatter: (cached.frontmatter ?? null) as FrontmatterData | null,
            mtime: cached.mtime,
            ctime,
            vtime: cached.vtime ?? cached.mtime,
        });
    }
    return results.sort((a, b) => b.mtime - a.mtime);
}

/**
 * 从缓存中按 fsPath 移除条目并同步清理类型索引。
 * 用于文件删除场景。
 */
export function removeIssueMarkdownFromCache(uriOrPath: vscode.Uri | string): void {
    const fsPath = typeof uriOrPath === 'string' ? uriOrPath : uriOrPath.fsPath;
    _issueMarkdownCache.delete(fsPath);
    removeFromTypeIndex(fsPath);
    cacheStorage.save(Object.fromEntries(_issueMarkdownCache.entries()));
}

// 尝试加载磁盘缓存（不阻塞启动流程）
// whenCacheReady 在缓存加载 + 索引重建完成后 resolve，
// 消费方可 await 此 promise 确保首次查询有数据。
let _resolveCacheReady!: () => void;
export const whenCacheReady: Promise<void> = new Promise(r => { _resolveCacheReady = r; });
let _cacheReady = false;

/** 缓存是否已从磁盘加载完毕（同步查询） */
export function isCacheReady(): boolean { return _cacheReady; }

void (async () => {
    try {
        const obj = await cacheStorage.load();
        if (obj) {
            for (const [k, v] of Object.entries(obj)) {
                const entry = v as cacheStorage.IssueMarkdownCacheEntry;
                _issueMarkdownCache.set(k, entry);
                updateTypeIndex(k, entry.frontmatter);
            }
            Logger.getInstance().debug("[IssueMarkdowns] loaded cache from storage", {
                size: _issueMarkdownCache.size,
                typeIndex: Object.fromEntries(
                    [..._typeIndex.entries()].map(([k, v]) => [k, v.size]),
                ),
            });
        }
    } finally {
        _cacheReady = true;
        _resolveCacheReady();
    }
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
export async function refreshOpenEditorsIfNeeded(uri: vscode.Uri, newContent?: string): Promise<void> {
    let warned = false;

    // 如果没有传入 newContent，则尝试从磁盘读取当前内容
    if (typeof newContent === 'undefined') {
        try {
            const bytes = await vscode.workspace.fs.readFile(uri);
            newContent = Buffer.from(bytes).toString('utf8');
        } catch (e) {
            // 无法读取则直接返回
            return;
        }
    }

    for (const editor of vscode.window.visibleTextEditors) {
        // 比较 fsPath，忽略可能的 query 部分
        if (editor.document.uri.fsPath !== uri.fsPath) continue;

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
            const endLine = Math.max(0, editor.document.lineCount - 1);
            const lastLine = editor.document.lineAt(endLine);
            const fullRange = new vscode.Range(0, 0, endLine, lastLine.range.end.character);
            const applied = await editor.edit(eb => eb.replace(fullRange, newContent!));
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
        const fmYaml = jsYaml.dump(fm, { flowLevel: -1, lineWidth: -1 }).trim();
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
        const fmYaml = fm ? jsYaml.dump(fm, { flowLevel: -1, lineWidth: -1 }).trim() : null;
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
    /**
     * 可选子目录（相对于 issueDir）。传入后文件写入 `<issueDir>/<subdir>/`。
     * 注意：类型索引（getIssueMarkdownsByType）仅扫描 issueDir 根目录，
     * 写入子目录的文件不会进入索引 — 这是 A2A task 等场景的隔离需求。
     * 外部调用者需自行维护子目录下文件的查找方式。
     */
    subdir?: string;
}): Promise<vscode.Uri | null> {
    const { frontmatter = null, markdownBody = "", subdir } = opts ?? {};
    const issueDir = getIssueDir();
    if (!issueDir) {
        vscode.window.showErrorMessage("问题目录（issueManager.issueDir）未配置，无法创建问题。");
        return null;
    }

    try {
        // 防御性路径校验：subdir 必须是相对路径，不得跳出 issueDir
        const targetDir = subdir
            ? path.resolve(issueDir, subdir)
            : issueDir;
        if (subdir && !targetDir.startsWith(path.resolve(issueDir) + path.sep)) {
            Logger.getInstance().error(`createIssueMarkdown: 非法 subdir "${subdir}"`);
            return null;
        }

        // 确保目录存在
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(targetDir));

        // 生成文件名：使用统一的 generateFileName()
        const finalName = generateFileName();

        const targetPath = path.join(targetDir, finalName);
        const uri = vscode.Uri.file(targetPath);

        // 生成内容（包含 frontmatter，如果有的话）
        const fmYaml = frontmatter
            ? jsYaml.dump(frontmatter, { flowLevel: -1, lineWidth: -1 }).trim()
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
/** agent 系统文件更新事件：仅 agent 生成文件（chat_conversation、execution_log 等）变更时触发，不影响问题总览。 */
const onAgentFileUpdateEmitter = new vscode.EventEmitter<void>();

let _debounceTimer: ReturnType<typeof setTimeout> | undefined;
let _agentDebounceTimer: ReturnType<typeof setTimeout> | undefined;
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

/** 调度 agent 文件更新通知（独立防抖，不触发问题总览刷新）。 */
function scheduleOnAgentFileUpdate(): void {
    if (_agentDebounceTimer) {
        clearTimeout(_agentDebounceTimer);
    }
    _agentDebounceTimer = setTimeout(() => {
        try {
            onAgentFileUpdateEmitter.fire();
        } catch {}
        _agentDebounceTimer = undefined;
    }, DebounceDelayMillis);
}

export const onTitleUpdate = onTitleUpdateEmitter.event;
/** agent 系统文件更新事件（chat_conversation、execution_log、role_memory 等高频写入文件）。 */
export const onAgentFileUpdate = onAgentFileUpdateEmitter.event;

// ---- vtime 变更事件（独立于标题变更，仅影响最近问题视图排序） ----
const onVtimeUpdatedEmitter = new vscode.EventEmitter<void>();
/** vtime 变更事件：仅当查看时间更新时触发，与标题变更互不干扰 */
export const onVtimeUpdated = onVtimeUpdatedEmitter.event;

// -------------------- vtime (View Time) management --------------------

let _cacheSaveTimer: ReturnType<typeof setTimeout> | undefined;
const CACHE_SAVE_DELAY_MILLIS = 2000; // 2秒防抖，避免频繁写盘

/**
 * 安排缓存保存（防抖）
 */
function scheduleCacheSave(): void {
    if (_cacheSaveTimer) {
        clearTimeout(_cacheSaveTimer);
    }
    _cacheSaveTimer = setTimeout(() => {
        cacheStorage.save(Object.fromEntries(_issueMarkdownCache.entries()));
        _cacheSaveTimer = undefined;
    }, CACHE_SAVE_DELAY_MILLIS);
}

/**
 * 更新 Issue Markdown 的查看时间（vtime）
 * 当文件在编辑器中被打开或激活时调用此函数
 * @param uriOrPath 文件 URI 或路径
 * @returns 是否更新成功
 */
export function updateIssueVtime(uriOrPath: vscode.Uri | string): boolean {
    const uri = resolveIssueUri(uriOrPath);
    if (!uri) return false;
    
    const key = uri.fsPath;
    const cached = _issueMarkdownCache.get(key);
    if (!cached) {
        // 如果缓存中没有，触发异步加载（不阻塞）
        void getIssueMarkdown(uri);
        return false;
    }
    
    const now = Date.now();
    cached.vtime = now;
    _issueMarkdownCache.set(key, cached);
    
    onVtimeUpdatedEmitter.fire(); // 仅通知 vtime 订阅者，不触发全量视图刷新
    scheduleCacheSave(); // 安排保存缓存

    return true;
}

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
    colStart?: number; // optional column (character) start
    colEnd?: number; // optional column (character) end
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

    // 如果是 Markdown 链接形式 [label](file:...)
    const mdLinkMatch = s.match(/^\[([^\]]+)\]\(\s*(file:[^)]+)\s*\)$/i);
    if (mdLinkMatch) {
        // 使用括号内的 file: URI 部分代替原始字符串进行后续解析
        s = mdLinkMatch[2];
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

    // 解析 fragment 中的行/列范围，支持多种形式：
    // L10, L10-L12, 10-12, L8:1-L9:20, 8:1-9:20 等
    if (frag) {
        const m = frag.match(/(?:L)?(\d+)(?::(\d+))?(?:-(?:L)?(\d+)(?::(\d+))?)?/i);
        if (m) {
            res.lineStart = parseInt(m[1], 10);
            if (m[2]) {
                res.colStart = parseInt(m[2], 10);
            }
            if (m[3]) {
                res.lineEnd = parseInt(m[3], 10);
            }
            if (m[4]) {
                res.colEnd = parseInt(m[4], 10);
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
    return "IssueMarkdown";
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
