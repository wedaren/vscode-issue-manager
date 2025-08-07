import * as vscode from 'vscode';
import { getIssueDir } from '../config';
import { LLMService } from '../llm/LLMService';
import { createIssueFile, addIssueToTree } from './issueFileUtils';
import { readQuickPickData, writeQuickPickData, QuickPickPersistedData } from '../data/treeManager';
import { debounce } from '../utils/debounce';
import * as path from 'path';

// 在模块作用域内维护缓存和历史记录
export const SEARCH_HISTORY: string[] = [];
export const QUERY_RESULT_CACHE = new Map<string, vscode.QuickPickItem[]>();

const createDefaultOption = (value: string) => ({  
    label: `[创建新笔记] ${value}`,  
    description: '按回车可直接用当前输入创建新笔记',  
    alwaysShow: true,
    action: 'create',
    payload: value
})  as HistoryQuickPickItem; // 使用扩展后的 HistoryQuickPickItem 类型
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

// 定义带有历史标志和清空缓存标志的 QuickPickItem
interface HistoryQuickPickItem extends vscode.QuickPickItem {
    isHistory?: boolean;
    isClearCacheOption?: boolean;
    action?: 'create' | 'open';  
    payload?: string; // 对于 'create' 是标题，对于 'open' 是文件路径  
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
 * @param isAddToFocused 是否添加到关注列表
 * @returns Promise<vscode.Uri[]> 用户最终选择的所有 item 对应的 URI 数组，没有则返回空数组
 */
export async function smartCreateIssue(
    parentId: string | null | undefined = null,
    isAddToTree: boolean = false,
    isAddToFocused: boolean = false
): Promise<vscode.Uri[]> {
    await ensureQuickPickLoaded();
    const issueDir = getIssueDir();
    if (!issueDir) {
        vscode.window.showErrorMessage('请先在设置中配置"issueManager.issueDir"');
        vscode.commands.executeCommand('workbench.action.openSettings', 'issueManager.issueDir');
        return [];
    }

    return new Promise<vscode.Uri[]>((resolve) => {
        const quickPick = vscode.window.createQuickPick<HistoryQuickPickItem>();
        quickPick.placeholder = '请输入您的问题，或从历史记录中选择...';
        quickPick.canSelectMany = true;
        quickPick.matchOnDescription = true;

        let currentAbortController: AbortController | null = null;

        /**
         * 辅助函数：根据 value 调用 LLM 并刷新 quickPick.items 和缓存
         */
        async function fetchAndDisplaySuggestions(value: string, quickPick: vscode.QuickPick<HistoryQuickPickItem>) {
            const clearCacheOption: HistoryQuickPickItem = {
                label: '$(sync) 清空缓存并重新请求',
                description: '强制重新调用 LLM',
                isClearCacheOption: true,
                alwaysShow: true
            };
            const defaultOption = createDefaultOption(value);

            quickPick.selectedItems = [];
            const cachedItems = QUERY_RESULT_CACHE.get(value);
            if (cachedItems?.length) {
                quickPick.items = [defaultOption, ...cachedItems, clearCacheOption];
                return;
            } else {
                quickPick.items = [defaultOption];
            }
            quickPick.busy = true;
            const requestValue = value;
            // 取消上一次请求
            currentAbortController?.abort();
            currentAbortController = new AbortController();
            try {
                const suggestions = await LLMService.getSuggestions(value, { signal: currentAbortController.signal });
                if (quickPick.value !== requestValue) {
                    return;
                }
                const newItems: HistoryQuickPickItem[] = [];
                if (suggestions.optimized.length > 0) {
                    newItems.push({ label: '---', kind: vscode.QuickPickItemKind.Separator });
                    suggestions.optimized.forEach(opt => {
                        newItems.push({ 
                            label: `[创建新笔记] ${opt}`, 
                            alwaysShow: true,
                            action: 'create',
                            payload: opt
                        });
                    });
                }
                if (suggestions.similar.length > 0) {
                    newItems.push({ label: '---', kind: vscode.QuickPickItemKind.Separator });
                    suggestions.similar.forEach(sim => {
                        const relativePath = path.relative(issueDir || '', sim.filePath);
                        newItems.push({ 
                            label: `[打开已有笔记] ${sim.title}`, 
                            description: relativePath, 
                            alwaysShow: true,
                            action: 'open',
                            payload: relativePath
                        });
                    });
                }
                if (newItems.length === 0) {
                    throw new Error('没有找到相关建议');
                }
                quickPick.items = [defaultOption, ...newItems, clearCacheOption];
                QUERY_RESULT_CACHE.set(value, newItems); // 缓存结果
            } catch (error) {
                console.error('获取建议失败:', error);
                if (quickPick.value === requestValue) {
                    quickPick.items = [defaultOption];
                }
            } finally {
                if (quickPick.value === requestValue) {
                    quickPick.busy = false;
                }
            }
        }
        const debounceFetchAndDisplaySuggestions = debounce(async (value) => {
            await fetchAndDisplaySuggestions(value, quickPick);
        }, 500);

        quickPick.onDidChangeValue(async (value) => {
            if (value) {
                const defaultOption = createDefaultOption(value);
                quickPick.items = [defaultOption];
                debounceFetchAndDisplaySuggestions(value);
            } else {
                // 输入为空时，显示历史记录
                quickPick.items = SEARCH_HISTORY.map(item => ({
                    label: `$(history) ${item}`,
                    description: '从历史记录中恢复',
                    isHistory: true
                } as HistoryQuickPickItem));
            }
        });

        quickPick.onDidChangeSelection(async selection => {
            if (selection.length === 1) {
                const selectedItem = selection[0] as HistoryQuickPickItem;
                if (selectedItem.isHistory) {
                    // 用户的意图是恢复历史
                    quickPick.value = selectedItem.label.replace('$(history) ', '');
                    quickPick.selectedItems = [];
                } else if (selectedItem.isClearCacheOption) {
                    // 用户的意图是清空缓存并重新请求
                    const currentValue = quickPick.value;
                    if (currentValue) {
                        QUERY_RESULT_CACHE.delete(currentValue); // 从缓存中删除当前项
                        await fetchAndDisplaySuggestions(currentValue, quickPick);
                    }
                }
            }
        });

        let hasAccepted = false;
        quickPick.onDidAccept(async () => {
            hasAccepted = true;
            const selectedItems = quickPick.selectedItems;
            const currentValue = quickPick.value;

            if (selectedItems.length > 0) {
                // 用户勾选了至少一项并点击了"确定"
                updateHistory(currentValue);
                const uris = await handleBatchSelection(selectedItems, parentId || null, isAddToTree, isAddToFocused);
                resolve(uris);
                quickPick.dispose();
            } else if (currentValue) {
                // 用户没有勾选任何项，但在输入框有值的情况下直接按 Enter
                updateHistory(currentValue);
                const uri = await handleDefaultCreation(currentValue, parentId || null, isAddToTree, isAddToFocused);
                resolve(uri ? [uri] : []);
                quickPick.dispose();
            }
        });

        quickPick.onDidHide(() => {

            currentAbortController?.abort();
            if (hasAccepted) {
                // 如果用户已经接受了选择，则不需要再处理
                return;
            } else {
                resolve([]);
                quickPick.dispose();
            }
        });

        // 初始显示历史记录
        quickPick.items = SEARCH_HISTORY.map(item => ({
            label: `$(history) ${item}`,
            description: '从历史记录中恢复',
            isHistory: true
        } as HistoryQuickPickItem));
        quickPick.show();
    });
}

/**
 * 处理批量选择
 * @returns 所有成功创建或打开的文件的 URI 数组
 */
async function handleBatchSelection(
    selectedItems: readonly vscode.QuickPickItem[],
    parentId: string | null,
    isAddToTree: boolean,
    isAddToFocused: boolean
): Promise<vscode.Uri[]> {
    let uris: vscode.Uri[] = [];

    // 使用扩展后的 HistoryQuickPickItem，直接根据 action 字段判断操作类型
    for (const item of selectedItems as readonly HistoryQuickPickItem[]) {
        if (item.action === 'create' && item.payload) {
            // 创建新笔记
            const uri = await createIssueFile(item.payload);
            if (uri) {
                uris.push(uri);
            }
        } else if (item.action === 'open' && item.payload) {
            // 打开已有笔记
            try {
                const issueDir = getIssueDir();
                if (!issueDir) {
                    vscode.window.showErrorMessage('问题目录未配置，无法打开文件。');
                    continue;
                }
                const notePath = path.resolve(issueDir, item.payload);

                // 安全检查：确保解析后的路径在 issueDir 目录内
                if (!notePath.startsWith(path.resolve(issueDir))) {
                    vscode.window.showErrorMessage(`检测到不安全的路径，已阻止打开: ${item.payload}`);
                    continue;
                }

                const uri = vscode.Uri.file(notePath);
                await vscode.workspace.fs.stat(uri);
                uris.push(uri);
                await vscode.window.showTextDocument(uri);
            } catch (error) {
                vscode.window.showErrorMessage(`无法打开文件: ${item.payload}`);
            }
        }
    }
    if (uris.length > 0 && isAddToTree) {
        await addIssueToTree(uris, parentId, isAddToFocused);
    }
    return uris;
}

/**
 * 处理默认（单一）创建
 * @returns 创建的文件的 URI，没有则返回 null
 */
async function handleDefaultCreation(
    title: string,
    parentId: string | null,
    isAddToTree: boolean,
    isAddToFocused: boolean
): Promise<vscode.Uri | null> {
    if (title) {
        const uri = await createIssueFile(title);
        if (uri && isAddToTree) {
            await addIssueToTree([uri], parentId, isAddToFocused);
        }
        if (uri) {
            await vscode.window.showTextDocument(uri);
        }
        return uri;
    }
    return null;
}
