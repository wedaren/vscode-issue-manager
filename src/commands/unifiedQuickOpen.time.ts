import * as vscode from "vscode";
import { QuickPickItemWithId } from "./unifiedQuickOpen.types";
import { getAllIssueMarkdowns, getIssueMarkdownTitleFromCache } from "../data/IssueMarkdowns";
import { getIssueNodesByUri } from "../data/issueTreeManager";
import { openIssueNode } from "./openIssueNode";

type SortBy = "mtime" | "ctime";

function toItem(m: { title: string; uri: vscode.Uri; mtime: number; ctime: number }, sortBy: SortBy) {
    const time = sortBy === "mtime" ? m.mtime : m.ctime;
    const desc = new Date(time).toLocaleString() || "Unknown";
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
        // 将按时间分组，使用 quick pick separator 来展示每个日期分组
        const items: QuickPickItemWithId[] = [];
        let lastGroup: string | null = null;
        for (const it of issues) {
            const time = sortBy === "mtime" ? it.mtime : it.ctime;
            let group: string;
            if (time) {
                const d = new Date(time);
                const today = new Date();
                if (
                    d.getFullYear() === today.getFullYear() &&
                    d.getMonth() === today.getMonth() &&
                    d.getDate() === today.getDate()
                ) {
                    group = "今天";
                } else {
                    group = d.toLocaleDateString();
                }
            } else {
                group = "Unknown";
            }
            if (group !== lastGroup) {
                items.push({ kind: vscode.QuickPickItemKind.Separator, label: group } as unknown as QuickPickItemWithId);
                lastGroup = group;
            }
            items.push(toItem(it, sortBy));
        }
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
    const fileUri = selected.fileUri;
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
            description: n.parent?.map(p => getIssueMarkdownTitleFromCache(p.filePath)).join(' > '),
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
