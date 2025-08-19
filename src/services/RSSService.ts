import * as vscode from 'vscode';
import { RSSFeed, RSSItem } from './types/RSSTypes';
import { RSSConfig,  DEFAULT_RSS_CONFIG } from './types/RSSConfig';
import { RSSFetcher } from './fetcher/RSSFetcher';
import { RSSParser } from './parser/RSSParser';
import { RSSHelper } from './utils/RSSHelper';
import { RSSMarkdownConverter } from './converters/RSSMarkdownConverter';
import { RSSStorageService } from './storage/RSSStorageService';
import { getIssueDir, getRSSDefaultUpdateInterval } from '../config';
import { generateFileName,  writeJSONLFile, readJSONLFile } from '../utils/fileUtils';

/**
 * RSS服务数据结构：将订阅源状态和文章记录在一起
 */
interface RSSFeedData {
    lastUpdated?: string;
    items: RSSItem[];
}

/**
 * JSONL格式的RSS记录结构
 */
interface RSSFeedRecord {
    feedId: string;
    lastUpdated?: string;
    items: RSSItem[];
}

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
            const mergedItems = this.mergeRSSItems(existingItems, newItems);
            
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
     * 合并RSS文章，保留历史记录并去重
     */
    private mergeRSSItems(existingItems: RSSItem[], newItems: RSSItem[]): RSSItem[] {
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

        // 限制每个订阅源最多保存500篇文章，避免数据过多
        const maxItems = vscode.workspace.getConfiguration('issueManager').get<number>('rss.maxItemsPerFeed', 500);  
        return mergedItems.slice(0, maxItems);  
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
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

        let removedCount = 0;

        for (const [feedId, feedData] of this.feedData) {
            const originalLength = feedData.items.length;
            const filteredItems = feedData.items.filter((item: RSSItem) => item.pubDate >= cutoffDate);
            
            if (filteredItems.length !== originalLength) {
                removedCount += (originalLength - filteredItems.length);
                this.feedData.set(feedId, {
                    ...feedData,
                    items: filteredItems
                });
            }
        }

        if (removedCount > 0) {
            await this.saveRSSItemsHistory();
            console.log(`已清理${removedCount}个${daysToKeep}天前的RSS文章记录`);
        }

        return { removedCount };
    }

    /**
     * 获取RSS文章历史统计信息
     */
    public getHistoryStats(): { totalItems: number; oldestDate?: Date; newestDate?: Date; itemsByFeed: Record<string, number> } {
        let totalItems = 0;
        let oldestDate: Date | undefined;
        let newestDate: Date | undefined;
        const itemsByFeed: Record<string, number> = {};

        for (const [feedId, feedData] of this.feedData) {
            const items = feedData.items;
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
     * 压缩RSS历史记录（移除重复项和超出限制的旧记录）
     * 使用JSONL格式的优势进行高效压缩
     */
    public async compactHistory(): Promise<{ removedItems: number; compactedFeeds: number }> {
        let removedItems = 0;
        let compactedFeeds = 0;
        const maxItemsPerFeed = 500; // 每个订阅源最多保留500篇文章

        for (const [feedId, feedData] of this.feedData) {
            const originalCount = feedData.items.length;
            
            if (originalCount > maxItemsPerFeed) {
                // 按时间排序，保留最新的文章
                feedData.items.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
                feedData.items = feedData.items.slice(0, maxItemsPerFeed);
                
                removedItems += (originalCount - feedData.items.length);
                compactedFeeds++;
            }

            // 去重：移除相同ID的重复文章
            const uniqueItems = new Map<string, RSSItem>();
            for (const item of feedData.items) {
                if (!uniqueItems.has(item.id)) {
                    uniqueItems.set(item.id, item);
                }
            }
            
            if (uniqueItems.size !== feedData.items.length) {
                const duplicateCount = feedData.items.length - uniqueItems.size;
                feedData.items = Array.from(uniqueItems.values());
                removedItems += duplicateCount;
                if (duplicateCount > 0) {
                    compactedFeeds++;
                }
            }
        }

        if (removedItems > 0) {
            await this.saveRSSItemsHistory();
            console.log(`历史记录压缩完成：移除${removedItems}个项目，优化${compactedFeeds}个订阅源`);
        }

        return { removedItems, compactedFeeds };
    }

    /**
     * 导出RSS历史记录到指定文件（便于手动同步）
     * @param exportPath 导出文件路径
     */
    public async exportHistory(exportPath?: string): Promise<string | null> {
        try {
            const records: RSSFeedRecord[] = [];
            
            for (const [feedId, feedData] of this.feedData) {
                records.push({
                    feedId,
                    lastUpdated: feedData.lastUpdated?.toISOString(),
                    items: feedData.items
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
     * @param importPath 导入文件路径
     * @param mergeStrategy 合并策略：'replace' | 'merge'
     */
    public async importHistory(importPath: string, mergeStrategy: 'replace' | 'merge' = 'merge'): Promise<boolean> {
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
                const existingData = this.feedData.get(record.feedId);
                const convertedItems = record.items.map((item: any) => ({
                    ...item,
                    pubDate: new Date(item.pubDate)
                }));

                if (mergeStrategy === 'replace' || !existingData) {
                    // 替换或新增
                    this.feedData.set(record.feedId, {
                        lastUpdated: record.lastUpdated ? new Date(record.lastUpdated) : undefined,
                        items: convertedItems
                    });
                    importedFeeds++;
                    importedItems += convertedItems.length;
                } else {
                    // 合并策略：合并文章并去重
                    const mergedItems = this.mergeRSSItems(existingData.items, convertedItems);
                    const newLastUpdated = record.lastUpdated && 
                        (!existingData.lastUpdated || new Date(record.lastUpdated) > existingData.lastUpdated)
                        ? new Date(record.lastUpdated) : existingData.lastUpdated;
                    
                    this.feedData.set(record.feedId, {
                        lastUpdated: newLastUpdated,
                        items: mergedItems
                    });
                    importedFeeds++;
                    importedItems += (mergedItems.length - existingData.items.length);
                }
            }

            await this.saveRSSItemsHistory();
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
     * @param daysToFetch 获取最近几天的文章，默认7天
     */
    public async rebuildHistory(daysToFetch: number = 7): Promise<{ rebuiltFeeds: number; totalItems: number }> {
        let rebuiltFeeds = 0;
        let totalItems = 0;

        const enabledFeeds = this.feeds.filter(feed => feed.enabled);
        
        for (const feed of enabledFeeds) {
            try {
                const items = await this.fetchFeed(feed);
                const cutoffDate = new Date();
                cutoffDate.setDate(cutoffDate.getDate() - daysToFetch);
                
                // 只保留指定天数内的文章
                const recentItems = items.filter(item => item.pubDate >= cutoffDate);
                
                this.feedData.set(feed.id, {
                    lastUpdated: new Date(),
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
            await this.saveRSSItemsHistory();
            vscode.window.showInformationMessage(
                `历史记录重建完成: ${rebuiltFeeds}个订阅源，共${totalItems}篇文章`
            );
        }

        return { rebuiltFeeds, totalItems };
    }

    // 静态方法，保持向后兼容
    public static showRSSFormatHelp = RSSHelper.showRSSFormatHelp;
    public static showJSONFeedHelp = RSSHelper.showJSONFeedHelp;
}

// 导出类型，保持向后兼容
export { RSSFeed, RSSItem } from './types/RSSTypes';
