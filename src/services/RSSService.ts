import * as vscode from 'vscode';
import { RSSFeed, RSSItem } from './types/RSSTypes';
import { RSSHelper } from './utils/RSSHelper';
import { RSSMarkdownConverter } from './converters/RSSMarkdownConverter';
import { RSSStorageService } from './storage/RSSStorageService';
import { RSSHistoryManager, RSSFeedRecord } from './history/RSSHistoryManager';
import { RSSStatsService } from './stats/RSSStatsService';
import { RSSScheduler } from './scheduler/RSSScheduler';
import { RSSContentService } from './content/RSSContentService';
import { RSSConfigService } from './config/RSSConfigService';
import { getIssueDir } from '../config';
import { generateFileName } from '../utils/fileUtils';

/**
 * RSS服务门面 - 协调各个专门的RSS服务
 * 作为统一的入口点管理RSS功能
 */
export class RSSService {
    private static instance: RSSService;
    private feedData: Map<string, { lastUpdated?: Date; items: RSSItem[] }> = new Map();

    // 核心服务实例
    private configService: RSSConfigService;
    private scheduler: RSSScheduler;
    private contentService: RSSContentService;

    // 初始化状态
    private initializationPromise: Promise<void>;

    private constructor() {
        // 初始化配置服务
        this.configService = new RSSConfigService();

        // 初始化内容服务
        this.contentService = new RSSContentService(
            this.feedData,
            () => this.saveRSSItemsHistory()
        );

        // 初始化调度器
        this.scheduler = new RSSScheduler(
            [],
            (feed) => this.contentService.updateFeed(feed),
            (feedId) => this.getLastUpdatedTime(feedId)
        );

        this.initializationPromise = this.initializeAsync();
    }

    /**
     * 异步初始化
     */
    private async initializeAsync(): Promise<void> {
        await this.configService.loadConfig();
        await this.loadRSSItemsHistory();

        // 更新调度器中的订阅源列表
        this.scheduler.updateFeeds(this.configService.getFeeds());
        this.scheduler.startAutoUpdate();
    }

    public static getInstance(): RSSService {
        if (!RSSService.instance) {
            RSSService.instance = new RSSService();
        }
        return RSSService.instance;
    }

    /**
     * 等待初始化完成
     */
    public async waitForInitialization(): Promise<void> {
        await this.initializationPromise;
    }

    /**
     * 获取所有RSS订阅源
     */
    public getFeeds(): RSSFeed[] {
        return this.configService.getFeeds();
    }

    /**
     * 获取订阅源的最后更新时间
     */
    private async getLastUpdatedTime(feedId: string): Promise<Date | undefined> {
        const feedData = this.feedData.get(feedId);
        return feedData?.lastUpdated;
    }

    /**
     * 添加RSS订阅源（支持JSON Feed和XML RSS格式）
     */
    public async addFeed(name: string, url: string): Promise<boolean> {
        try {
            // 验证配置
            const validation = this.configService.validateFeedConfig(name, url);
            if (!validation.valid) {
                vscode.window.showErrorMessage(validation.error || '配置验证失败');
                return false;
            }

            // 添加到配置服务
            const feed = await this.configService.addFeed(name, url);

            // 验证RSS URL是否有效
            await this.contentService.fetchFeed(feed);

            // 更新调度器
            this.scheduler.updateFeeds(this.configService.getFeeds());

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
        const success = await this.configService.removeFeed(feedId);
        if (success) {
            this.feedData.delete(feedId); // 删除数据和状态记录
            await this.saveRSSItemsHistory(); // 保存更新后的历史记录

            // 更新调度器
            this.scheduler.updateFeeds(this.configService.getFeeds());
        }
        return success;
    }

    /**
     * 更新RSS订阅源的启用状态
     */
    public async toggleFeed(feedId: string, enabled: boolean): Promise<boolean> {
        const success = await this.configService.toggleFeed(feedId, enabled);
        if (success) {
            // 更新调度器
            this.scheduler.updateFeeds(this.configService.getFeeds());
        }
        return success;
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
        return this.contentService.getRecentItems(feedId, Number.MAX_SAFE_INTEGER);
    }

    /**
     * 获取所有启用订阅源的文章列表
     */
    public getAllItems(): RSSItem[] {
        return this.contentService.getAllRecentItems(Number.MAX_SAFE_INTEGER);
    }

    /**
     * 手动更新所有订阅源
     */
    public async updateAllFeeds(): Promise<void> {
        return await this.contentService.updateFeeds(this.configService.getFeeds());
    }

    /**
     * 更新单个订阅源
     */
    public async updateFeed(feed: RSSFeed): Promise<void> {
        return await this.contentService.updateFeed(feed);
    }

    /**
     * 将RSS文章转换为Markdown格式并保存到问题目录
     */
    public async convertToMarkdownUri(item: RSSItem): Promise<vscode.Uri | null> {
        const issueDir = getIssueDir();
        if (!issueDir) {
            vscode.window.showErrorMessage('请先配置问题目录');
            return null;
        }

        const feed = this.configService.findFeedById(item.feedId);

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
        const feed = this.configService.findFeedById(item.feedId);
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
     * 获取RSS文章的Markdown内容
     */
    public getItemMarkdown(itemId: string): string | null {
        // 从所有订阅源中查找指定ID的文章
        for (const [feedId, feedData] of this.feedData) {
            const item = feedData.items.find((i: RSSItem) => i.id === itemId);
            if (item) {
                const feed = this.configService.findFeedById(feedId);
                return RSSMarkdownConverter.convertToMarkdown(item, feed);
            }
        }
        return null;
    }

    /**
     * 启动自动更新
     */
    public startAutoUpdate(): void {
        this.scheduler.startAutoUpdate();
    }

    /**
     * 停止自动更新
     */
    public stopAutoUpdate(): void {
        this.scheduler.stopAutoUpdate();
    }

    /**
     * 从本地文件加载RSS文章历史记录和状态
     * 使用Git友好的分离存储：每个订阅源一个文件 + 独立的状态文件
     */
    private async loadRSSItemsHistory(): Promise<void> {
        // 加载订阅源状态
        const feedStates = await RSSStorageService.loadFeedStates();

        // 加载所有订阅源的文章
        const feeds = this.configService.getFeeds();
        const feedItemsMap = await RSSStorageService.loadAllFeedItems(feeds);

        // 合并状态和文章数据
        for (const feed of feeds) {
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
            this.configService.getFeeds(),
            this.feedData,
            (feed: RSSFeed) => this.contentService.fetchFeed(feed),
            daysToFetch
        );

        if (result.rebuiltFeeds > 0) {
            await this.saveRSSItemsHistory();
        }

        return result;
    }

    /**
     * 销毁服务，清理所有资源
     */
    public dispose(): void {
        this.scheduler.dispose();
        this.contentService.dispose();
        console.log('RSS服务已销毁');
    }

    // 静态方法，保持向后兼容
    public static showRSSFormatHelp = RSSHelper.showRSSFormatHelp;
    public static showJSONFeedHelp = RSSHelper.showJSONFeedHelp;
}

// 导出类型，保持向后兼容
export { RSSFeed, RSSItem } from './types/RSSTypes';
