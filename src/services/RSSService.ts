import * as vscode from 'vscode';
import * as path from 'path';
import { RSSFeed, RSSItem } from './types/RSSTypes';
import { RSSFetcher } from './fetcher/RSSFetcher';
import { RSSParser } from './parser/RSSParser';
import { RSSHelper } from './utils/RSSHelper';
import { getIssueDir } from '../config';
import { generateFileName, ensureIssueManagerDir, getRSSHistoryFilePath, readYAMLFile, writeYAMLFile } from '../utils/fileUtils';

/**
 * RSS服务，负责管理RSS订阅源和获取RSS内容
 * 支持JSON Feed格式和传统XML RSS/Atom格式
 */
export class RSSService {
    private static instance: RSSService;
    private feeds: RSSFeed[] = [];
    private feedItems: Map<string, RSSItem[]> = new Map();
    private updateTimer?: NodeJS.Timeout;

    private constructor() {
        this.loadFeeds();
        // 异步加载历史文章记录，不阻塞构造函数
        this.loadRSSItemsHistory().catch(error => {
            console.error('初始化RSS历史记录失败:', error);
        });
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
            updateInterval: 60 // 默认60分钟更新一次
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
            this.feedItems.delete(feedId);
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
     * 获取指定订阅源的文章列表
     */
    public getFeedItems(feedId: string): RSSItem[] {
        return this.feedItems.get(feedId) || [];
    }

    /**
     * 获取所有启用订阅源的文章列表
     */
    public getAllItems(): RSSItem[] {
        const allItems: RSSItem[] = [];
        for (const feed of this.feeds) {
            if (feed.enabled) {
                const items = this.feedItems.get(feed.id) || [];
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
            const existingItems = this.feedItems.get(feed.id) || [];
            
            // 合并新文章和现有文章，保留历史记录
            const mergedItems = this.mergeRSSItems(existingItems, newItems);
            this.feedItems.set(feed.id, mergedItems);
            
            feed.lastUpdated = new Date();
            await this.saveFeeds();
            await this.saveRSSItemsHistory(); // 保存文章历史记录
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
        const filepath = path.join(issueDir, filename);

        // 生成Markdown内容
        const markdown = this.generateMarkdownContent(item, feed);

        try {
            const uri = vscode.Uri.file(filepath);
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
        for (const [feedId, items] of this.feedItems) {
            const item = items.find(i => i.id === itemId);
            if (item) {
                const feed = this.feeds.find(f => f.id === feedId);
                return this.generateMarkdownContent(item, feed);
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

        // 每30分钟检查一次是否需要更新
        const AUTO_UPDATE_CHECK_INTERVAL = 30 * 60 * 1000;
        this.updateTimer = setInterval(async () => {
            await this.checkAndUpdateFeeds();
        }, AUTO_UPDATE_CHECK_INTERVAL);
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

            const updateInterval = (feed.updateInterval || 60) * 60 * 1000; // 转换为毫秒
            const needUpdate = !feed.lastUpdated ||
                (now.getTime() - feed.lastUpdated.getTime()) >= updateInterval;

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
     * 生成Markdown内容
     */
    private generateMarkdownContent(item: RSSItem, feed?: RSSFeed): string {
        const feedName = feed?.name || 'RSS订阅';
        const publishDate = item.pubDate.toLocaleString('zh-CN');

        let markdown = `# ${item.title}\n\n`;
        markdown += `**来源**: [${feedName}](${feed?.url || ''})\n\n`;
        markdown += `**原文链接**: [${item.link}](${item.link})\n\n`;
        markdown += `**发布时间**: ${publishDate}\n\n`;

        if (item.author) {
            markdown += `**作者**: ${item.author}\n\n`;
        }

        markdown += `## 描述\n\n${item.description}\n\n`;

        markdown += `${item.content}\n\n`;

        return markdown;
    }

    /**
     * 加载订阅源配置
     */
    private loadFeeds(): void {
        const config = vscode.workspace.getConfiguration('issueManager');
        const feedsConfig = config.get<RSSFeed[]>('rss.feeds', []);

        // 转换日期字符串为Date对象
        this.feeds = feedsConfig.map(feed => ({
            ...feed,
            lastUpdated: feed.lastUpdated ? new Date(feed.lastUpdated) : undefined
        }));
    }

    /**
     * 保存订阅源配置
     */
    private async saveFeeds(): Promise<void> {
        const config = vscode.workspace.getConfiguration('issueManager');
        await config.update('rss.feeds', this.feeds, vscode.ConfigurationTarget.Global);
    }

    /**
     * 从本地YAML文件加载RSS文章历史记录
     */
    private async loadRSSItemsHistory(): Promise<void> {
        const historyFilePath = getRSSHistoryFilePath();
        if (!historyFilePath) {
            console.log('无法获取RSS历史文件路径，可能没有工作区');
            return;
        }

        try {
            const itemsHistory = await readYAMLFile<{ [feedId: string]: any[] }>(historyFilePath);
            if (!itemsHistory) {
                console.log('RSS历史文件不存在或为空，初始化为空历史记录');
                return;
            }

            // 转换日期字符串为Date对象并加载到内存
            for (const [feedId, items] of Object.entries(itemsHistory)) {
                if (Array.isArray(items)) {
                    const convertedItems = items.map((item: any) => ({
                        ...item,
                        pubDate: new Date(item.pubDate)
                    }));
                    this.feedItems.set(feedId, convertedItems);
                }
            }

            console.log(`成功加载RSS历史记录，共 ${Object.keys(itemsHistory).length} 个订阅源`);
        } catch (error) {
            console.error('加载RSS历史记录失败:', error);
        }
    }

    /**
     * 保存RSS文章历史记录到本地YAML文件
     */
    private async saveRSSItemsHistory(): Promise<void> {
        const historyFilePath = getRSSHistoryFilePath();
        if (!historyFilePath) {
            console.error('无法获取RSS历史文件路径，保存失败');
            return;
        }

        // 确保目录存在
        const issueManagerDir = await ensureIssueManagerDir();
        if (!issueManagerDir) {
            console.error('无法创建 .issueManager 目录，保存失败');
            return;
        }

        try {
            const itemsHistory: { [feedId: string]: RSSItem[] } = {};

            // 转换为可序列化的格式
            for (const [feedId, items] of this.feedItems) {
                itemsHistory[feedId] = items;
            }

            const success = await writeYAMLFile(historyFilePath, itemsHistory);
            if (success) {
                console.log(`RSS历史记录已保存到: ${historyFilePath.fsPath}`);
            } else {
                console.error('保存RSS历史记录失败');
            }
        } catch (error) {
            console.error('保存RSS历史记录时发生错误:', error);
        }
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
        return mergedItems.slice(0, 500);
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

        for (const [feedId, items] of this.feedItems) {
            const originalLength = items.length;
            const filteredItems = items.filter(item => item.pubDate >= cutoffDate);
            
            if (filteredItems.length !== originalLength) {
                removedCount += (originalLength - filteredItems.length);
                this.feedItems.set(feedId, filteredItems);
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

        for (const [feedId, items] of this.feedItems) {
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

    // 静态方法，保持向后兼容
    public static showRSSFormatHelp = RSSHelper.showRSSFormatHelp;
    public static showJSONFeedHelp = RSSHelper.showJSONFeedHelp;
}

// 导出类型，保持向后兼容
export { RSSFeed, RSSItem } from './types/RSSTypes';
