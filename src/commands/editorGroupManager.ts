import * as vscode from 'vscode';
import { LLMService } from '../llm/LLMService';
import {
    getTabLabel, getTabUri, getGroupNames, setGroupNames,
    rebuildNamesExcluding, formatGroupLabel, formatRelativeTime,
    getFileMtimes, moveTabsToColumn,
} from './editorGroupUtils';

// ─── 工具函数 ───────────────────────────────────────────────

interface GroupPickItem extends vscode.QuickPickItem {
    tabGroup: vscode.TabGroup;
}

/** 构建编辑器组 QuickPick 列表项 */
function buildGroupItems(groups: readonly vscode.TabGroup[], names: Record<number, string>): GroupPickItem[] {
    return groups.map((group, index) => {
        const tabLabels = group.tabs.map(getTabLabel).join(', ');
        return {
            label: formatGroupLabel(group, index, names),
            description: `${group.tabs.length} 个标签页`,
            detail: tabLabels || '(空)',
            picked: group.isActive,
            tabGroup: group,
        };
    });
}

// ─── 1. 关闭编辑器组（多选） ────────────────────────────────

export async function closeEditorGroupsPick(context?: vscode.ExtensionContext): Promise<void> {
    const tabGroups = vscode.window.tabGroups.all;
    if (tabGroups.length <= 1) {
        vscode.window.showInformationMessage('当前只有一个编辑器组，无需关闭。');
        return;
    }

    const names = context ? getGroupNames(context) : {};
    const items = buildGroupItems(tabGroups, names);

    const selected = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        placeHolder: '选择要关闭的编辑器组（可多选）',
        title: '关闭编辑器组',
    });

    if (!selected || selected.length === 0) return;

    const groupsToClose = selected
        .map(s => s.tabGroup)
        .sort((a, b) => (b.viewColumn ?? 0) - (a.viewColumn ?? 0));

    // 在关闭前重建名称映射（关闭后 viewColumn 会重新编号）
    if (context) {
        const removedCols = new Set(groupsToClose.map(g => g.viewColumn ?? 0));
        await rebuildNamesExcluding(context, removedCols);
    }

    for (const group of groupsToClose) {
        await vscode.window.tabGroups.close(group);
    }
}

// ─── 2. 编辑器组总览（聚焦切换） ─────────────────────────────

export async function editorGroupOverview(context?: vscode.ExtensionContext): Promise<void> {
    const tabGroups = vscode.window.tabGroups.all;
    if (tabGroups.length === 0) {
        vscode.window.showInformationMessage('没有打开的编辑器组。');
        return;
    }

    const names = context ? getGroupNames(context) : {};

    interface OverviewPickItem extends vscode.QuickPickItem {
        uri?: vscode.Uri;
        viewColumn?: vscode.ViewColumn;
    }

    // 收集所有 URI 并批量获取 mtime
    const allUris: (vscode.Uri | undefined)[] = [];
    for (const group of tabGroups) {
        for (const tab of group.tabs) {
            allUris.push(getTabUri(tab));
        }
    }
    const mtimeMap = await getFileMtimes(allUris);

    const items: OverviewPickItem[] = [];

    for (let i = 0; i < tabGroups.length; i++) {
        const group = tabGroups[i];
        items.push({
            label: formatGroupLabel(group, i, names),
            kind: vscode.QuickPickItemKind.Separator,
        });

        for (const tab of group.tabs) {
            const label = getTabLabel(tab);
            const uri = getTabUri(tab);

            const tags: string[] = [];
            if (tab.isActive) { tags.push('活动'); }
            if (tab.isDirty) { tags.push('未保存'); }
            if (tab.isPinned) { tags.push('已固定'); }

            // 追加相对时间
            if (uri) {
                const mtime = mtimeMap.get(uri.toString());
                if (mtime) { tags.push(formatRelativeTime(mtime)); }
            }

            items.push({
                label: `$(file) ${label}`,
                description: tags.join(' · ') || undefined,
                detail: uri?.fsPath,
                uri,
                viewColumn: group.viewColumn,
            });
        }
    }

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: '选择要打开的文件',
        title: '编辑器组总览',
        matchOnDetail: true,
    });

    if (!selected?.uri) { return; }

    await vscode.window.showTextDocument(selected.uri, {
        viewColumn: selected.viewColumn,
        preserveFocus: false,
    });
}

// ─── 3. 移动当前编辑器到指定组 ────────────────────────────────

