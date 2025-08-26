import * as vscode from 'vscode';
import { RSSItem, RSSFeed } from '../types/RSSTypes';
import { RSSStorageService } from '../storage/RSSStorageService';
import { writeJSONLFile, readJSONLFile } from '../../utils/fileUtils';
import { getIssueDir } from '../../config';
import { RSSFeedState, RSSFeedStateService } from '../storage/RSSFeedStateService';

/**
 * JSONL格式的RSS记录结构
 */
export interface RSSFeedRecord {
    feedId: string;
    items: RSSItem[];
}

/**
 * RSS 历史记录管理器
 * 负责RSS文章历史记录的清理、压缩、导入导出等功能
 */
export class RSSHistoryManager {
    /**
     * 清理旧的RSS文章历史记录
     * @param feedData 订阅源数据Map
     * @param daysToKeep 保留天数，默认30天
     */
    public static async cleanupOldItems(
        feedData: Map<string, { items: RSSItem[] }>, 
        daysToKeep: number = 30
    ): Promise<{ removedCount: number }> {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

        let removedCount = 0;

        for (const [feedId, data] of feedData) {
            const originalLength = data.items.length;
            const filteredItems = data.items.filter((item: RSSItem) => item.pubDate >= cutoffDate);
            
            if (filteredItems.length !== originalLength) {
                removedCount += (originalLength - filteredItems.length);
                feedData.set(feedId, {
                    ...data,
                    items: filteredItems
                });
            }
        }

        if (removedCount > 0) {
            // 保存更新后的数据
            await this.saveFeedData(feedData);
            console.log(`已清理${removedCount}个${daysToKeep}天前的RSS文章记录`);
        }

        return { removedCount };
    }

    /**
     * 压缩RSS历史记录（移除重复项和超出限制的旧记录）
     * @param feedData 订阅源数据Map
     * @param maxItemsPerFeed 每个订阅源最多保留的文章数，默认500
     */
    public static async compactHistory(
        feedData: Map<string, { items: RSSItem[] }>,
        maxItemsPerFeed: number = 500
    ): Promise<{ removedItems: number; compactedFeeds: number }> {
        let removedItems = 0;
        let compactedFeeds = 0;

        for (const [feedId, data] of feedData) {
            const originalCount = data.items.length;
            
            if (originalCount > maxItemsPerFeed) {
                // 按时间排序，保留最新的文章
                data.items.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
                data.items = data.items.slice(0, maxItemsPerFeed);
                
                removedItems += (originalCount - data.items.length);
                compactedFeeds++;
            }

            // 去重：移除相同ID的重复文章
            const uniqueItems = new Map<string, RSSItem>();
            for (const item of data.items) {
                if (!uniqueItems.has(item.id)) {
                    uniqueItems.set(item.id, item);
                }
            }
            
            if (uniqueItems.size !== data.items.length) {
                const duplicateCount = data.items.length - uniqueItems.size;
                data.items = Array.from(uniqueItems.values());
                removedItems += duplicateCount;
                if (duplicateCount > 0) {
                    compactedFeeds++;
                }
            }
        }

        if (removedItems > 0) {
            await this.saveFeedData(feedData);
            console.log(`历史记录压缩完成：移除${removedItems}个项目，优化${compactedFeeds}个订阅源`);
        }

        return { removedItems, compactedFeeds };
    }

    /**
     * 导出RSS历史记录到指定文件（便于手动同步）
     * @param feedData 订阅源数据Map
     * @param exportPath 导出文件路径（可选）
     */
    public static async exportHistory(
        feedData: Map<string, { items: RSSItem[] }>,
        exportPath?: string
    ): Promise<string | null> {
        try {
            const records: RSSFeedRecord[] = [];
            
            for (const [feedId, data] of feedData) {
                records.push({
                    feedId,
                    items: data.items
                });
            }

            const exportUri = exportPath 
                ? vscode.Uri.file(exportPath)
                : vscode.Uri.joinPath(vscode.Uri.file(getIssueDir() || ''), `rss-export-${Date.now()}.jsonl`);
            
            const success = await writeJSONLFile(exportUri, records);
            if (success) {
                vscode.window.showInformationMessage(`RSS历史记录已导出到: ${exportUri.fsPath}`);
                return exportUri.fsPath;
            } else {
                vscode.window.showErrorMessage('导出RSS历史记录失败');
                return null;
            }
        } catch (error) {
            console.error('导出RSS历史记录失败:', error);
            vscode.window.showErrorMessage('导出失败');
            return null;
        }
    }

