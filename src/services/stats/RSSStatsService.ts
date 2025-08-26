import { RSSItem } from '../types/RSSTypes';

/**
 * RSS 统计信息服务
 * 负责提供RSS文章的各种统计信息
 */
export class RSSStatsService {
    /**
     * 获取RSS文章历史统计信息
     * @param feedData 订阅源数据Map
     */
    public static getHistoryStats(
        feedData: Map<string, { items: RSSItem[] }>
    ): { totalItems: number; oldestDate?: Date; newestDate?: Date; itemsByFeed: Record<string, number> } {
        let totalItems = 0;
        let oldestDate: Date | undefined;
        let newestDate: Date | undefined;
        const itemsByFeed: Record<string, number> = {};

        for (const [feedId, data] of feedData) {
            const items = data.items;
            totalItems += items.length;
            itemsByFeed[feedId] = items.length;
            
            for (const item of items) {
                if (!oldestDate || item.pubDate < oldestDate) {
                    oldestDate = item.pubDate;
                }
                if (!newestDate || item.pubDate > newestDate) {
                    newestDate = item.pubDate;
                }
            }
        }

        return { totalItems, oldestDate, newestDate, itemsByFeed };
    }

    /**
     * 获取订阅源的详细统计信息
     * @param feedData 订阅源数据Map
     * @param feedId 订阅源ID
     */
    public static getFeedStats(
        feedData: Map<string, { items: RSSItem[] }>,
        feedId: string
    ): {
        itemCount: number;
        oldestItem?: Date;
        newestItem?: Date;
        averageItemsPerDay?: number;
    } | null {
        const data = feedData.get(feedId);
        if (!data) {
            return null;
        }

        const items = data.items;
        const itemCount = items.length;
        
        if (itemCount === 0) {
            return {
                itemCount: 0,
            };
        }

        // 找出最新和最旧的文章
        let oldestItem = items[0].pubDate;
        let newestItem = items[0].pubDate;
        
        for (const item of items) {
            if (item.pubDate < oldestItem) {
                oldestItem = item.pubDate;
            }
            if (item.pubDate > newestItem) {
                newestItem = item.pubDate;
            }
        }

        // 计算平均每天的文章数
        const daysDiff = Math.max(1, Math.ceil((newestItem.getTime() - oldestItem.getTime()) / (1000 * 60 * 60 * 24)));
        const averageItemsPerDay = itemCount / daysDiff;

        return {
            itemCount,
            oldestItem,
            newestItem,
            averageItemsPerDay
        };
    }

    /**
     * 获取活跃度统计（最近N天的文章发布情况）
     * @param feedData 订阅源数据Map
     * @param days 统计天数，默认30天
     */
    public static getActivityStats(
        feedData: Map<string, { lastUpdated?: Date; items: RSSItem[] }>,
        days: number = 30
    ): {
        totalItemsInPeriod: number;
        averageItemsPerDay: number;
        activeFeedsCount: number;
        dailyBreakdown: Array<{ date: string; count: number }>;
    } {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);

        let totalItemsInPeriod = 0;
        const activeFeedIds = new Set<string>();
        const dailyCounts = new Map<string, number>();