export async function moveEditorToGroup(context?: vscode.ExtensionContext): Promise<void> {
    const tabGroups = vscode.window.tabGroups.all;
    const names = context ? getGroupNames(context) : {};

    interface MovePickItem extends vscode.QuickPickItem {
        action: 'existing' | 'new';
        viewColumn?: vscode.ViewColumn;
    }

    const items: MovePickItem[] = [];

    // 现有组（排除当前活动组）
    tabGroups.forEach((group, index) => {
        if (group.isActive) return;
        const tabLabels = group.tabs.map(getTabLabel).join(', ');
        items.push({
            label: formatGroupLabel(group, index, names),
            description: `${group.tabs.length} 个标签页`,
            detail: tabLabels || '(空)',
            action: 'existing',
            viewColumn: group.viewColumn,
        });
    });

    // 分隔
    items.push({ label: '新建', kind: vscode.QuickPickItemKind.Separator, action: 'new' } as MovePickItem);
    items.push({
        label: '$(add) 新建编辑器组（右侧）',
        action: 'new',
    });

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: '选择目标编辑器组',
        title: '移动当前编辑器到...',
    });

    if (!selected) return;

    if (selected.action === 'new') {
        await vscode.commands.executeCommand('workbench.action.moveEditorToNextGroup');
    } else if (selected.viewColumn !== undefined) {
        const col = selected.viewColumn;
        const cmdMap: Record<number, string> = {
            1: 'workbench.action.moveEditorToFirstGroup',
            2: 'workbench.action.moveEditorToSecondGroup',
            3: 'workbench.action.moveEditorToThirdGroup',
            4: 'workbench.action.moveEditorToFourthGroup',
            5: 'workbench.action.moveEditorToFifthGroup',
            6: 'workbench.action.moveEditorToSixthGroup',
            7: 'workbench.action.moveEditorToSeventhGroup',
            8: 'workbench.action.moveEditorToEighthGroup',
        };
        const cmd = cmdMap[col];
        if (cmd) {
            await vscode.commands.executeCommand(cmd);
        }
    }
}

// ─── 4. 合并编辑器组 ─────────────────────────────────────────

/** 将指定编辑器组合并到当前活动组，并清理名称映射 */
async function mergeGroupToActive(context: vscode.ExtensionContext | undefined, sourceGroup: vscode.TabGroup): Promise<void> {
    const currentColumn = vscode.window.tabGroups.activeTabGroup.viewColumn;
    if (currentColumn !== undefined) {
        await moveTabsToColumn(sourceGroup, currentColumn);
    }
    // 在关闭前重建名称映射
    if (context) {
        const removedCol = sourceGroup.viewColumn ?? 0;
        await rebuildNamesExcluding(context, new Set([removedCol]));
    }
    try {
        await vscode.window.tabGroups.close(sourceGroup);
    } catch {
        // 组可能已经因为标签页全部移走而自动关闭
    }
}

export async function mergeEditorGroups(context?: vscode.ExtensionContext): Promise<void> {
    const tabGroups = vscode.window.tabGroups.all;
    if (tabGroups.length <= 1) {
        vscode.window.showInformationMessage('当前只有一个编辑器组，无需合并。');
        return;
    }

    interface MergePickItem extends vscode.QuickPickItem {
        action: 'all' | 'pick';
        tabGroup?: vscode.TabGroup;
    }

    const names = context ? getGroupNames(context) : {};
    const items: MergePickItem[] = [
        {
            label: '$(merge) 合并所有编辑器组',
            description: `将 ${tabGroups.length} 个组的标签页收拢到当前组`,
            action: 'all',
        },
    ];

    // 分隔
    items.push({ label: '选择要合并的组', kind: vscode.QuickPickItemKind.Separator, action: 'pick' } as MergePickItem);

    tabGroups.forEach((group, index) => {
        if (group.isActive) return;
        const tabLabels = group.tabs.map(getTabLabel).join(', ');
        items.push({
            label: formatGroupLabel(group, index, names),
            description: `${group.tabs.length} 个标签页`,
            detail: tabLabels || '(空)',
            action: 'pick',
            tabGroup: group,
        });
    });

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: '选择合并方式',
        title: '合并编辑器组',
    });

    if (!selected) return;

    if (selected.action === 'all') {
        // 合并全部：只保留当前活动组的名称
        if (context) {
            const activeCol = vscode.window.tabGroups.activeTabGroup.viewColumn ?? 1;
            const activeName = names[activeCol];
            const cleaned: Record<number, string> = {};
            if (activeName) { cleaned[1] = activeName; }
            await setGroupNames(context, cleaned);
        }
        await vscode.commands.executeCommand('workbench.action.joinAllGroups');
    } else if (selected.tabGroup) {
        await mergeGroupToActive(context, selected.tabGroup);
    }
}

