import * as vscode from 'vscode';
import {
    getTabUri, rebuildNamesExcluding,
} from './editorGroupUtils';

/**
 * 编辑器组命令：关闭其他编辑组与仅保留当前活动编辑器
 */
export function registerEditorGroupCommands(
    context: vscode.ExtensionContext,
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.editorGroup.closeOtherGroups', async () => {
            const groups = vscode.window.tabGroups.all;
            const active = groups.find(g => g.isActive);
            if (!active) { return; }

            const toCloseGroups = groups.filter(g => !g.isActive);
            if (toCloseGroups.length === 0) {
                void vscode.window.showInformationMessage('没有其他编辑组需要关闭。');
                return;
            }

            // 收集待关闭标签的 uri 和脏文件
            const urisToClose: vscode.Uri[] = [];
            for (const g of toCloseGroups) {
                for (const t of g.tabs) {
                    const u = getTabUri(t);
                    if (u) urisToClose.push(u);
                }
            }

            // 找到与这些 uri 对应的已打开文档中未保存的文档
            const dirtyDocs = vscode.workspace.textDocuments.filter(d => d.isDirty && urisToClose.some(u => u.toString() === d.uri.toString()));

            const choice = dirtyDocs.length > 0
                ? await vscode.window.showInformationMessage(
                    `有 ${dirtyDocs.length} 个未保存文件来自其他组，如何处理？`,
                    { modal: true },
                    '保存并关闭', '强制关闭', '取消',
                )
                : '保存并关闭';

            if (!choice || choice === '取消') { return; }
            if (choice === '保存并关闭') {
                await Promise.all(dirtyDocs.map(d => d.save()));
            }

            // 直接关闭其它组（使用 Tab API 关闭组，避免在活动组打开大量文件导致闪烁）
            const removedColumns = new Set<number>();
            for (const g of toCloseGroups) {
                const col = g.viewColumn ?? 0;
                if (col) removedColumns.add(col);
                try {
                    await vscode.window.tabGroups.close(g);
                } catch (e) {
                    // 退回到逐个关闭组内标签的方式
                    for (const t of g.tabs) {
                        try { await vscode.window.tabGroups.close(t); } catch { /* ignore */ }
                    }
                }
            }

            // 重新映射组名称（移除已关闭组）
            await rebuildNamesExcluding(context, removedColumns);
            void vscode.window.showInformationMessage('已关闭其他编辑组。');
        }),

        vscode.commands.registerCommand('issueManager.editorGroup.keepOnlyActiveEditor', async () => {
            // 在当前活动组仅保留活动标签，并关闭其它组的所有标签
            const groups = vscode.window.tabGroups.all;
            const activeGroup = groups.find(g => g.isActive);
            if (!activeGroup) { return; }

            // 当前组中要关闭的标签（非活动标签）
            const toCloseInActive = activeGroup.tabs.filter(t => !t.isActive);
            const otherGroups = groups.filter(g => !g.isActive);

            const urisToClose: vscode.Uri[] = [];
            for (const t of toCloseInActive) {
                const u = getTabUri(t); if (u) urisToClose.push(u);
            }
            for (const g of otherGroups) {
                for (const t of g.tabs) {
                    const u = getTabUri(t); if (u) urisToClose.push(u);
                }
            }

            const dirtyDocs = vscode.workspace.textDocuments.filter(d => d.isDirty && urisToClose.some(u => u.toString() === d.uri.toString()));
            const choice = dirtyDocs.length > 0
                ? await vscode.window.showInformationMessage(
                    `将关闭 ${urisToClose.length} 个编辑器（含 ${dirtyDocs.length} 个未保存文件），如何处理？`,
                    { modal: true },
                    '保存并关闭', '强制关闭', '取消',
                )
                : '保存并关闭';
            if (!choice || choice === '取消') { return; }
            if (choice === '保存并关闭') {
                await Promise.all(dirtyDocs.map(d => d.save()));
            }

            // 关闭当前组中非活动标签（直接关闭 tab，避免切换焦点）
            for (const t of toCloseInActive) {
                try { await vscode.window.tabGroups.close(t); } catch { /* ignore */ }
            }

            // 关闭其它组（优先关闭整个组，失败时逐个关闭其标签）
            const removedColumns = new Set<number>();
            for (const g of otherGroups) {
                const col = g.viewColumn ?? 0; if (col) removedColumns.add(col);
                try {
                    await vscode.window.tabGroups.close(g);
                } catch {
                    for (const t of g.tabs) {
                        try { await vscode.window.tabGroups.close(t); } catch { /* ignore */ }
                    }
                }
            }

            await rebuildNamesExcluding(context, removedColumns);
            void vscode.window.showInformationMessage('已仅保留当前活动编辑器。');
        }),
    );
}
