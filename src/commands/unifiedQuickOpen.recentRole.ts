// 角色列表模式：列出所有 LLM 角色配置，按最近使用时间排序，选中后显示次级菜单（打开配置/新建对话）。
// 展示角色名、模型、工具集、状态等信息，方便用户快速过滤定位目标角色。
// 排序依据为角色下各对话的最大 mtime（内存操作，无额外 I/O）。

import * as vscode from "vscode";
import { QuickPickItemWithId, filterItems } from "./unifiedQuickOpen.types";
import { getAllChatRoles, getConversationsForRole } from "../llmChat/llmChatDataManager";

/** 全量角色条目缓存，用于值变化时本地过滤 */
let _allRoleItems: QuickPickItemWithId[] = [];

/** 角色状态对应的图标后缀 */
const STATUS_ICON: Record<string, string> = {
    disabled: '  $(circle-slash)',
    testing: '  $(beaker)',
};

/**
 * 进入角色列表模式，加载所有角色。
 * @param quickPick - 当前 QuickPick 实例
 * @param searchText - 初始搜索文本
 */
export function enterRecentRoleMode(
    quickPick: vscode.QuickPick<QuickPickItemWithId>,
    searchText = ""
): void {
    quickPick.placeholder = "搜索 LLM 角色（支持角色名 / 模型 / 工具集）";
    quickPick.items = [];

    // 按最近对话 mtime 排序（全内存，无 I/O）
    const roles = getAllChatRoles();
    const rolesWithMtime = roles.map(r => {
        const convos = getConversationsForRole(r.id);
        const maxMtime = convos.length > 0 ? Math.max(...convos.map(c => c.mtime)) : 0;
        return { role: r, maxMtime };
    });
    rolesWithMtime.sort((a, b) => b.maxMtime - a.maxMtime);

    _allRoleItems = rolesWithMtime.map(({ role: r }) => {
        const statusIcon = r.roleStatus ? (STATUS_ICON[r.roleStatus] ?? '') : '';

        // description：模型 + 工具集摘要
        const toolParts: string[] = [];
        if (r.toolSets.length > 0) { toolParts.push(r.toolSets.join(', ')); }
        if (r.mcpServers && r.mcpServers.length > 0) {
            toolParts.push(`mcp:${r.mcpServers.length}`);
        }
        const descParts = [r.modelFamily, toolParts.join(' ')].filter(Boolean);

        // detail：skills + 定时器 + 状态标注
        const detailParts: string[] = [];
        if (r.skills && r.skills.length > 0) {
            detailParts.push(`skills: ${r.skills.join(', ')}`);
        }
        if (r.timerEnabled || r.timerCron) {
            detailParts.push(r.timerCron ? `cron: ${r.timerCron}` : '定时器已启用');
        }
        if (r.autonomous) { detailParts.push('自主模式'); }
        if (r.roleStatus === 'disabled') { detailParts.push('已禁用'); }
        else if (r.roleStatus === 'testing') { detailParts.push('测试中'); }

        return {
            label: `$(${r.avatar || 'hubot'}) ${r.name}${statusIcon}`,
            description: descParts.join('  ·  ') || undefined,
            detail: detailParts.length > 0 ? detailParts.join('  ·  ') : undefined,
            fileUri: r.uri,
            id: r.id,
        };
    });

    quickPick.items = searchText ? filterItems(_allRoleItems, searchText) : _allRoleItems;
    if (quickPick.items.length > 0) {
        quickPick.activeItems = [quickPick.items[0]];
    }
}

/**
 * 处理角色列表模式下的输入变化，本地过滤已加载条目。
 * @param quickPick - 当前 QuickPick 实例
 * @param value - 当前输入值
 */
export function handleRecentRoleModeValueChange(
    quickPick: vscode.QuickPick<QuickPickItemWithId>,
    value: string
): void {
    quickPick.items = value ? filterItems(_allRoleItems, value) : _allRoleItems;
    if (quickPick.items.length > 0) {
        quickPick.activeItems = [quickPick.items[0]];
    }
}

/**
 * 处理角色列表模式下的条目确认，显示二级操作菜单（打开最近对话 / 打开配置文件 / 新建对话）。
 * @param selected - 用户选中的条目
 * @returns 是否已处理
 */
export async function handleRecentRoleModeAccept(
    selected: QuickPickItemWithId,
): Promise<boolean> {
    const uri = selected.fileUri;
    const roleId = selected.id;
    if (!uri || !roleId) { return false; }

    interface ActionItem extends vscode.QuickPickItem { action: 'latest' | 'open' | 'new' }
    const action = await vscode.window.showQuickPick<ActionItem>([
        { label: '$(history) 打开最近对话', action: 'latest' },
        { label: '$(file-code) 打开配置文件', action: 'open' },
        { label: '$(add) 新建对话', action: 'new' },
    ], { placeHolder: `角色：${selected.label}` });

    if (!action) { return false; }

    try {
        if (action.action === 'latest') {
            const convos = getConversationsForRole(roleId);  // 已按 mtime 降序排列
            if (convos.length === 0) {
                vscode.window.showInformationMessage('该角色暂无对话，请先新建对话');
                return false;
            }
            const doc = await vscode.workspace.openTextDocument(convos[0].uri);
            const editor = await vscode.window.showTextDocument(doc, { preview: false });
            const lastLine = editor.document.lineCount - 1;
            const lastChar = editor.document.lineAt(lastLine).text.length;
            const endPos = new vscode.Position(lastLine, lastChar);
            editor.selection = new vscode.Selection(endPos, endPos);
            editor.revealRange(new vscode.Range(endPos, endPos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        } else if (action.action === 'open') {
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, { preview: false });
        } else {
            await vscode.commands.executeCommand('issueManager.llmChat.newConversation', roleId);
        }
        return true;
    } catch (err) {
        vscode.window.showErrorMessage(`操作失败：${String(err)}`);
        return false;
    }
}
