import * as vscode from 'vscode';
import { RSSFeed, RSSItem } from './types/RSSTypes';
import { RSSConfig,  DEFAULT_RSS_CONFIG } from './types/RSSConfig';
import { RSSFetcher } from './fetcher/RSSFetcher';
import { RSSParser } from './parser/RSSParser';
import { RSSHelper } from './utils/RSSHelper';
import { RSSMarkdownConverter } from './converters/RSSMarkdownConverter';
import { RSSStorageService } from './storage/RSSStorageService';
import { RSSHistoryManager, RSSFeedRecord } from './history/RSSHistoryManager';
import { RSSStatsService } from './stats/RSSStatsService';
import { getIssueDir, getRSSDefaultUpdateInterval } from '../config';
import { generateFileName,  writeJSONLFile, readJSONLFile } from '../utils/fileUtils';

/**
 * RSS服务，负责管理RSS订阅源和获取RSS内容
 * 支持JSON Feed格式和传统XML RSS/Atom格式
 */
export class RSSService {
    private static instance: RSSService;
    private feeds: RSSFeed[] = [];
    private config: RSSConfig = DEFAULT_RSS_CONFIG;
    private feedData: Map<string, { lastUpdated?: Date; items: RSSItem[] }> = new Map();
    private updateTimer?: NodeJS.Timeout;
    // 每30分钟检查一次是否需要更新
    static readonly AUTO_UPDATE_CHECK_INTERVAL = 30 * 60 * 1000;

    private constructor() {
        this.initializeAsync();
    }

    /**
     * 异步初始化
     */
    private async initializeAsync(): Promise<void> {
        await this.loadConfig();
        await this.loadRSSItemsHistory();
        this.startAutoUpdate();
    }

    public static getInstance(): RSSService {
        if (!RSSService.instance) {
            RSSService.instance = new RSSService();
        }
        return RSSService.instance;
    }

    /**
     * 获取所有RSS订阅源
     */
    public getFeeds(): RSSFeed[] {
        return [...this.feeds];
    }

    /**
     * 添加RSS订阅源（支持JSON Feed和XML RSS格式）
     */
    public async addFeed(name: string, url: string): Promise<boolean> {
        const id = RSSHelper.generateFeedId();
        const feed: RSSFeed = {
            id,
            name,
            url,
            enabled: true,
            updateInterval: getRSSDefaultUpdateInterval() // 默认60分钟更新一次
        };

        try {
            // 验证RSS URL是否有效
            await this.fetchFeed(feed);
            this.feeds.push(feed);
            await this.saveFeeds();
            vscode.window.showInformationMessage(`成功添加RSS订阅源: ${name}`);
            return true;
        } catch (error) {
            console.error('添加RSS订阅源失败:', error);
            
            // 显示用户友好的错误提示
            const errorMessage = error instanceof Error ? error.message : '未知错误';
            
            if (errorMessage.includes('检测到HTML页面')) {
                vscode.window.showErrorMessage(`无法添加订阅源 "${name}": 提供的URL指向HTML页面，请确认URL指向RSS订阅源（支持JSON Feed或XML RSS格式）。`,
                    '查看格式说明').then(selection => {
                    if (selection === '查看格式说明') {
                        RSSHelper.showRSSFormatHelp();
                    }
                });
            } else if (errorMessage.includes('返回空内容')) {
                vscode.window.showErrorMessage(`无法添加订阅源 "${name}": 订阅源返回空内容，请检查URL是否正确。`);
            } else {
                vscode.window.showErrorMessage(`无法添加订阅源 "${name}": ${errorMessage}`, 
                    '查看格式说明', '了解JSON Feed').then(selection => {
                    if (selection === '查看格式说明') {
                        RSSHelper.showRSSFormatHelp();
                    } else if (selection === '了解JSON Feed') {
                        vscode.env.openExternal(vscode.Uri.parse('https://jsonfeed.org/'));
                    }
                });
            }
            
            return false;
        }
    }

