import * as vscode from 'vscode';
import { getIssueDir } from '../config';
import { LLMService } from '../llm/LLMService';
import { createIssueFile, addIssueToTree } from './issueFileUtils';
import { readQuickPickData, writeQuickPickData, QuickPickPersistedData } from '../data/treeManager';
import { debounce } from '../utils/debounce';
// 在模块作用域内维护缓存和历史记录
export const SEARCH_HISTORY: string[] = [];
export const QUERY_RESULT_CACHE = new Map<string, vscode.QuickPickItem[]>();


// 初始化持久化数据
let quickPickLoaded = false;
async function ensureQuickPickLoaded() {
    if (quickPickLoaded) { return; }
    const data: QuickPickPersistedData = await readQuickPickData();
    SEARCH_HISTORY.length = 0;
    data.searchHistory.forEach(item => SEARCH_HISTORY.push(item));
    QUERY_RESULT_CACHE.clear();
    data.queryResultCache.forEach(([key, items]) => {
        QUERY_RESULT_CACHE.set(key, items);
    });
    quickPickLoaded = true;
    try {
      // 尝试读取持久化数据
      const data: QuickPickPersistedData = await readQuickPickData();
      SEARCH_HISTORY.length = 0;
      data.searchHistory.forEach(item => SEARCH_HISTORY.push(item));
      QUERY_RESULT_CACHE.clear();
      data.queryResultCache.forEach(([key, items]) => {
        QUERY_RESULT_CACHE.set(key, items);
      });
      quickPickLoaded = true;
    } catch (error) {
      console.error("加载 QuickPick 持久化数据失败:", error);
      // 回退到默认值，保证插件不会因数据损坏而崩溃
      SEARCH_HISTORY.length = 0;
      QUERY_RESULT_CACHE.clear();
      quickPickLoaded = true;
    }
}

// 定义带有历史标志的 QuickPickItem
interface HistoryQuickPickItem extends vscode.QuickPickItem {
    isHistory?: boolean;
}

/**
 * 更新历史记录，并保持其唯一性和顺序
 * @param newItem 新的搜索项
 */
function updateHistory(newItem: string) {
    if (!newItem) { return; }
    const index = SEARCH_HISTORY.indexOf(newItem);
    if (index > -1) {
        SEARCH_HISTORY.splice(index, 1);
    }
    SEARCH_HISTORY.unshift(newItem);
    if (SEARCH_HISTORY.length > 20) {
        SEARCH_HISTORY.pop();
    }
    // 持久化
    persistQuickPickData();
}

async function persistQuickPickData() {
    // queryResultCache 只保存最近 20 条
    const cacheArr: [string, vscode.QuickPickItem[]][] = Array.from(QUERY_RESULT_CACHE.entries()).slice(0, 20);
    await writeQuickPickData({
        version: '1.0.0',
        searchHistory: [...SEARCH_HISTORY],
        queryResultCache: cacheArr,
    });
}

/**
 * 智能创建工作流
 * @param parentId 父节点ID，可为null
 * @param isAddToTree 是否添加到树结构
 */
