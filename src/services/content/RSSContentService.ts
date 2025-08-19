import * as vscode from 'vscode';
import { RSSFeed, RSSItem, RSSParseStats } from '../types/RSSTypes';
import { RSSFetcher } from '../fetcher/RSSFetcher';
import { RSSParser } from '../parser/RSSParser';
import { RSSHistoryManager } from '../history/RSSHistoryManager';

/**
 * RSS内容获取服务
 * 负责从RSS订阅源获取内容并进行处理
 */
export class RSSContentService {
    private feedData: Map<string, { lastUpdated?: Date; items: RSSItem[] }>;
    private saveHistoryCallback?: () => Promise<void>;

    constructor(
        feedData: Map<string, { lastUpdated?: Date; items: RSSItem[] }>,
        saveHistoryCallback?: () => Promise<void>
    ) {
        this.feedData = feedData;
        this.saveHistoryCallback = saveHistoryCallback;
    }

    /**
     * 设置保存历史记录的回调函数
     */
    public setSaveHistoryCallback(callback: () => Promise<void>): void {
        this.saveHistoryCallback = callback;
    }

    /**
     * 从RSS URL获取文章列表
     * @param feed RSS订阅源
     * @returns RSS文章列表
     */
    public async fetchFeed(feed: RSSFeed): Promise<RSSItem[]> {
        try {
            const responseText = await RSSFetcher.fetchContent(feed.url);
            const result = RSSParser.parseContentWithStats(responseText, feed.id);
            
            // 显示解析统计信息（如果有失败的条目）
            if (result.stats.failedCount > 0) {
                const message = `订阅源 "${feed.name}": 成功解析${result.stats.successCount}篇文章，${result.stats.failedCount}篇因格式错误被跳过`;
                vscode.window.showWarningMessage(message, '查看详情').then(selection => {
                    if (selection === '查看详情') {
                        this.showParseFailureDetails(feed.name, result.stats);
                    }
                });
            }
            
            return result.items;
        } catch (error) {
            throw new Error(`获取RSS内容失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
    }

    /**
     * 显示解析失败的详细信息
     */
    private showParseFailureDetails(feedName: string, stats: RSSParseStats): void {
        const failedItems = stats.failedItems || [];
        const details = failedItems.map((item, index) => 
            `${index + 1}. ${item.title || '无标题'} (${item.link || '无链接'})\n   错误: ${item.error}`
        ).join('\n\n');
        
        const message = `订阅源 "${feedName}" 解析失败的文章详情:\n\n${details}`;
        vscode.window.showInformationMessage(message);
    }

    /**
     * 更新单个订阅源
     * @param feed RSS订阅源
     */
    public async updateFeed(feed: RSSFeed): Promise<void> {
        try {
            const newItems = await this.fetchFeed(feed);
            const feedData = this.feedData.get(feed.id);
            const existingItems = feedData?.items || [];
            
            // 合并新文章和现有文章，保留历史记录
            const maxItems = vscode.workspace.getConfiguration('issueManager').get<number>('rss.maxItemsPerFeed', 500);
            const mergedItems = RSSHistoryManager.mergeRSSItems(existingItems, newItems, maxItems);
            
            // 更新数据和状态
            this.feedData.set(feed.id, {
                lastUpdated: new Date(),
                items: mergedItems
            });
            
            // 保存文章历史记录和状态
            if (this.saveHistoryCallback) {
                await this.saveHistoryCallback();
            }
            
            console.log(`RSS订阅源更新成功 [${feed.name}]: ${newItems.length}篇新文章`);
        } catch (error) {
            console.error(`更新RSS订阅源失败 [${feed.name}]:`, error);
            throw error;
        }
    }

    /**
     * 批量更新多个订阅源
     * @param feeds RSS订阅源列表
     */
    public async updateFeeds(feeds: RSSFeed[]): Promise<void> {
        const promises = feeds
            .filter(feed => feed.enabled)
            .map(feed => this.updateFeed(feed));

        await Promise.allSettled(promises);
    }

    /**
     * 获取指定订阅源的最新文章
     * @param feedId 订阅源ID
     * @param limit 限制数量，默认10篇
     * @returns RSS文章列表
     */
    public getRecentItems(feedId: string, limit: number = 10): RSSItem[] {
        const feedData = this.feedData.get(feedId);
        if (!feedData) {
            return [];
        }

        return [...feedData.items]
            .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())
            .slice(0, limit);
    }

    /**
     * 获取所有订阅源的最新文章
     * @param limit 每个订阅源的文章限制数量，默认5篇
     * @returns 按时间排序的RSS文章列表
     */
    public getAllRecentItems(limit: number = 5): RSSItem[] {
        const allItems: RSSItem[] = [];

        for (const [feedId, feedData] of this.feedData) {
            const recentItems = feedData.items
                .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())
                .slice(0, limit);
            
            allItems.push(...recentItems);
        }

        // 按发布时间倒序排列
        return allItems.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
    }

    /**
     * 搜索文章
     * @param query 搜索关键词
     * @param feedIds 可选的订阅源ID列表，如果不提供则搜索所有订阅源
     * @returns 匹配的RSS文章列表
     */
    public searchItems(query: string, feedIds?: string[]): RSSItem[] {
        const searchTerm = query.toLowerCase();
        const results: RSSItem[] = [];

        const targetFeedIds = feedIds || Array.from(this.feedData.keys());

        for (const feedId of targetFeedIds) {
            const feedData = this.feedData.get(feedId);
            if (!feedData) {
                continue;
            }

            const matchingItems = feedData.items.filter(item => 
                item.title.toLowerCase().includes(searchTerm) ||
                (item.description && item.description.toLowerCase().includes(searchTerm)) ||
                (item.content && item.content.toLowerCase().includes(searchTerm))
            );

            results.push(...matchingItems);
        }

        // 按发布时间倒序排列
        return results.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
    }

    /**
     * 获取订阅源的文章统计信息
     * @param feedId 订阅源ID
     * @returns 统计信息
     */
    public getFeedStats(feedId: string): { totalItems: number; lastUpdated?: Date; oldestItem?: Date; newestItem?: Date } {
        const feedData = this.feedData.get(feedId);
        if (!feedData) {
            return { totalItems: 0 };
        }

        const items = feedData.items;
        const totalItems = items.length;
        const lastUpdated = feedData.lastUpdated;

        if (totalItems === 0) {
            return { totalItems, lastUpdated };
        }

        const sortedItems = items.sort((a, b) => a.pubDate.getTime() - b.pubDate.getTime());
        const oldestItem = sortedItems[0]?.pubDate;
        const newestItem = sortedItems[sortedItems.length - 1]?.pubDate;

        return {
            totalItems,
            lastUpdated,
            oldestItem,
            newestItem
        };
    }

    /**
     * 清空指定订阅源的文章数据
     * @param feedId 订阅源ID
     */
    public async clearFeedData(feedId: string): Promise<void> {
        this.feedData.delete(feedId);
        
        if (this.saveHistoryCallback) {
            await this.saveHistoryCallback();
        }
        
        console.log(`已清空订阅源数据: ${feedId}`);
    }

    /**
     * 获取订阅源数据映射的只读副本
     * @returns 订阅源数据映射
     */
    public getFeedDataMap(): ReadonlyMap<string, { lastUpdated?: Date; items: RSSItem[] }> {
        return new Map(this.feedData);
    }

    /**
     * 销毁服务，清理资源
     */
    public dispose(): void {
        this.saveHistoryCallback = undefined;
        console.log('RSS内容服务已销毁');
    }
}