    /**
     * 删除RSS订阅源
     */
    public async removeFeed(feedId: string): Promise<boolean> {
        const index = this.feeds.findIndex(f => f.id === feedId);
        if (index !== -1) {
            this.feeds.splice(index, 1);
            this.feedData.delete(feedId); // 删除数据和状态记录
            await this.saveFeeds();
            await this.saveRSSItemsHistory(); // 保存更新后的历史记录
            return true;
        }
        return false;
    }

    /**
     * 更新RSS订阅源的启用状态
     */
    public async toggleFeed(feedId: string, enabled: boolean): Promise<boolean> {
        const feed = this.feeds.find(f => f.id === feedId);
        if (feed) {
            feed.enabled = enabled;
            await this.saveFeeds();
            return true;
        }
        return false;
    }

    /**
     * 获取指定订阅源的最后更新时间
     */
    public getFeedLastUpdated(feedId: string): Date | undefined {
        const feedData = this.feedData.get(feedId);
        return feedData?.lastUpdated;
    }

    /**
     * 获取指定订阅源的文章列表
     */
    public getFeedItems(feedId: string): RSSItem[] {
        const feedData = this.feedData.get(feedId);
        return feedData?.items || [];
    }

    /**
     * 获取所有启用订阅源的文章列表
     */
    public getAllItems(): RSSItem[] {
        const allItems: RSSItem[] = [];
        for (const feed of this.feeds) {
            if (feed.enabled) {
                const feedData = this.feedData.get(feed.id);
                const items = feedData?.items || [];
                allItems.push(...items);
            }
        }
        return allItems.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
    }

    /**
     * 手动更新所有订阅源
     */
    public async updateAllFeeds(): Promise<void> {
        const promises = this.feeds
            .filter(feed => feed.enabled)
            .map(feed => this.updateFeed(feed));

        await Promise.allSettled(promises);
    }

    /**
     * 更新单个订阅源
     */
    public async updateFeed(feed: RSSFeed): Promise<void> {
        try {
            const newItems = await this.fetchFeed(feed);
            const feedData = this.feedData.get(feed.id);
            const existingItems = feedData?.items || [];
            
            // 合并新文章和现有文章，保留历史记录
            const mergedItems = RSSHistoryManager.mergeRSSItems(existingItems, newItems);
            
            // 更新数据和状态
            this.feedData.set(feed.id, {
                lastUpdated: new Date(),
                items: mergedItems
            });
            
            await this.saveRSSItemsHistory(); // 保存文章历史记录和状态
        } catch (error) {
            console.error(`更新RSS订阅源失败 [${feed.name}]:`, error);
            
            // 根据错误类型提供不同的提示
            const errorMessage = error instanceof Error ? error.message : '未知错误';
            
            if (errorMessage.includes('网络') || errorMessage.includes('超时') || errorMessage.includes('连接')) {
                // 网络错误不显示弹窗，只记录日志
                console.warn(`订阅源 "${feed.name}" 网络更新失败，将在下次检查时重试`);
            } else {
                vscode.window.showWarningMessage(`订阅源 "${feed.name}" 更新失败: ${errorMessage}`);
            }
            
            throw error;
        }
    }

    /**
     * 将RSS文章转换为Markdown格式并保存到问题目录
     */
    public async convertToMarkdown(item: RSSItem): Promise<vscode.Uri | null> {
        const issueDir = getIssueDir();
        if (!issueDir) {
            vscode.window.showErrorMessage('请先配置问题目录');
            return null;
        }

        const feed = this.feeds.find(f => f.id === item.feedId);

        const filename = generateFileName();
        const uri = vscode.Uri.joinPath(vscode.Uri.file(issueDir), filename);

        // 生成Markdown内容
        const markdown = RSSMarkdownConverter.convertToMarkdown(item, feed);

        try {
            await vscode.workspace.fs.writeFile(uri, Buffer.from(markdown, 'utf8'));
            return uri;
        } catch (error) {
            console.error('保存Markdown文件失败:', error);
            vscode.window.showErrorMessage('保存文件失败');
            return null;
        }
    }

