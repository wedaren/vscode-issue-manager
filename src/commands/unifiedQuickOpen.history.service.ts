import * as vscode from "vscode";
import { Mode } from "./unifiedQuickOpen.types";

/**
 * 历史记录项接口
 */
export interface HistoryItem {
    mode: Mode;
    value: string;
    timestamp: number;
}

/**
 * 历史记录存储键
 */
const HISTORY_STORAGE_KEY = "issueManager.unifiedQuickOpen.history";

/**
 * 最大历史记录数
 */
const MAX_HISTORY_SIZE = 50;

/**
 * 历史记录管理服务
 */
export class HistoryService {
    constructor(private context: vscode.ExtensionContext) {}

    /**
     * 获取所有历史记录
     */
    getHistory(): HistoryItem[] {
        const history = this.context.globalState.get<HistoryItem[]>(HISTORY_STORAGE_KEY) || [];
        return history;
    }

    /**
     * 添加历史记录
     */
    async addHistory(mode: Mode, value: string): Promise<void> {
        // 忽略空值
        if (!value || !value.trim()) {
            return;
        }

        const history = this.getHistory();
        
        // 创建新的历史项
        const newItem: HistoryItem = {
            mode,
            value: value.trim(),
            timestamp: Date.now(),
        };

        // 检查是否已存在相同的记录（模式和值都相同），如果存在则移除旧的
        const existingIndex = history.findIndex(
            item => item.mode === mode && item.value === newItem.value
        );
        if (existingIndex !== -1) {
            history.splice(existingIndex, 1);
        }

        // 添加到开头
        history.unshift(newItem);

        // 限制历史记录数量
        if (history.length > MAX_HISTORY_SIZE) {
            history.splice(MAX_HISTORY_SIZE);
        }

        // 保存
        await this.context.globalState.update(HISTORY_STORAGE_KEY, history);
    }

    /**
     * 清空所有历史记录
     */
    async clearHistory(): Promise<void> {
        await this.context.globalState.update(HISTORY_STORAGE_KEY, []);
    }

    /**
     * 删除单条历史记录
     */
    async removeHistory(timestamp: number): Promise<void> {
        const history = this.getHistory();
        const filtered = history.filter(item => item.timestamp !== timestamp);
        await this.context.globalState.update(HISTORY_STORAGE_KEY, filtered);
    }

    /**
     * 按模式获取历史记录
     */
    getHistoryByMode(mode: Mode): HistoryItem[] {
        return this.getHistory().filter(item => item.mode === mode);
    }
}
