import * as vscode from "vscode";
import { QuickPickItemWithId } from "./unifiedQuickOpen.types";
import { getAllIssueMarkdowns, getIssueMarkdownTitleFromCache } from "../data/IssueMarkdowns";
import { getIssueNodesByUri } from "../data/issueTreeManager";
import { openIssueNode } from "./openIssueNode";

type SortBy = "mtime" | "ctime";

function toItem(m: { title: string; uri: vscode.Uri; mtime: number; ctime: number }) {
    const desc = m.uri.fsPath;
    return {
        label: m.title,
        description: desc,
        fileUri: m.uri,
        execute: async () => {},
    } as QuickPickItemWithId;
}

export async function enterTimeMode(
    quickPick: vscode.QuickPick<QuickPickItemWithId>,
    text = "",
    sortBy: SortBy = "mtime"
): Promise<void> {
    quickPick.placeholder = `按 ${sortBy} 列表（输入过滤或按回车打开）`;
    quickPick.value = text;
    quickPick.busy = true;

    try {
        const issues = await getAllIssueMarkdowns({ sortBy });
        const items = issues.map(i => toItem(i));
        quickPick.items = items;
    } catch (e) {
        console.error("enterTimeMode error:", e);
        quickPick.items = [];
    } finally {
        quickPick.busy = false;
    }
}

export async function handleTimeModeValueChange(
    quickPick: vscode.QuickPick<QuickPickItemWithId>,
    value: string,
    sortBy: SortBy = "mtime"
): Promise<void> {
    try {
        const issues = await getAllIssueMarkdowns({ sortBy });
        const keywords = (value || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
        const filtered = issues.filter(i => {
            if (keywords.length === 0) return true;
            const hay = `${i.title} ${i.uri.fsPath}`.toLowerCase();
            return keywords.every(k => hay.includes(k));
        }).map(i => toItem(i));
        quickPick.items = filtered;
    } catch (e) {
        console.error("handleTimeModeValueChange error:", e);
        quickPick.items = [];
    }
}

/**
 * 选择确认：根据选中的 issue markdown 文件查找对应的 IssueNode：
 * - 0 个 node：打开文本编辑器
 * - 1 个 node：使用 openIssueNode 打开
 * - 多于 1 个 node：展示一个临时 quickPick 列表让用户选择要打开的 IssueNode
 */
export async function handleTimeModeAccept(
    selected: QuickPickItemWithId,
    value: string,
    sortBy: SortBy = "mtime"
): Promise<boolean> {
    const fileUri = (selected.fileUri as vscode.Uri) || undefined;
    if (!fileUri) return false;

    try {
        const nodes = await getIssueNodesByUri(fileUri);
        if (!nodes || nodes.length === 0) {
            const doc = await vscode.workspace.openTextDocument(fileUri);
            await vscode.window.showTextDocument(doc, { preview: true });
            return true;
        }

        if (nodes.length === 1) {
            await openIssueNode(nodes[0].id);
            return true;
        }

        // 多个 IssueNode，展示选择
        const items = await Promise.all(nodes.map(async n => ({
            label: getIssueMarkdownTitleFromCache(n.filePath),
            description: n.filePath,
            id: n.id,
        } as QuickPickItemWithId)));

        const pick = await vscode.window.showQuickPick(items, { placeHolder: "选择要打开的 Issue 节点" });
        if (!pick) return true;
        await openIssueNode(pick.id || "");
        return true;
    } catch (e) {
        console.error("handleTimeModeAccept error:", e);
        return false;
    }
}

export default {};
