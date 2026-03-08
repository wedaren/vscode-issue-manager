import * as vscode from 'vscode';

export const GROUP_NAMES_KEY = 'issueManager.editorGroupNames';

/** 提取标签页关联的 URI（支持文本和 Notebook） */
export function getTabUri(tab: vscode.Tab): vscode.Uri | undefined {
    if (tab.input instanceof vscode.TabInputText) { return tab.input.uri; }
    if (tab.input instanceof vscode.TabInputNotebook) { return tab.input.uri; }
    return undefined;
}

/** 获取标签页的显示名称 */
export function getTabLabel(tab: vscode.Tab): string {
    const uri = getTabUri(tab);
    if (uri) { return uri.path.split('/').pop() ?? '未命名'; }
    return tab.label;
}

/** 读取持久化的编辑器组名称映射 */
export function getGroupNames(context: vscode.ExtensionContext): Record<number, string> {
    return context.workspaceState.get<Record<number, string>>(GROUP_NAMES_KEY) ?? {};
}

/** 保存编辑器组名称映射 */
export async function setGroupNames(context: vscode.ExtensionContext, names: Record<number, string>): Promise<void> {
    await context.workspaceState.update(GROUP_NAMES_KEY, names);
}

/**
 * 在关闭/合并组之前调用：按存活组的顺序重建名称映射。
 * 因为 viewColumn 会在组被移除后重新编号，所以需要在关闭前
 * 记录存活组的名称顺序，按新的 viewColumn (1, 2, 3...) 重新映射。
 */
export async function rebuildNamesExcluding(
    context: vscode.ExtensionContext,
    removedColumns: Set<number>,
): Promise<void> {
    const oldNames = getGroupNames(context);
    const allGroups = vscode.window.tabGroups.all;
    const newNames: Record<number, string> = {};
    let newCol = 1;
    for (const group of allGroups) {
        const col = group.viewColumn ?? 0;
        if (!removedColumns.has(col)) {
            if (oldNames[col]) {
                newNames[newCol] = oldNames[col];
            }
            newCol++;
        }
    }
    await setGroupNames(context, newNames);
}

/** 为编辑器组生成显示标签 */
export function formatGroupLabel(group: vscode.TabGroup, index: number, names: Record<number, string>): string {
    const col = group.viewColumn ?? (index + 1);
    const customName = names[col];
    const activeTag = group.isActive ? ' (当前)' : '';
    return customName
        ? `${customName} (组 ${index + 1})${activeTag}`
        : `编辑器组 ${index + 1}${activeTag}`;
}

/** 将时间戳格式化为相对时间（如"3 分钟前"） */
export function formatRelativeTime(mtime: number): string {
    const diff = Date.now() - mtime;
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) { return '刚刚'; }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) { return `${minutes} 分钟前`; }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) { return `${hours} 小时前`; }
    const days = Math.floor(hours / 24);
    if (days < 30) { return `${days} 天前`; }
    const months = Math.floor(days / 30);
    return `${months} 个月前`;
}

/** 批量获取文件最后修改时间 */
export async function getFileMtimes(uris: (vscode.Uri | undefined)[]): Promise<Map<string, number>> {
    const mtimeMap = new Map<string, number>();
    const tasks = uris.map(async (uri) => {
        if (!uri) { return; }
        try {
            const stat = await vscode.workspace.fs.stat(uri);
            mtimeMap.set(uri.toString(), stat.mtime);
        } catch {
            // 虚拟文件或不可访问的文件，忽略
        }
    });
    await Promise.all(tasks);
    return mtimeMap;
}

/** 将一个编辑器组的所有标签页移动到目标列 */
export async function moveTabsToColumn(
    sourceGroup: vscode.TabGroup,
    targetColumn: vscode.ViewColumn,
): Promise<void> {
    for (const tab of sourceGroup.tabs) {
        const uri = getTabUri(tab);
        if (uri) {
            await vscode.window.showTextDocument(uri, {
                viewColumn: targetColumn,
                preserveFocus: true,
                preview: false,
            });
        }
    }
}
