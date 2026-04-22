// 最近 LLM 对话模式：加载并展示最近的对话，支持按标题/角色名搜索，选中后打开对话文件并将光标置于末尾。
// 展示策略：先按统一时间轴快速呈现列表，Phase 2 并行读取每个对话文件填充最后用户消息与准确执行状态。
// executing 以当前时间自然浮顶；queued/retrying/error 在 Phase 2 后更新图标；未开始的对话在列表末端。

import * as vscode from "vscode";
import { QuickPickItemWithId, filterItems } from "./unifiedQuickOpen.types";
import { getRecentConversationEntries, getAllChatRoles, getConversationsForRole } from "../llmChat/llmChatDataManager";
import { RoleTimerManager } from "../llmChat/RoleTimerManager";
import { parseStateMarker, ConvStatus } from "../llmChat/convStateMarker";

/**
 * 格式化时间戳为相对时间字符串。
 * @param timestamp - 毫秒时间戳
 * @returns 人类可读的相对时间（如"5 分钟前"）
 */
function formatRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) { return `${days} 天前`; }
    if (hours > 0) { return `${hours} 小时前`; }
    if (minutes > 0) { return `${minutes} 分钟前`; }
    return '刚刚';
}

type FileInfo = { lastUserMsg?: string; convStatus?: ConvStatus };

/**
 * 单次读取对话文件，同时获取最后一条用户消息和 state marker（零额外 I/O）。
 * @param uri - 对话文件 URI
 * @returns 最后一条用户消息文本及对话状态
 */
async function getFileInfo(uri: vscode.Uri): Promise<FileInfo> {
    try {
        const raw = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
        const re = /## User \([^)]+\)\n\n([\s\S]*?)(?=\n## |\n<!-- llm:|$)/g;
        let last: string | undefined;
        let m: RegExpExecArray | null;
        while ((m = re.exec(raw)) !== null) {
            const text = m[1].trim().replace(/\n+/g, ' ');
            if (text) { last = text; }
        }
        const marker = parseStateMarker(raw);
        return {
            lastUserMsg: last ? (last.length > 80 ? last.slice(0, 80) + '…' : last) : undefined,
            convStatus: marker?.status,
        };
    } catch {
        return {};
    }
}

/** 对话执行状态对应的 VS Code Codicon */
function convStatusIcon(status: ConvStatus): string {
    switch (status) {
        case 'queued':   return '$(clock)';
        case 'retrying': return '$(sync)';
        case 'error':    return '$(error)';
        default:         return '$(comment-discussion)';
    }
}

/** 全量条目缓存，用于值变化时本地过滤 */
let _allItems: QuickPickItemWithId[] = [];

type MergedEntry = {
    title: string;
    roleName: string;
    uri: vscode.Uri;
    timestamp: number;
    isExecuting: boolean;
    isNew: boolean;  // 无执行日志且非 executing（Phase 2 根据 state marker 可更新图标）
};

/**
 * 进入最近对话模式，加载对话列表。
 * @param quickPick - 当前 QuickPick 实例
 * @param searchText - 初始搜索文本
 */