// ─── 5. LLM 智能整理编辑器组 ────────────────────────────────

/** 构建 LLM 分组的基础 prompt */
function buildOrganizePrompt(fileList: string): string {
    return `你是一个编辑器窗口整理助手。用户当前打开了以下文件：

${fileList}

请将这些文件按主题/用途分组，以便用户更高效地工作。

规则：
1. 每组应该有一个简短的中文组名
2. 将相关文件归到同一组（如同一功能模块、同类型的配置文件、测试文件等）
3. 合理控制组数（2-5 组为宜）
4. 响应必须是严格的 JSON 格式，不要包含任何其他文字

响应格式：
{
  "groups": [
    { "name": "组名", "fileIndices": [0, 1, 2] },
    { "name": "另一组", "fileIndices": [3, 4] }
  ]
}`;
}

/** 调用 LLM 获取分组方案 */
async function requestLLMGrouping(
    messages: vscode.LanguageModelChatMessage[],
    title: string,
): Promise<string | undefined> {
    const result = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title,
            cancellable: true,
        },
        async (_progress, token) => {
            const abort = new AbortController();
            token.onCancellationRequested(() => abort.abort());
            return LLMService.chat(messages, { signal: abort.signal });
        }
    );
    return result?.text;
}

/** 解析 LLM 返回的 JSON 分组方案 */
function parseLLMPlan(text: string): { groups: { name: string; fileIndices: number[] }[] } | null {
    try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return null;
        const plan = JSON.parse(jsonMatch[0]);
        if (!plan.groups || !Array.isArray(plan.groups)) return null;
        return plan;
    } catch {
        return null;
    }
}

/** 生成分组方案的预览文本 */
function buildPlanPreview(
    plan: { groups: { name: string; fileIndices: number[] }[] },
    allTabs: { label: string }[],
): string {
    return plan.groups
        .map(g => {
            const files = g.fileIndices
                .filter(i => i >= 0 && i < allTabs.length)
                .map(i => allTabs[i].label);
            return `【${g.name}】${files.join('、')}`;
        })
        .join('\n');
}

export async function organizeEditorGroupsWithLLM(context?: vscode.ExtensionContext): Promise<void> {
    const tabGroups = vscode.window.tabGroups.all;
    const allTabs: { label: string; uri?: vscode.Uri; groupIndex: number }[] = [];

    for (let i = 0; i < tabGroups.length; i++) {
        for (const tab of tabGroups[i].tabs) {
            const label = getTabLabel(tab);
            const uri = getTabUri(tab);
            allTabs.push({ label, uri, groupIndex: i });
        }
    }

    if (allTabs.length === 0) {
        vscode.window.showInformationMessage('没有打开的标签页。');
        return;
    }

    const fileList = allTabs
        .map((t, idx) => `${idx}. ${t.label}${t.uri ? ` (${t.uri.path})` : ''}`)
        .join('\n');

    // 初次请求
    const basePrompt = buildOrganizePrompt(fileList);
    const chatHistory: vscode.LanguageModelChatMessage[] = [
        vscode.LanguageModelChatMessage.User(basePrompt),
    ];

    let responseText = await requestLLMGrouping(chatHistory, 'LLM 正在分析标签页分组方案...');
    if (!responseText) return;

    // 确认 / 调整循环
    while (true) {
        const plan = parseLLMPlan(responseText);
        if (!plan) {
            vscode.window.showErrorMessage('LLM 返回的分组方案无法解析，请重试。');
            return;
        }

        const preview = buildPlanPreview(plan, allTabs);

        const choice = await vscode.window.showInformationMessage(
            `LLM 建议将标签页分为 ${plan.groups.length} 组，是否执行？`,
            { modal: true, detail: preview },
            '执行',
            '调整',
        );

        if (choice === '执行') {
            // 执行分组方案
            const viewColumns: vscode.ViewColumn[] = [
                vscode.ViewColumn.One, vscode.ViewColumn.Two, vscode.ViewColumn.Three,
                vscode.ViewColumn.Four, vscode.ViewColumn.Five, vscode.ViewColumn.Six,
                vscode.ViewColumn.Seven, vscode.ViewColumn.Eight, vscode.ViewColumn.Nine,
            ];

            if (context) {
                const names: Record<number, string> = {};
                for (let gi = 0; gi < plan.groups.length; gi++) {
                    const col = (viewColumns[gi] ?? 9) as number;
                    names[col] = plan.groups[gi].name;
                }
                await setGroupNames(context, names);
            }

            await vscode.commands.executeCommand('workbench.action.closeAllEditors');

            for (let gi = 0; gi < plan.groups.length; gi++) {
                const targetColumn = viewColumns[gi] ?? vscode.ViewColumn.Nine;
                const group = plan.groups[gi];
                for (const fileIdx of group.fileIndices) {
                    const tab = allTabs[fileIdx];
                    if (!tab?.uri) continue;
                    await vscode.window.showTextDocument(tab.uri, {
                        viewColumn: targetColumn,
                        preserveFocus: true,
                        preview: false,
                    });
                }
            }

            await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
            vscode.window.showInformationMessage(`已按 LLM 方案将标签页整理为 ${plan.groups.length} 个编辑器组。`);
            return;
        }

        if (choice === '调整') {
            const feedback = await vscode.window.showInputBox({
                prompt: '请描述你希望如何调整分组方案',
                placeHolder: '例如：把配置文件单独一组、减少到 2 组、按页面路由分组...',
            });

            if (!feedback) return; // 取消则退出整个流程

            // 将上一轮 LLM 回复和用户反馈追加到对话历史
            chatHistory.push(vscode.LanguageModelChatMessage.Assistant(responseText));
            chatHistory.push(vscode.LanguageModelChatMessage.User(
                `用户对上述分组方案不满意，请根据以下反馈重新分组：\n\n${feedback}\n\n请保持相同的 JSON 响应格式。`,
            ));

            const newResponse = await requestLLMGrouping(chatHistory, 'LLM 正在重新分析分组方案...');
            if (!newResponse) return;

            responseText = newResponse;
            continue; // 回到循环顶部，展示新方案
        }

        // 取消（choice 为 undefined）
        return;
    }
}

