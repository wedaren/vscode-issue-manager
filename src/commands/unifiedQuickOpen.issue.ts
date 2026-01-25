import * as vscode from "vscode";
import { QuickPickItemWithId } from "./unifiedQuickOpen.types";
import { getFlatTree, getIssueNodeById } from "../data/issueTreeManager";
import { getIssueIdFromUri } from "../utils/uriUtils";
import { buildIssueActionItems, ActionQuickPickItem } from "./selectOrCreateIssue";
import { openIssueNode } from "./openIssueNode";
import { HistoryService } from "./unifiedQuickOpen.history.service";

/**
 * 将 selectOrCreateIssue 返回的 actionItems 转换为 QuickPickItemWithId
 */
function convertActionItems(
    items: Array<ActionQuickPickItem>,
    currentEditorIssueId?: string
): QuickPickItemWithId[] {
    return items.map(ai =>
        ({
            label: ai.label,
            description: ai.description,
            alwaysShow: ai.alwaysShow,
            execute: async (input?: string) => {
                try {
                    const id = await ai.execute(input || "", { parentId: currentEditorIssueId });
                    // 对于后台创建项（create-background）保持不自动打开
                    if (id && ai.action !== 'create-background') {
                        openIssueNode(id || "");
                    }
                } catch (e) {
                    console.error("action item execute failed:", e);
                }
            },
        } as QuickPickItemWithId)
    );
}

/**
 * 获取所有问题的扁平化列表项
 */
export async function getIssueItems(): Promise<QuickPickItemWithId[]> {
    const flatNodes = await getFlatTree();
    return flatNodes.map(node => {
        let description = "";
        if (node.parentPath && node.parentPath.length > 0) {
            const parentTitles = node.parentPath.map(n => n.title);
            description = ["", ...parentTitles].join(" / ");
        }
        const id = node.id;
        return {
            label: node.title,
            description,
            id,
            execute: async () => {
                try {
                    const n = await getIssueNodeById(id || "");
                    await vscode.commands.executeCommand(
                        "issueManager.openAndRevealIssue",
                        n,
                        "overview"
                    );
                } catch (e) {
                    await vscode.commands.executeCommand(
                        "issueManager.searchIssues",
                        "overview"
                    );
                }
            },
        } as QuickPickItemWithId;
    });
}

/**
 * 获取当前活动编辑器对应的 IssueId（并验证是否存在对应 IssueNode）
 */
export async function getCurrentEditorIssueId(): Promise<string | undefined> {
    try {
        const activeUri = vscode.window.activeTextEditor?.document?.uri;
        const id = getIssueIdFromUri(activeUri);
        const valid = !!(await getIssueNodeById(id || ""));
        return valid ? id : undefined;
    } catch (e) {
        return undefined;
    }
}

/**
 * 进入问题搜索模式，设置 QuickPick 的状态
 */
export async function enterIssueMode(
    quickPick: vscode.QuickPick<QuickPickItemWithId>,
    text = ""
): Promise<void> {
    quickPick.placeholder = "搜索或新建问题";
    quickPick.value = text;
    quickPick.busy = true;

    try {
        const currentEditorIssueId = await getCurrentEditorIssueId();
        const actionItems = await buildIssueActionItems(text || "", currentEditorIssueId);
        quickPick.items = convertActionItems(actionItems, currentEditorIssueId);
    } catch (e) {
        console.error("Failed to build issue items:", e);
        const issueItems = await getIssueItems();
        quickPick.items = issueItems;
    } finally {
        quickPick.busy = false;
    }
}

/**
 * 处理问题模式的值变化
 */
export async function handleIssueModeValueChange(
    quickPick: vscode.QuickPick<QuickPickItemWithId>,
    value: string
): Promise<void> {
    try {
        const currentEditorIssueId = await getCurrentEditorIssueId();
        const actionItems = await buildIssueActionItems(value, currentEditorIssueId);
        const converted = convertActionItems(actionItems, currentEditorIssueId);
        quickPick.items = converted;
    } catch (e) {
        console.error("issue mode build items failed:", e);
        const issueItems = await getIssueItems();
        quickPick.items = issueItems;
    }
}

/**
 * 处理问题模式的选择确认
 */
export async function handleIssueModeAccept(
    selected: QuickPickItemWithId,
    value: string,
    historyService?: HistoryService
): Promise<boolean> {
    // 记录历史
    const shouldRecord = value && value.trim();
    
    // 如果有 execute 回调，执行它
    if (selected.execute) {
        await selected.execute(value);
        if (historyService && shouldRecord) {
            await historyService.addHistory('issue', value);
        }
        return true;
    }
    
    // 兼容老字段：id
    if (selected.id) {
        try {
            const node = await getIssueNodeById(selected.id);
            await vscode.commands.executeCommand(
                "issueManager.openAndRevealIssue",
                node,
                "overview"
            );
            if (historyService && shouldRecord) {
                await historyService.addHistory('issue', value);
            }
            return true;
        } catch (e) {
            await vscode.commands.executeCommand(
                "issueManager.searchIssues",
                "overview"
            );
            return true;
        }
    }
    
    return false;
}