    /**
     * 创建RSS文章的虚拟文件URI
     */
    public createVirtualFile(item: RSSItem): vscode.Uri {
        const feed = this.feeds.find(f => f.id === item.feedId);
        const feedName = feed?.name || 'RSS';

        // 生成虚拟文件名
        const safeTitle = RSSHelper.sanitizeFilename(item.title);
        const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const filename = `RSS-${RSSHelper.sanitizeFilename(feedName)}-${safeTitle}-${timestamp}.md`;

        // 创建虚拟文件URI，使用自定义scheme
        const virtualUri = vscode.Uri.parse(`rss-preview:${filename}?itemId=${encodeURIComponent(item.id)}`);
        return virtualUri;
    }

    /**
     * 获取RSS文章的Markdown内容（用于虚拟文件提供器）
     */
    public getItemMarkdown(itemId: string): string | null {
        // 从所有订阅源中查找指定ID的文章
        for (const [feedId, feedData] of this.feedData) {
            const item = feedData.items.find((i: RSSItem) => i.id === itemId);
            if (item) {
                const feed = this.feeds.find(f => f.id === feedId);
                return RSSMarkdownConverter.generatePreviewMarkdown(item, feed);
            }
        }
        return null;
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
        }, RSSService.AUTO_UPDATE_CHECK_INTERVAL);
    }

    /**
     * 停止自动更新
     */
    public stopAutoUpdate(): void {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
            this.updateTimer = undefined;
        }
    }

    /**
     * 检查并更新需要更新的订阅源
     */
    private async checkAndUpdateFeeds(): Promise<void> {
        const now = new Date();
        for (const feed of this.feeds) {
            if (!feed.enabled) {
                continue;
            }

            const updateInterval = this.minutesToMs(feed.updateInterval || 60); // 转换为毫秒
            const feedData = this.feedData.get(feed.id);
            const lastUpdated = feedData?.lastUpdated;
            const needUpdate = !lastUpdated ||
                (now.getTime() - lastUpdated.getTime()) >= updateInterval;

            if (needUpdate) {
                try {
                    await this.updateFeed(feed);
                } catch (error) {
                    console.error(`自动更新RSS订阅源失败 [${feed.name}]:`, error);
                }
            }
        }
    }

    /**
     * 从RSS URL获取文章列表
     */
    private async fetchFeed(feed: RSSFeed): Promise<RSSItem[]> {
        try {
            const responseText = await RSSFetcher.fetchContent(feed.url);
            return RSSParser.parseContent(responseText, feed.id);
        } catch (error) {
            throw new Error(`获取RSS内容失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
    }

    /**
     * 加载RSS配置从YAML文件
     */
    private async loadConfig(): Promise<void> {
        this.config = await RSSStorageService.loadConfig();
        this.updateFeedsFromConfig();
    }

    /**
     * 从配置更新feeds数组
     */
    private updateFeedsFromConfig(): void {
        // 从VS Code配置获取默认更新间隔（分钟）
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
     * 保存RSS配置到YAML文件
     */
    private async saveConfig(): Promise<void> {
        await RSSStorageService.saveConfig(this.config);
    }

    /**
     * 保存订阅源配置到YAML文件
     */
    private async saveFeeds(): Promise<void> {
        // 更新配置中的feeds数组
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

        // 保存整个配置
        await this.saveConfig();
    }

    /**
     * 从本地文件加载RSS文章历史记录和状态
     * 使用Git友好的分离存储：每个订阅源一个文件 + 独立的状态文件
     */
    private async loadRSSItemsHistory(): Promise<void> {
        // 加载订阅源状态
        const feedStates = await RSSStorageService.loadFeedStates();
        
        // 加载所有订阅源的文章
        const feedItemsMap = await RSSStorageService.loadAllFeedItems(this.feeds);
        
        // 合并状态和文章数据
        for (const feed of this.feeds) {
            const state = feedStates.get(feed.id) || {};
            const items = feedItemsMap.get(feed.id) || [];
            
            this.feedData.set(feed.id, {
                lastUpdated: state.lastUpdated,
                items: items
            });
        }
    }

    /**
     * 保存RSS文章历史记录和状态到分离的文件中（Git友好）
     */
    private async saveRSSItemsHistory(): Promise<void> {
        // 准备状态数据
        const feedStates = new Map<string, { lastUpdated?: Date }>();
        const feedItemsMap = new Map<string, RSSItem[]>();
        
        for (const [feedId, feedData] of this.feedData) {
            feedStates.set(feedId, { lastUpdated: feedData.lastUpdated });
            feedItemsMap.set(feedId, feedData.items);
        }
        
        // 使用存储服务保存
        await RSSStorageService.saveFeedStates(feedStates);
        await RSSStorageService.saveAllFeedItems(feedItemsMap);
    }

    /**
     * 将分钟转换为毫秒
     */
    private minutesToMs(minutes: number): number {
        return minutes * 60 * 1000;
    }

    /**
     * 清理资源
     */
    public dispose(): void {
        this.stopAutoUpdate();
    }

    /**
     * 清理旧的RSS文章历史记录
     * @param daysToKeep 保留天数，默认30天
     */
    public async cleanupOldItems(daysToKeep: number = 30): Promise<{ removedCount: number }> {
        return await RSSHistoryManager.cleanupOldItems(this.feedData, daysToKeep);
    }

    /**
     * 获取RSS文章历史统计信息
     */
    public getHistoryStats(): { totalItems: number; oldestDate?: Date; newestDate?: Date; itemsByFeed: Record<string, number> } {
        return RSSStatsService.getHistoryStats(this.feedData);
    }

    /**
     * 压缩RSS历史记录（移除重复项和超出限制的旧记录）
     * 使用JSONL格式的优势进行高效压缩
     */
    public async compactHistory(): Promise<{ removedItems: number; compactedFeeds: number }> {
        const maxItems = vscode.workspace.getConfiguration('issueManager').get<number>('rss.maxItemsPerFeed', 500);
        return await RSSHistoryManager.compactHistory(this.feedData, maxItems);
    }

    /**
     * 导出RSS历史记录到指定文件（便于手动同步）
     * @param exportPath 导出文件路径
     */
    public async exportHistory(exportPath?: string): Promise<string | null> {
        return await RSSHistoryManager.exportHistory(this.feedData, exportPath);
    }

    /**
     * 从文件导入RSS历史记录（便于手动同步）
     * @param importPath 导入文件路径
     * @param mergeStrategy 合并策略：'replace' | 'merge'
     */
    public async importHistory(importPath: string, mergeStrategy: 'replace' | 'merge' = 'merge'): Promise<boolean> {
        const result = await RSSHistoryManager.importHistory(
            this.feedData, 
            importPath, 
            mergeStrategy
        );
        
        if (result) {
            await this.saveRSSItemsHistory();
        }
        
        return result;
    }

    /**
     * 重建历史记录（从订阅源重新获取最近文章）
     * @param daysToFetch 获取最近几天的文章，默认7天
     */
    public async rebuildHistory(daysToFetch: number = 7): Promise<{ rebuiltFeeds: number; totalItems: number }> {
        const result = await RSSHistoryManager.rebuildHistory(
            this.feeds, 
            this.feedData, 
            (feed: RSSFeed) => this.fetchFeed(feed),
            daysToFetch
        );
        
        if (result.rebuiltFeeds > 0) {
            await this.saveRSSItemsHistory();
        }
        
        return result;
    }

    // 静态方法，保持向后兼容
    public static showRSSFormatHelp = RSSHelper.showRSSFormatHelp;
    public static showJSONFeedHelp = RSSHelper.showJSONFeedHelp;
}

// 导出类型，保持向后兼容
export { RSSFeed, RSSItem } from './types/RSSTypes';