        // 初始化日期计数器
        for (let i = 0; i < days; i++) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateKey = date.toISOString().split('T')[0];
            dailyCounts.set(dateKey, 0);
        }

        for (const [feedId, data] of feedData) {
            let feedHasRecentItems = false;
            
            for (const item of data.items) {
                if (item.pubDate >= cutoffDate) {
                    totalItemsInPeriod++;
                    feedHasRecentItems = true;
                    
                    // 更新日期统计
                    const dateKey = item.pubDate.toISOString().split('T')[0];
                    if (dailyCounts.has(dateKey)) {
                        dailyCounts.set(dateKey, (dailyCounts.get(dateKey) || 0) + 1);
                    }
                }
            }
            
            if (feedHasRecentItems) {
                activeFeedIds.add(feedId);
            }
        }

        const averageItemsPerDay = totalItemsInPeriod / days;
        
        // 转换为数组格式
        const dailyBreakdown = Array.from(dailyCounts.entries())
            .map(([date, count]) => ({ date, count }))
            .sort((a, b) => a.date.localeCompare(b.date));

        return {
            totalItemsInPeriod,
            averageItemsPerDay,
            activeFeedsCount: activeFeedIds.size,
            dailyBreakdown
        };
    }

    /**
     * 获取订阅源排行榜
     * @param feedData 订阅源数据Map
     * @param feedNames 订阅源名称映射
     * @param sortBy 排序方式：'itemCount' | 'recentActivity' | 'lastUpdated'
     * @param limit 返回数量限制，默认10
     */
    public static getFeedRanking(
        feedData: Map<string, { lastUpdated?: Date; items: RSSItem[] }>,
        feedNames: Map<string, string>,
        sortBy: 'itemCount' | 'recentActivity' | 'lastUpdated' = 'itemCount',
        limit: number = 10
    ): Array<{
        feedId: string;
        feedName: string;
        itemCount: number;
        recentItemCount: number;
        lastUpdated?: Date;
    }> {
        const rankings: Array<{
            feedId: string;
            feedName: string;
            itemCount: number;
            recentItemCount: number;
            lastUpdated?: Date;
        }> = [];

        const recentCutoff = new Date();
        recentCutoff.setDate(recentCutoff.getDate() - 7); // 最近7天

        for (const [feedId, data] of feedData) {
            const recentItemCount = data.items.filter(item => item.pubDate >= recentCutoff).length;
            
            rankings.push({
                feedId,
                feedName: feedNames.get(feedId) || feedId,
                itemCount: data.items.length,
                recentItemCount,
                lastUpdated: data.lastUpdated
            });
        }

        // 排序
        rankings.sort((a, b) => {
            switch (sortBy) {
                case 'itemCount':
                    return b.itemCount - a.itemCount;
                case 'recentActivity':
                    return b.recentItemCount - a.recentItemCount;
                case 'lastUpdated':
                    if (!a.lastUpdated && !b.lastUpdated) { return 0; }
                    if (!a.lastUpdated) { return 1; }
                    if (!b.lastUpdated) { return -1; }
                    return b.lastUpdated.getTime() - a.lastUpdated.getTime();
                default:
                    return 0;
            }
        });

        return rankings.slice(0, limit);
    }

    /**
     * 生成统计摘要文本
     * @param feedData 订阅源数据Map
     * @param feedNames 订阅源名称映射
     */
    public static generateSummaryText(
        feedData: Map<string, { items: RSSItem[] }>,
        feedNames: Map<string, string>
    ): string {
        const historyStats = this.getHistoryStats(feedData);
        const activityStats = this.getActivityStats(feedData, 30);
        const topFeeds = this.getFeedRanking(feedData, feedNames, 'itemCount', 5);

        let summary = `## RSS 统计摘要\n\n`;
        summary += `📊 **总体统计**\n`;
        summary += `- 总文章数: ${historyStats.totalItems} 篇\n`;
        summary += `- 订阅源数: ${feedData.size} 个\n`;
        summary += `- 最早文章: ${historyStats.oldestDate?.toLocaleDateString('zh-CN') || '无'}\n`;
        summary += `- 最新文章: ${historyStats.newestDate?.toLocaleDateString('zh-CN') || '无'}\n\n`;

        summary += `🚀 **最近30天活跃度**\n`;
        summary += `- 新增文章: ${activityStats.totalItemsInPeriod} 篇\n`;
        summary += `- 平均每日: ${activityStats.averageItemsPerDay.toFixed(1)} 篇\n`;
        summary += `- 活跃订阅源: ${activityStats.activeFeedsCount} 个\n\n`;

        summary += `🏆 **文章数排行榜**\n`;
        topFeeds.forEach((feed, index) => {
            summary += `${index + 1}. ${feed.feedName}: ${feed.itemCount} 篇\n`;
        });

        return summary;
    }
}