export async function enterRecentChatMode(
    quickPick: vscode.QuickPick<QuickPickItemWithId>,
    searchText = ""
): Promise<void> {
    quickPick.placeholder = "搜索最近 LLM 对话（支持标题 / 角色名）";
    quickPick.busy = true;
    quickPick.items = [];

    const entries = await getRecentConversationEntries(50);
    const loggedIds = new Set(entries.map(e => e.conversationId));

    // 收集所有角色的对话，构建 fsPath → meta 映射（纯内存）
    const allRoles = getAllChatRoles();
    type ConvoMeta = { id: string; title: string; roleName: string; uri: vscode.Uri; mtime: number };
    const pathToMeta = new Map<string, ConvoMeta>();
    for (const role of allRoles) {
        for (const c of getConversationsForRole(role.id)) {
            if (c.uri) {
                pathToMeta.set(c.uri.fsPath, { id: c.id, title: c.title, roleName: role.name, uri: c.uri, mtime: c.mtime });
            }
        }
    }

    // 正在执行的对话（内存锁，无 I/O），用当前时间作为排序键确保自然浮顶
    const executingPaths = new Set(RoleTimerManager.getInstance().executingPaths);
    const now = Date.now();

    const executingEntries: MergedEntry[] = [];
    for (const fsPath of executingPaths) {
        const meta = pathToMeta.get(fsPath);
        if (meta) {
            executingEntries.push({ title: meta.title, roleName: meta.roleName, uri: meta.uri, timestamp: now, isExecuting: true, isNew: false });
        }
    }

    // 有执行日志的对话（排除执行中）
    const filteredEntries: MergedEntry[] = entries
        .filter(e => e.conversationUri !== undefined && !executingPaths.has(e.conversationUri.fsPath))
        .map(e => ({ title: e.title, roleName: e.roleName, uri: e.conversationUri!, timestamp: e.latestTimestamp, isExecuting: false, isNew: false }));

    // 无执行日志的对话（可能是新建、queued 或 retrying，Phase 2 读文件后更新图标）
    const unloggedEntries: MergedEntry[] = [];
    for (const [fsPath, meta] of pathToMeta) {
        if (!loggedIds.has(meta.id) && !executingPaths.has(fsPath)) {
            unloggedEntries.push({ title: meta.title, roleName: meta.roleName, uri: meta.uri, timestamp: meta.mtime, isExecuting: false, isNew: true });
        }
    }

    // 统一时间轴排序：executing 以 Date.now() 自然浮顶，其余按各自时间戳降序
    const merged: MergedEntry[] = [...executingEntries, ...filteredEntries, ...unloggedEntries];
    merged.sort((a, b) => b.timestamp - a.timestamp);

    // Phase 1：立即展示（无 detail，queued/retrying/error 图标待 Phase 2 补全）
    _allItems = merged.map(e => ({
        label: e.isExecuting
            ? `$(loading~spin) ${e.title}  ·  执行中`
            : `$(comment-discussion) ${e.title}  ·  ${formatRelativeTime(e.timestamp)}`,
        description: e.roleName + (e.isNew ? '  未开始' : ''),
        fileUri: e.uri,
    }));

    quickPick.busy = false;
    quickPick.items = searchText ? filterItems(_allItems, searchText) : _allItems;
    if (quickPick.items.length > 0) {
        quickPick.activeItems = [quickPick.items[0]];
    }

    // Phase 2：并行读取每个对话文件，获取最后用户消息 + state marker
    const currentValue = searchText;
    const fileInfoResults = await Promise.all(merged.map(e => getFileInfo(e.uri)));

    _allItems = _allItems.map((item, i) => {
        const info = fileInfoResults[i];
        const e = merged[i];
        let label = item.label;
        let description = item.description;

        // 非 executing：根据 state marker 更新图标（queued/retrying/error）
        if (!e.isExecuting && info.convStatus && info.convStatus !== 'ready') {
            const icon = convStatusIcon(info.convStatus);
            const statusText = info.convStatus === 'queued' ? '排队中'
                : info.convStatus === 'retrying' ? '重试中'
                : info.convStatus === 'error' ? '执行错误'
                : formatRelativeTime(e.timestamp);
            label = `${icon} ${e.title}  ·  ${statusText}`;
            description = e.roleName;  // 有明确状态时移除"未开始"
        }

        return { ...item, label, description, detail: info.lastUserMsg };
    });

    quickPick.items = currentValue ? filterItems(_allItems, currentValue) : _allItems;
}

/**
 * 处理最近对话模式下的输入变化，本地过滤已加载条目。
 * @param quickPick - 当前 QuickPick 实例
 * @param value - 当前输入值
 */
export function handleRecentChatModeValueChange(
    quickPick: vscode.QuickPick<QuickPickItemWithId>,
    value: string
): void {
    quickPick.items = value ? filterItems(_allItems, value) : _allItems;
    if (quickPick.items.length > 0) {
        quickPick.activeItems = [quickPick.items[0]];
    }
}

/**
 * 处理最近对话模式下的条目确认，打开对话文件并将光标移至末尾。
 * @param selected - 用户选中的条目
 * @returns 是否已处理
 */
export async function handleRecentChatModeAccept(
    selected: QuickPickItemWithId,
): Promise<boolean> {
    const uri = selected.fileUri;
    if (!uri) { return false; }
    try {
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc, { preview: false });
        const lastLine = editor.document.lineCount - 1;
        const lastChar = editor.document.lineAt(lastLine).text.length;
        const endPos = new vscode.Position(lastLine, lastChar);
        editor.selection = new vscode.Selection(endPos, endPos);
        editor.revealRange(
            new vscode.Range(endPos, endPos),
            vscode.TextEditorRevealType.InCenterIfOutsideViewport
        );
        return true;
    } catch (err) {
        vscode.window.showErrorMessage(`打开对话文件失败：${String(err)}`);
        return false;
    }
}
