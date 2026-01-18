import * as vscode from "vscode";
import { getIssueDir } from "../config";
import { createIssueFileSilent, addIssueToTree } from "./issueFileUtils";
import { getFlatTree } from "../data/issueTreeManager";
import type { QuickPick } from "vscode";
import { backgroundFillIssue } from "../llm/backgroundFill";
import { getIssueIdFromUri } from "../utils/uriUtils";

export interface ActionQuickPickItem extends vscode.QuickPickItem {
    action: "create" | "create-background" | "open-existing";
    // 执行器：在用户确认该项时调用，返回选中或新建的 issue id 或 null
    // 签名为 (input, ctx?) 以便需要时获得额外上下文（例如 parentId、quickPick）
    execute: (
        input: string,
        ctx?: { parentId?: string; quickPick?: QuickPick<ActionQuickPickItem> }
    ) => Promise<string | null>;
}

/**
 * 构建按最近访问排序并高亮匹配词的 QuickPick 项
 */
export async function buildIssueQuickPickItems(value: string): Promise<ActionQuickPickItem[]> {
    const sortedFlat = (await getFlatTree()).sort((a, b) => (b.mtime || 0) - (a.mtime || 0));

    const words = (value || "")
        .split(" ")
        .map(k => (k || "").trim())
        .filter(k => k.length > 0);
    const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");

    // 尝试获取当前编辑器对应的 issueId（如果有），在函数顶部计算一次即可
    const activeIssueId = getIssueIdFromUri(vscode.window.activeTextEditor?.document?.uri);

    return sortedFlat.map(n => {
        const desc =
            n.parentPath && n.parentPath.length > 0
                ? "/" + n.parentPath.map(p => p.title).join(" / ")
                : undefined;

        const shouldShow =
            words.length > 1 && words.every(k => n.title.includes(k) || (desc && desc.includes(k)));

        let highlightedLabel = n.title;
        let highlightedDesc = desc;
        if (words.length > 0) {
            for (const k of words) {
                const re = new RegExp(escapeRegExp(k), "g");
                highlightedLabel = highlightedLabel.replace(re, `【${k}】`);
                if (highlightedDesc) {
                    highlightedDesc = highlightedDesc.replace(re, `【${k}】`);
                }
            }
        }
        let finalDesc = shouldShow ? highlightedDesc : desc;
        if (activeIssueId && n.id === activeIssueId) {
            finalDesc = finalDesc ? `${finalDesc} （当前编辑器）` : "当前编辑器";
        }

        return {
            label: shouldShow ? highlightedLabel : n.title,
            description: finalDesc,
            alwaysShow: shouldShow || (activeIssueId && n.id === activeIssueId),
            action: "open-existing",
            execute: async () => n.id || null,
        } as ActionQuickPickItem;
    });
}

/**
 * 构建问题相关的 action 项（包含直接创建 / 后台创建 / 打开已有项），
 * 便于在其他模块复用（例如 unifiedQuickOpen）。
 * 当输入为空时仅返回按最近访问排序的已有项；当有输入时将新建项放到最前。
 */
export async function buildIssueActionItems(
    value: string,
    parentId?: string
): Promise<ActionQuickPickItem[]> {
    const v = value || "";
    const flatItems = await buildIssueQuickPickItems(v);

    const direct: ActionQuickPickItem = {
        label: v || "新问题标题",
        description: "直接创建并打开",
        alwaysShow: true,
        action: "create",
        execute: async (input, ctx) => {
            const uri = await createIssueFileSilent(input);
            if (!uri) { return null; }
            const nodes = await addIssueToTree([uri], ctx?.parentId || parentId, false);
            if (nodes && nodes.length > 0) { return nodes[0].id; }
            return null;
        },
    };

    const background: ActionQuickPickItem = {
        label: v || "新问题标题（后台）",
        description: "后台创建并由 AI 填充（不打开）",
        alwaysShow: true,
        action: "create-background",
        execute: async (input, ctx) => {
            const uri = await createIssueFileSilent(input);
            if (!uri) { return null; }
            backgroundFillIssue(uri, input, { timeoutMs: 60000 }).catch(err => {
                console.error("Background fill issue failed:", err);
                vscode.window.showErrorMessage(`后台填充问题 '${input}' 失败。`);
            });
            const nodes = await addIssueToTree([uri], ctx?.parentId || parentId, false);
            if (nodes && nodes.length > 0) { return nodes[0].id; }
            return null;
        },
    };

    if (v.trim().length === 0) {
        return flatItems;
    }
    return [direct, background, ...flatItems];
}

export async function selectOrCreateIssue(parentId?: string): Promise<string | null> {
    const issueDir = getIssueDir();
    if (!issueDir) {
        vscode.window.showErrorMessage("请先配置 issue 目录 (issueManager.issueDir)。");
        vscode.commands.executeCommand("workbench.action.openSettings", "issueManager.issueDir");
        return null;
    }

    const quickPick = vscode.window.createQuickPick<ActionQuickPickItem>();
    quickPick.placeholder = "输入要创建的问题标题，或选择已有 IssueNode";
    quickPick.canSelectMany = false;
    quickPick.matchOnDescription = true;

    quickPick.onDidChangeValue(async value => {
        const v = value || "";
        const items = await buildIssueActionItems(v, parentId);
        quickPick.items = items;
    });

    const initialItems = await buildIssueActionItems("", parentId);
    quickPick.items = initialItems;
    quickPick.show();

    const result = await new Promise<string | null>(resolve => {
        quickPick.onDidAccept(async () => {
            const sel = quickPick.selectedItems[0] as ActionQuickPickItem | undefined;
            if (!sel) {
                quickPick.dispose();
                resolve(null);
                return;
            }

            try {
                const res = await sel.execute(quickPick.value, { parentId, quickPick });
                resolve(res);
            } catch (err) {
                // 因为这是 UI 交互，避免抛出到顶层；记录后返回 null
                console.error("selectOrCreateIssue execute error:", err);
                resolve(null);
            } finally {
                quickPick.dispose();
            }
        });

        quickPick.onDidHide(() => {
            quickPick.dispose();
            resolve(null);
        });
    });

    return result;
}
