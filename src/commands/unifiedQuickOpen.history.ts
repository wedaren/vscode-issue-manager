import * as vscode from "vscode";
import { QuickPickItemWithId, Mode, filterItems } from "./unifiedQuickOpen.types";
import { HistoryService } from "./unifiedQuickOpen.history.service";

/**
 * 模式配置映射（用于显示图标和标签）
 */
const MODE_DISPLAY: Record<Mode, { icon: string; label: string }> = {
    command: { icon: 'terminal', label: '命令模式' },
    issue: { icon: 'list-tree', label: '问题搜索' },
    llm: { icon: 'sparkle', label: 'LLM 模式' },
    create: { icon: 'add', label: '新建问题' },
    mtime: { icon: 'history', label: '按修改时间' },
    ctime: { icon: 'history', label: '按创建时间' },
    history: { icon: 'clock', label: '历史搜索' },
};

/**
 * 格式化时间戳为相对时间
 */
function formatRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
        return `${days} 天前`;
    }
    if (hours > 0) {
        return `${hours} 小时前`;
    }
    if (minutes > 0) {
        return `${minutes} 分钟前`;
    }
    return '刚刚';
}

/**
 * 进入历史模式
 */
export async function enterHistoryMode(
    quickPick: vscode.QuickPick<QuickPickItemWithId>,
    historyService: HistoryService,
    searchText = ""
): Promise<void> {
    quickPick.placeholder = "选择历史搜索或输入过滤（支持多词搜索）";
    quickPick.busy = false;

    const history = historyService.getHistory();
    
    if (history.length === 0) {
        quickPick.items = [{
            label: "$(info) 暂无历史记录",
            description: "在各模式下执行搜索后会自动记录",
        }];
        return;
    }

    // 创建清空历史按钮
    const clearButton: vscode.QuickInputButton = {
        iconPath: new vscode.ThemeIcon('trash'),
        tooltip: '清空所有历史记录',
    };

    // 转换为 QuickPick 项
    const historyItems: QuickPickItemWithId[] = history.map(item => {
        const modeInfo = MODE_DISPLAY[item.mode];
        const deleteButton: vscode.QuickInputButton = {
            iconPath: new vscode.ThemeIcon('close'),
            tooltip: '删除此记录',
        };

        return {
            label: `$(${modeInfo.icon}) ${item.value}`,
            description: `${modeInfo.label} · ${formatRelativeTime(item.timestamp)}`,
            detail: item.mode,
            buttons: [deleteButton],
            execute: async (_input, ctx) => {
                // 恢复到对应的模式和值
                if (ctx?.quickPick) {
                    ctx.quickPick.value = item.value;
                    // 触发模式切换需要在外部处理
                }
            },
            // 存储时间戳用于删除
            id: item.timestamp.toString(),
        } as QuickPickItemWithId & { id: string };
    });

    // 添加清空历史选项
    const clearItem: QuickPickItemWithId = {
        label: "$(trash) 清空所有历史记录",
        description: "删除所有历史搜索记录",
        execute: async () => {
            const confirm = await vscode.window.showWarningMessage(
                "确定要清空所有历史记录吗？",
                { modal: true },
                "确定"
            );
            if (confirm === "确定") {
                await historyService.clearHistory();
                vscode.window.showInformationMessage("历史记录已清空");
            }
        },
    };

    const allItems = [...historyItems, { label: "", kind: vscode.QuickPickItemKind.Separator }, clearItem];

    // 如果有搜索文本，进行过滤
    if (searchText && searchText.trim()) {
        const filtered = filterItems(allItems, searchText);
        quickPick.items = filtered;
        if (filtered.length > 0) {
            quickPick.activeItems = [filtered[0]];
        }
    } else {
        quickPick.items = allItems;
    }
}

/**
 * 处理历史模式值变化
 */
export async function handleHistoryModeValueChange(
    quickPick: vscode.QuickPick<QuickPickItemWithId>,
    historyService: HistoryService,
    value: string
): Promise<void> {
    await enterHistoryMode(quickPick, historyService, value);
}

/**
 * 处理历史模式确认
 * 返回值：{ handled, mode?, value? }
 * - handled: 是否已处理
 * - mode: 要切换到的模式
 * - value: 要填充的值
 */
export async function handleHistoryModeAccept(
    selected: QuickPickItemWithId,
    inputValue: string
): Promise<{ handled: boolean; mode?: Mode; value?: string }> {
    if (!selected) {
        return { handled: false };
    }

    // 如果是清空历史项，执行其 execute 函数
    if (selected.execute && selected.label.includes("清空")) {
        await selected.execute(inputValue);
        return { handled: true };
    }

    // 如果是历史项，返回模式和值供外部切换
    if (selected.detail && selected.label.startsWith("$(")) {
        const mode = selected.detail as Mode;
        // 从 label 中提取实际的搜索值（去除图标前缀）
        const value = selected.label.replace(/^\$\([^)]+\)\s*/, '');
        return { handled: true, mode, value };
    }

    return { handled: false };
}

/**
 * 处理历史项按钮点击（删除单条历史）
 */
export async function handleHistoryItemButton(
    item: QuickPickItemWithId,
    historyService: HistoryService,
    quickPick: vscode.QuickPick<QuickPickItemWithId>
): Promise<void> {
    if (item.id) {
        const timestamp = parseInt(item.id, 10);
        await historyService.removeHistory(timestamp);
        // 刷新列表
        await enterHistoryMode(quickPick, historyService);
    }
}
