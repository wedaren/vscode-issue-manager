import * as vscode from 'vscode';
import { RSSFeed } from '../types/RSSTypes';

/**
 * RSS自动更新调度器
 * 负责管理RSS订阅源的自动更新调度
 */
export class RSSScheduler {
    private updateTimer?: NodeJS.Timeout;
    // 每30分钟检查一次是否需要更新
    static readonly AUTO_UPDATE_CHECK_INTERVAL = 30 * 60 * 1000;

    private feeds: RSSFeed[] = [];
    private feedUpdateCallback?: (feed: RSSFeed) => Promise<void>;
    private getLastUpdatedTimeCallback?: (feedId: string) => Promise<Date | undefined>;

    constructor(
        feeds: RSSFeed[] = [],
        feedUpdateCallback?: (feed: RSSFeed) => Promise<void>,
        getLastUpdatedTimeCallback?: (feedId: string) => Promise<Date | undefined>
    ) {
        this.feeds = feeds;
        this.feedUpdateCallback = feedUpdateCallback;
        this.getLastUpdatedTimeCallback = getLastUpdatedTimeCallback;
    }

    /**
     * 更新订阅源列表
     */
    public updateFeeds(feeds: RSSFeed[]): void {
        this.feeds = feeds;
    }

    /**
     * 设置订阅源更新回调函数
     */
    public setFeedUpdateCallback(callback: (feed: RSSFeed) => Promise<void>): void {
        this.feedUpdateCallback = callback;
    }

    /**
     * 设置获取最后更新时间的回调函数
     */
    public setGetLastUpdatedTimeCallback(callback: (feedId: string) => Promise<Date | undefined>): void {
        this.getLastUpdatedTimeCallback = callback;
    }

    /**
     * 启动自动更新
     */
    public startAutoUpdate(): void {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
        }

        this.updateTimer = setInterval(async () => {
            await this.checkAndUpdateFeeds();
        }, RSSScheduler.AUTO_UPDATE_CHECK_INTERVAL);

        console.log('RSS自动更新调度器已启动');
    }

    /**
     * 停止自动更新
     */
    public stopAutoUpdate(): void {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
            this.updateTimer = undefined;
            console.log('RSS自动更新调度器已停止');
        }
    }

    /**
     * 检查并更新需要更新的订阅源
     */
    private async checkAndUpdateFeeds(): Promise<void> {
        if (!this.feedUpdateCallback) {
            console.warn('RSS调度器：未设置订阅源更新回调函数');
            return;
        }

        const now = new Date();
        for (const feed of this.feeds) {
            if (!feed.enabled) {
                continue;
            }

            if (await this.shouldUpdateFeed(feed, now)) {
                try {
                    await this.feedUpdateCallback(feed);
                    console.log(`自动更新RSS订阅源成功: ${feed.name}`);
                } catch (error) {
                    console.error(`自动更新RSS订阅源失败 [${feed.name}]:`, error);
                }
            }
        }
    }

    /**
     * 判断是否需要更新指定的订阅源
     */
    private async shouldUpdateFeed(feed: RSSFeed, now: Date): Promise<boolean> {
        const updateInterval = this.minutesToMs(feed.updateInterval || 60);
        
        // 从存储服务获取最后更新时间
        const lastUpdated = await this.getLastUpdatedTime(feed.id);
        
        return !lastUpdated || (now.getTime() - lastUpdated.getTime()) >= updateInterval;
    }

    /**
     * 获取订阅源的最后更新时间
     */
    private async getLastUpdatedTime(feedId: string): Promise<Date | undefined> {
        if (this.getLastUpdatedTimeCallback) {
            return await this.getLastUpdatedTimeCallback(feedId);
        }
        // 如果没有设置回调，返回 undefined，表示总是需要更新
        return undefined;
    }

    /**
     * 将分钟转换为毫秒
     */
    private minutesToMs(minutes: number): number {
        return minutes * 60 * 1000;
    }

    /**
     * 获取当前是否正在运行自动更新
     */
    public isRunning(): boolean {
        return this.updateTimer !== undefined;
    }

    /**
     * 手动触发一次检查和更新
     */
    public async triggerUpdate(): Promise<void> {
        console.log('手动触发RSS订阅源更新检查');
        await this.checkAndUpdateFeeds();
    }

    /**
     * 销毁调度器，清理资源
     */
    public dispose(): void {
        this.stopAutoUpdate();
        this.feedUpdateCallback = undefined;
        this.feeds = [];
        console.log('RSS调度器已销毁');
    }
}