export async function smartCreateIssue(
    parentId: string | null | undefined = null,
    isAddToTree: boolean = false
) {
    await ensureQuickPickLoaded();
    const issueDir = getIssueDir();
    if (!issueDir) {
        vscode.window.showErrorMessage('请先在设置中配置“issueManager.issueDir”');
        vscode.commands.executeCommand('workbench.action.openSettings', 'issueManager.issueDir');
        return;
    }

    const quickPick = vscode.window.createQuickPick();
    quickPick.placeholder = '请输入您的问题，或从历史记录中选择...';
    quickPick.canSelectMany = true;
    quickPick.matchOnDescription = true;

    let currentAbortController: AbortController | null = null;
    quickPick.onDidChangeValue(debounce(async (value) => {
        if (value) {
            // 检查缓存
            if (QUERY_RESULT_CACHE.has(value)) {
                quickPick.items = QUERY_RESULT_CACHE.get(value)!;
                return;
            }

            quickPick.busy = true;
            const requestValue = value; // 记录本次请求的输入
            // 取消上一次请求
            currentAbortController?.abort();
            currentAbortController = new AbortController();
            try {
                const suggestions = await LLMService.getSuggestions(value, { signal: currentAbortController.signal });
                // 检查输入是否已变更，防止 stale response
                if (quickPick.value !== requestValue) {
                    return;
                }
                const newItems: vscode.QuickPickItem[] = [{
                    label: `[创建新笔记] ${value}`,
                    description: '使用原始输入创建新笔记'
                }];
                if (suggestions.optimized.length > 0) {
                    newItems.push({ label: '---', kind: vscode.QuickPickItemKind.Separator });
                    suggestions.optimized.forEach(opt => {
                        newItems.push({ label: `[创建新笔记] ${opt}`, description: `优化建议: ${opt}` });
                    });
                }
                if (suggestions.similar.length > 0) {
                    newItems.push({ label: '---', kind: vscode.QuickPickItemKind.Separator });
                    suggestions.similar.forEach(sim => {
                        newItems.push({ label: `[打开已有笔记] ${sim.title}`, detail: sim.filePath });
                    });
                }
                quickPick.items = newItems;
                QUERY_RESULT_CACHE.set(value, newItems); // 缓存结果
            } catch (error) {
                // 发生错误时，仅显示原始输入选项
                if (quickPick.value === requestValue) {
                    quickPick.items = [{ label: `[创建新笔记] ${value}`, description: '使用原始输入创建新笔记' }];
                }
            } finally {
                if (quickPick.value === requestValue) {
                    quickPick.busy = false;
                }
            }
        } else {
            // 输入为空时，显示历史记录
            quickPick.items = SEARCH_HISTORY.map(item => ({
                label: `$(history) ${item}`,
                description: '从历史记录中恢复',
                isHistory: true
            } as HistoryQuickPickItem));
        }
    }, 500));

    quickPick.onDidChangeSelection(selection => {
        if (selection.length === 1 && (selection[0] as HistoryQuickPickItem).isHistory) {
            const selectedHistoryItem = selection[0];
            // 填充输入框，这将通过 onDidChangeValue 触发缓存加载
            quickPick.value = selectedHistoryItem.label.replace('$(history) ', '');
            // 立即清空选择，避免历史项被“勾选”
            quickPick.selectedItems = [];
        }
    });

    quickPick.onDidAccept(async () => {
        const selectedItems = quickPick.selectedItems;
        const currentValue = quickPick.value;

        if (selectedItems.length > 0) {
            // 用户勾选了至少一项并点击了“确定”
            updateHistory(currentValue);
            await handleBatchSelection(selectedItems, parentId || null, isAddToTree);
            quickPick.hide();
        } else if (currentValue) {
            // 用户没有勾选任何项，但在输入框有值的情况下直接按 Enter
            updateHistory(currentValue);
            await handleDefaultCreation(currentValue, parentId || null, isAddToTree);
            quickPick.hide();
        }
    });

    quickPick.onDidHide(() => {
        currentAbortController?.abort();
        quickPick.dispose();
    });

    // 初始显示历史记录
    // 初始显示历史记录
    quickPick.items = SEARCH_HISTORY.map(item => ({
        label: `$(history) ${item}`,
        description: '从历史记录中恢复',
        isHistory: true
    } as HistoryQuickPickItem));
    quickPick.show();
}

/**
 * 处理批量选择
 */
async function handleBatchSelection(
    selectedItems: readonly vscode.QuickPickItem[],
    parentId: string | null,
    isAddToTree: boolean
) {
    let uris: vscode.Uri[] = [];
    for (const item of selectedItems) {
        if (item.label.startsWith('[创建新笔记]')) {
            const title = item.label.replace('[创建新笔记] ', '');
            if (title) {
                const uri = await createIssueFile(title);
                if (uri) { uris.push(uri); }
            }
        } else if (item.label.startsWith('[打开已有笔记]')) {
            if (item.detail) {
                try {
                    const uri = vscode.Uri.file(item.detail);
                    await vscode.workspace.fs.stat(uri);
                    await vscode.window.showTextDocument(uri);
                } catch (error) {
                    vscode.window.showErrorMessage(`无法打开文件: ${item.detail}`);
            }
        }
    }
    }
    if (uris.length > 0 && isAddToTree) {
        await addIssueToTree(uris, parentId);
    }
}

/**
 * 处理默认（单一）创建
 */
async function handleDefaultCreation(
    title: string,
    parentId: string | null,
    isAddToTree: boolean
) {
    if (title) {
        const uri = await createIssueFile(title);
        if (uri && isAddToTree) {
            await addIssueToTree([uri], parentId);
        }
        if (uri) {
            await vscode.window.showTextDocument(uri);
        }
    }
}