    /**
     * 从文件导入RSS历史记录（便于手动同步）
     * @param feedData 订阅源数据Map
     * @param importPath 导入文件路径
     * @param mergeStrategy 合并策略：'replace' | 'merge'
     */
    public static async importHistory(
        feedData: Map<string, { items: RSSItem[] }>,
        importPath: string,
        mergeStrategy: 'replace' | 'merge' = 'merge'
    ): Promise<boolean> {
        try {
            const importUri = vscode.Uri.file(importPath);
            const importedRecords = await readJSONLFile<RSSFeedRecord>(importUri);
            
            if (!importedRecords || importedRecords.length === 0) {
                vscode.window.showWarningMessage('导入文件为空或格式不正确');
                return false;
            }

            let importedFeeds = 0;
            let importedItems = 0;

            for (const record of importedRecords) {
                const existingData = feedData.get(record.feedId);
                const convertedItems = record.items.map((item) => ({
                    ...item,
                    pubDate: new Date(item.pubDate)
                }));

                if (mergeStrategy === 'replace' || !existingData) {
                    // 替换或新增
                    feedData.set(record.feedId, {
                        items: convertedItems
                    });
                    importedFeeds++;
                    importedItems += convertedItems.length;
                } else {
                    // 合并策略：合并文章并去重
                    const maxItems = vscode.workspace.getConfiguration('issueManager').get<number>('rss.maxItemsPerFeed', 500);
                    const mergedItems = this.mergeRSSItems(existingData.items, convertedItems, maxItems);
                    feedData.set(record.feedId, {
                        items: mergedItems
                    });
                    importedFeeds++;
                    importedItems += (mergedItems.length - existingData.items.length);
                }
            }

            await this.saveFeedData(feedData);
            vscode.window.showInformationMessage(
                `导入完成: ${importedFeeds}个订阅源，${importedItems}篇新文章`
            );
            return true;
        } catch (error) {
            console.error('导入RSS历史记录失败:', error);
            vscode.window.showErrorMessage('导入失败');
            return false;
        }
    }

    /**
     * 重建历史记录（从订阅源重新获取最近文章）
     * @param feeds 订阅源列表
     * @param feedData 订阅源数据Map
     * @param fetchFeedFunction 获取订阅源文章的函数
     * @param daysToFetch 获取最近几天的文章，默认7天
     */
    public static async rebuildHistory(
        feeds: RSSFeed[],
        feedData: Map<string, { items: RSSItem[] }>,
        fetchFeedFunction: (feed: RSSFeed) => Promise<RSSItem[]>,
        daysToFetch: number = 7
    ): Promise<{ rebuiltFeeds: number; totalItems: number }> {
        let rebuiltFeeds = 0;
        let totalItems = 0;

        const enabledFeeds = feeds.filter(feed => feed.enabled);
        
        for (const feed of enabledFeeds) {
            try {
                const items = await fetchFeedFunction(feed);
                const cutoffDate = new Date();
                cutoffDate.setDate(cutoffDate.getDate() - daysToFetch);
                
                // 只保留指定天数内的文章
                const recentItems = items.filter(item => item.pubDate >= cutoffDate);
                
                feedData.set(feed.id, {
                    items: recentItems
                });
                
                rebuiltFeeds++;
                totalItems += recentItems.length;
                
                console.log(`重建订阅源 "${feed.name}": ${recentItems.length}篇文章`);
            } catch (error) {
                console.warn(`重建订阅源 "${feed.name}" 失败:`, error);
            }
        }

        if (rebuiltFeeds > 0) {
            await this.saveFeedData(feedData);
            vscode.window.showInformationMessage(
                `历史记录重建完成: ${rebuiltFeeds}个订阅源，共${totalItems}篇文章`
            );
        }

        return { rebuiltFeeds, totalItems };
    }

    /**
     * 合并RSS文章，保留历史记录并去重
     * @param existingItems 现有文章列表
     * @param newItems 新文章列表
     * @param maxItems 最大保留文章数，默认500
     */
    public static mergeRSSItems(existingItems: RSSItem[], newItems: RSSItem[], maxItems: number = 500): RSSItem[] {
        const itemMap = new Map<string, RSSItem>();

        // 首先添加现有文章
        existingItems.forEach(item => {
            itemMap.set(item.id, item);
        });

        // 添加新文章，如果ID相同则更新
        newItems.forEach(item => {
            itemMap.set(item.id, item);
        });

        // 转换回数组并按发布时间排序
        const mergedItems = Array.from(itemMap.values());
        mergedItems.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());

        // 限制保存的文章数量，避免数据过多
        return mergedItems.slice(0, maxItems);  
    }

    /**
     * 保存订阅源数据
     */
    private static async saveFeedData(feedData: Map<string, { items: RSSItem[] }>): Promise<void> {
        // 准备状态数据
        const feedItemsMap = new Map<string, RSSItem[]>();
        
        for (const [feedId, data] of feedData) {
            feedItemsMap.set(feedId, data.items);
        }
        await RSSStorageService.saveAllFeedItems(feedItemsMap);
    }
}
