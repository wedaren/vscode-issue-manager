import * as vscode from "vscode";
import { QuickPickItemWithId } from "./unifiedQuickOpen.types";
import { getCurrentEditorIssueId } from "./unifiedQuickOpen.issue";
import { createAndOpenIssue } from "./createAndOpenIssue";
import { HistoryService } from "./unifiedQuickOpen.history.service";
import { getAllChatRoles, createConversation } from "../llmChat/llmChatDataManager";

// ─── 构建列表项 ─────────────────────────────────────────────

async function buildCreateInitialItems(): Promise<QuickPickItemWithId[]> {
    const currentEditorIssueId = await getCurrentEditorIssueId();

    const direct: QuickPickItemWithId = {
        label: '新建问题',
        description: currentEditorIssueId ? "在当前问题下创建子问题并打开" : "直接创建并打开",
        alwaysShow: true,
        execute: async (input?: string) => {
            await createAndOpenIssue(input?.trim() || undefined, currentEditorIssueId || undefined);
        },
    };

    return [direct];
}

function buildRoleItems(): QuickPickItemWithId[] {
    const roles = getAllChatRoles();
    if (roles.length === 0) { return []; }

    return roles
        .filter(r => r.roleStatus !== 'disabled')
        .map(r => ({
            label: `$(${r.avatar || 'comment-discussion'}) ${r.name}`,
            description: '新建对话',
            detail: r.description,
            alwaysShow: true,
            execute: async (_input?: string) => {
                const uri = await createConversation(r.id);
                if (!uri) {
                    vscode.window.showErrorMessage('创建对话失败');
                    return;
                }
                // 打开对话并刷新视图
                await vscode.commands.executeCommand('issueManager.llmChat.openConversation', r.id, uri);
                vscode.commands.executeCommand('issueManager.refreshAllViews');
            },
        }));
}

// ─── 更新列表 ────────────────────────────────────────────────

async function updateCreateModeItems(
    quickPick: vscode.QuickPick<QuickPickItemWithId>,
    value: string
): Promise<void> {
    const initial = await buildCreateInitialItems();
    const roleItems = buildRoleItems();
    quickPick.items = [...initial, ...roleItems];
}

// ─── 导出接口 ────────────────────────────────────────────────

export async function enterCreateMode(
    quickPick: vscode.QuickPick<QuickPickItemWithId>,
    text = ""
): Promise<void> {
    quickPick.placeholder = "新建问题模式：输入标题新建问题，或选择角色新建对话";
    quickPick.value = text;
    quickPick.busy = true;
    await updateCreateModeItems(quickPick, text || "");
    quickPick.busy = false;
}

export async function handleCreateModeValueChange(
    quickPick: vscode.QuickPick<QuickPickItemWithId>,
    value: string
): Promise<void> {
    await updateCreateModeItems(quickPick, value || "");
}

export async function handleCreateModeAccept(
    selected: QuickPickItemWithId,
    value: string,
    historyService?: HistoryService
): Promise<boolean> {
    if (selected.execute) {
        await selected.execute(value);
        if (historyService && value) {
            await historyService.addHistory('create', value);
        }
        return true;
    }
    return false;
}