// ─── 7. 树视图内联操作 ──────────────────────────────────────

/** 从树视图关闭指定编辑器组 */
async function closeEditorGroupFromTree(context: vscode.ExtensionContext, item: unknown): Promise<void> {
    const tabGroup = (item as any)?.tabGroup as vscode.TabGroup | undefined;
    if (!tabGroup) { return; }
    const removedCol = tabGroup.viewColumn ?? 0;
    await rebuildNamesExcluding(context, new Set([removedCol]));
    await vscode.window.tabGroups.close(tabGroup);
}

/** 从树视图关闭指定标签页 */
async function closeTabFromTree(item: unknown): Promise<void> {
    const tab = (item as any)?.tab as vscode.Tab | undefined;
    if (tab) {
        await vscode.window.tabGroups.close(tab);
    }
}

/** 从树视图重命名编辑器组 */
async function renameGroupFromTree(context: vscode.ExtensionContext, item: unknown): Promise<void> {
    const tabGroup = (item as any)?.tabGroup as vscode.TabGroup | undefined;
    if (!tabGroup) return;

    const col = tabGroup.viewColumn ?? 1;
    const names = getGroupNames(context);
    const currentName = names[col] ?? '';

    const newName = await vscode.window.showInputBox({
        prompt: `为编辑器组设置名称（留空则清除）`,
        value: currentName,
        placeHolder: '例如：参考资料、主编辑、测试文件',
    });

    if (newName === undefined) return;

    if (newName === '') {
        delete names[col];
    } else {
        names[col] = newName;
    }
    await setGroupNames(context, names);
    await vscode.commands.executeCommand('issueManager.editorGroup.refresh');
}

// ─── 注册所有编辑器组管理命令 ─────────────────────────────────

export function registerEditorGroupCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        // QuickPick 命令
        vscode.commands.registerCommand('issueManager.closeEditorGroups', () => closeEditorGroupsPick(context)),
        vscode.commands.registerCommand('issueManager.editorGroupOverview', () => editorGroupOverview(context)),
        vscode.commands.registerCommand('issueManager.moveEditorToGroup', () => moveEditorToGroup(context)),
        vscode.commands.registerCommand('issueManager.mergeEditorGroups', () => mergeEditorGroups(context)),
        vscode.commands.registerCommand('issueManager.organizeEditorGroupsWithLLM', () => organizeEditorGroupsWithLLM(context)),
        // 树视图内联操作
        vscode.commands.registerCommand('issueManager.editorGroup.close', (item) => closeEditorGroupFromTree(context, item)),
        vscode.commands.registerCommand('issueManager.editorGroup.closeTab', closeTabFromTree),
        vscode.commands.registerCommand('issueManager.editorGroup.rename', (item) => renameGroupFromTree(context, item)),
        vscode.commands.registerCommand('issueManager.editorGroup.mergeToActive', (item) => {
            const tabGroup = (item as any)?.tabGroup as vscode.TabGroup | undefined;
            if (!tabGroup) { return; }
            return mergeGroupToActive(context, tabGroup);
        }),
    );
}
