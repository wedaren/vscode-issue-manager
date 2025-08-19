import * as vscode from 'vscode';
import { RSSFeed } from '../types/RSSTypes';
import { RSSConfig, DEFAULT_RSS_CONFIG } from '../types/RSSConfig';
import { RSSStorageService } from '../storage/RSSStorageService';
import { getRSSDefaultUpdateInterval } from '../../config';

/**
 * RSS配置管理服务
 * 负责管理RSS订阅源配置和相关操作
 */
export class RSSConfigService {
    private config: RSSConfig = DEFAULT_RSS_CONFIG;
    private feeds: RSSFeed[] = [];

    /**
     * 加载RSS配置
     */
    public async loadConfig(): Promise<void> {
        this.config = await RSSStorageService.loadConfig();
        this.updateFeedsFromConfig();
    }

    /**
     * 保存RSS配置
     */
    public async saveConfig(): Promise<void> {
        await RSSStorageService.saveConfig(this.config);
    }

    /**
     * 获取所有订阅源
     */
    public getFeeds(): RSSFeed[] {
        return [...this.feeds];
    }

    /**
     * 获取配置对象
     */
    public getConfig(): RSSConfig {
        return { ...this.config };
    }

    /**
     * 添加订阅源
     */
    public async addFeed(name: string, url: string, enabled: boolean = true): Promise<RSSFeed> {
        const id = this.generateFeedId();
        const feed: RSSFeed = {
            id,
            name,
            url,
            enabled,
            updateInterval: getRSSDefaultUpdateInterval()
        };

        this.feeds.push(feed);
        await this.updateConfigFromFeeds();
        await this.saveConfig();

        return feed;
    }

    /**
     * 移除订阅源
     */
    public async removeFeed(feedId: string): Promise<boolean> {
        const index = this.feeds.findIndex(feed => feed.id === feedId);
        if (index === -1) {
            return false;
        }

        this.feeds.splice(index, 1);
        await this.updateConfigFromFeeds();
        await this.saveConfig();

        return true;
    }

    /**
     * 切换订阅源启用状态
     */
    public async toggleFeed(feedId: string, enabled: boolean): Promise<boolean> {
        const feed = this.feeds.find(f => f.id === feedId);
        if (!feed) {
            return false;
        }

        feed.enabled = enabled;
        await this.updateConfigFromFeeds();
        await this.saveConfig();

        return true;
    }

    /**
     * 更新订阅源配置
     */
    public async updateFeedConfig(feedId: string, updates: Partial<RSSFeed>): Promise<boolean> {
        const feed = this.feeds.find(f => f.id === feedId);
        if (!feed) {
            return false;
        }

        Object.assign(feed, updates);
        await this.updateConfigFromFeeds();
        await this.saveConfig();

        return true;
    }

    /**
     * 根据ID查找订阅源
     */
    public findFeedById(feedId: string): RSSFeed | undefined {
        return this.feeds.find(feed => feed.id === feedId);
    }

    /**
     * 获取启用的订阅源
     */
    public getEnabledFeeds(): RSSFeed[] {
        return this.feeds.filter(feed => feed.enabled);
    }

    /**
     * 从配置更新feeds数组
     */
    private updateFeedsFromConfig(): void {
        const vsConfig = vscode.workspace.getConfiguration('issueManager');
        const defaultUpdateInterval = vsConfig.get<number>('rss.defaultUpdateInterval', 60);

        this.feeds = this.config.feeds.map(feedConfig => ({
            id: feedConfig.id,
            name: feedConfig.name,
            url: feedConfig.url,
            enabled: feedConfig.enabled,
            updateInterval: feedConfig.updateInterval || defaultUpdateInterval
        }));
    }

    /**
     * 从feeds数组更新配置
     */
    private async updateConfigFromFeeds(): Promise<void> {
        this.config.feeds = this.feeds.map(feed => {
            const existingConfig = this.config.feeds.find(f => f.id === feed.id);
            return {
                id: feed.id,
                name: feed.name,
                url: feed.url,
                enabled: feed.enabled,
                updateInterval: feed.updateInterval,
                tags: existingConfig?.tags || [],
                description: existingConfig?.description || ""
            };
        });
    }

    /**
     * 生成唯一的订阅源ID
     */
    private generateFeedId(): string {
        return 'feed_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5);
    }

    /**
     * 验证订阅源配置
     */
    public validateFeedConfig(name: string, url: string): { valid: boolean; error?: string } {
        if (!name || name.trim().length === 0) {
            return { valid: false, error: '订阅源名称不能为空' };
        }

        if (!url || url.trim().length === 0) {
            return { valid: false, error: 'RSS URL不能为空' };
        }

        try {
            new URL(url);
        } catch {
            return { valid: false, error: 'RSS URL格式不正确' };
        }

        // 检查是否已存在相同的URL
        const existingFeed = this.feeds.find(feed => feed.url === url);
        if (existingFeed) {
            return { valid: false, error: '该RSS订阅源已存在' };
        }

        return { valid: true };
    }

    /**
     * 获取订阅源统计信息
     */
    public getConfigStats(): { totalFeeds: number; enabledFeeds: number; disabledFeeds: number } {
        const totalFeeds = this.feeds.length;
        const enabledFeeds = this.feeds.filter(feed => feed.enabled).length;
        const disabledFeeds = totalFeeds - enabledFeeds;

        return {
            totalFeeds,
            enabledFeeds,
            disabledFeeds
        };
    }
}
