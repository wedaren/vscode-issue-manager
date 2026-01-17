import * as vscode from "vscode";
import { getIssueDir } from "../config";
import { createIssueFileSilent, addIssueToTree } from "./issueFileUtils";
import { getFlatTree, FlatTreeNode, stripFocusedId } from "../data/issueTreeManager";
import { backgroundFillIssue } from "../llm/backgroundFill";
import { getIssueIdFromUri } from "../utils/uriUtils";

// 模块级的 QuickPick 项接口，供辅助函数与主函数共享
interface ActionQuickPickItem extends vscode.QuickPickItem {
    action: "create" | "create-background" | "open-existing";
    payload?: any;
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
            action: "open-existing",
            payload: n.id,
            alwaysShow: shouldShow || (activeIssueId && n.id === activeIssueId),
        } as ActionQuickPickItem;
    });
}

export async function selectOrCreateIssue(parentId?: string): Promise<string | null> {
    const issueDir = getIssueDir();
    if (!issueDir) {
        vscode.window.showErrorMessage("请先配置 issue 目录 (issueManager.issueDir)。");
        vscode.commands.executeCommand("workbench.action.openSettings", "issueManager.issueDir");
        return null;
    }

    const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem>();
    quickPick.placeholder = "输入要创建的问题标题，或选择已有节点...";
    quickPick.canSelectMany = false;
    quickPick.matchOnDescription = true;


    quickPick.onDidChangeValue(async value => {
        const v = value || "";
        const direct: ActionQuickPickItem = {
            label: v || "新问题标题",
            description: "直接创建并打开",
            alwaysShow: true,
            action: "create",
            payload: v || "新问题标题",
        };
        const background: ActionQuickPickItem = {
            label: v || "新问题标题（后台）",
            description: "后台创建并由 AI 填充（不打开）",
            alwaysShow: true,
            action: "create-background",
            payload: v || "新问题标题",
        };

        const flatItems = await buildIssueQuickPickItems(v);

        // 当用户没有输入内容时，默认只显示按最近访问排序的已有项；当有输入时，将新问题项放到最前
        if (v.trim().length === 0) {
            quickPick.items = flatItems;
        } else {
            quickPick.items = [direct, background, ...flatItems];
        }
    });
    
    const initialItems = await buildIssueQuickPickItems("");
    quickPick.items = initialItems;
    quickPick.show();

    // 包装为 Promise，以便在 QuickPick 操作完成后返回新建或选中问题的 id
    const result = await new Promise<string | null>(resolve => {
        quickPick.onDidAccept(async () => {
            const sel = quickPick.selectedItems[0] as ActionQuickPickItem | undefined;
            const input = quickPick.value || (sel && sel.label) || "";
            if (!sel) {
                // 直接按 Enter，静默创建并返回 id（不在此处打开）
                if (input) {
                    const uri = await createIssueFileSilent(input);
                    if (uri) {
                        const nodes = await addIssueToTree([uri], parentId, true);
                        if (nodes && nodes.length > 0) {
                            resolve(stripFocusedId(nodes[0].id));
                            quickPick.dispose();
                            return;
                        }
                    }
                }
                quickPick.dispose();
                resolve(null);
                return;
            }

            // 使用 action 字段区分操作
            switch (sel.action) {
                case "create": {
                    const title = sel.payload || input || sel.label;
                    const uri = await createIssueFileSilent(title);
                    if (uri) {
                        const nodes = await addIssueToTree([uri], parentId, false);
                        if (nodes && nodes.length > 0) {
                            resolve(stripFocusedId(nodes[0].id));
                            break;
                        }
                    }
                    resolve(null);
                    break;
                }
                case "create-background": {
                    const title = sel.payload || input || sel.label.replace("（后台）", "");
                    const uri = await createIssueFileSilent(title);
                    if (uri) {
                        const nodes = await addIssueToTree([uri], parentId, false);
                        if (nodes && nodes.length > 0) {
                            // 启动后台填充（不阻塞 UI）
                            backgroundFillIssue(uri, title, { timeoutMs: 60000 })
                                .then(() => {})
                                .catch(() => {});
                            resolve(stripFocusedId(nodes[0].id));
                            break;
                        }
                    }
                    resolve(null);
                    break;
                }
                case "open-existing": {
                    resolve(sel.payload as string);
                    break;
                }
                default: {
                    resolve(null);
                }
            }

            quickPick.dispose();
        });

        quickPick.onDidHide(() => {
            quickPick.dispose();
            resolve(null);
        });
    });

    return result;
}
