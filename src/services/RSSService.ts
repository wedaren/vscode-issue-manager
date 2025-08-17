import * as vscode from 'vscode';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { getIssueDir } from '../config';

export interface RSSFeed {
    id: string;
    name: string;
    url: string;
    enabled: boolean;
    lastUpdated?: Date;
    updateInterval?: number; // 更新间隔（分钟）
}

export interface RSSItem {
    id: string;
    feedId: string;
    title: string;
    link: string;
    description: string;
    pubDate: Date;
    content?: string;
    author?: string;
    categories?: string[];
}

/**
 * RSS服务，负责管理RSS订阅源和获取RSS内容
 */
export class RSSService {
    private static instance: RSSService;
    private feeds: RSSFeed[] = [];
    private feedItems: Map<string, RSSItem[]> = new Map();
    private updateTimer?: NodeJS.Timeout;

    private constructor() {
        this.loadFeeds();
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
     * 添加RSS订阅源
     */
    public async addFeed(name: string, url: string): Promise<boolean> {
        const id = this.generateFeedId();
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
            return true;
        } catch (error) {
            console.error('添加RSS订阅源失败:', error);
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
            const items = await this.fetchFeed(feed);
            this.feedItems.set(feed.id, items);
            feed.lastUpdated = new Date();
            await this.saveFeeds();
        } catch (error) {
            console.error(`更新RSS订阅源失败 [${feed.name}]:`, error);
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
        const feedName = feed?.name || 'RSS';
        
        // 生成文件名：RSS-订阅源名-文章标题
        const safeTitle = this.sanitizeFilename(item.title);
        const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const filename = `RSS-${this.sanitizeFilename(feedName)}-${safeTitle}-${timestamp}.md`;
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
     * 启动自动更新
     */
    public startAutoUpdate(): void {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
        }

        // 每30分钟检查一次是否需要更新
        this.updateTimer = setInterval(async () => {
            await this.checkAndUpdateFeeds();
        }, 30 * 60 * 1000);
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
            const xmlText = await this.fetchXML(feed.url);
            return this.parseRSSXML(xmlText, feed.id);
        } catch (error) {
            throw new Error(`获取RSS内容失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
    }

    /**
     * 使用Node.js内置模块获取XML内容
     */
    private fetchXML(url: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const client = urlObj.protocol === 'https:' ? https : http;
            
            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; VSCode-Issue-Manager/1.0)',
                    'Accept': 'application/rss+xml, application/xml, text/xml'
                }
            };

            const req = client.request(options, (res) => {
                let data = '';
                
                // 检查状态码
                if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                    reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                    return;
                }

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    resolve(data);
                });
            });

            req.on('error', (err) => {
                reject(err);
            });

            req.setTimeout(30000, () => {
                req.abort();
                reject(new Error('请求超时'));
            });

            req.end();
        });
    }

    /**
     * 解析RSS XML内容
     */
    private parseRSSXML(xmlText: string, feedId: string): RSSItem[] {
        // 简单的XML解析实现
        const items: RSSItem[] = [];
        
        // 使用正则表达式解析RSS项目
        const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
        let match;

        while ((match = itemRegex.exec(xmlText)) !== null) {
            const itemXML = match[1];
            
            const title = this.extractXMLTag(itemXML, 'title');
            const link = this.extractXMLTag(itemXML, 'link');
            const description = this.extractXMLTag(itemXML, 'description');
            const pubDateStr = this.extractXMLTag(itemXML, 'pubDate');
            const author = this.extractXMLTag(itemXML, 'author') || this.extractXMLTag(itemXML, 'dc:creator');
            
            if (title && link) {
                const item: RSSItem = {
                    id: this.generateItemId(feedId, link),
                    feedId,
                    title: this.decodeHTMLEntities(title),
                    link,
                    description: this.decodeHTMLEntities(description || ''),
                    pubDate: pubDateStr ? new Date(pubDateStr) : new Date(),
                    author: author ? this.decodeHTMLEntities(author) : undefined
                };
                
                items.push(item);
            }
        }

        return items;
    }

    /**
     * 从XML文本中提取指定标签的内容
     */
    private extractXMLTag(xml: string, tagName: string): string {
        const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
        const match = xml.match(regex);
        return match ? match[1].trim() : '';
    }

    /**
     * 解码HTML实体
     */
    private decodeHTMLEntities(text: string): string {
        const entities: { [key: string]: string } = {
            '&amp;': '&',
            '&lt;': '<',
            '&gt;': '>',
            '&quot;': '"',
            '&#39;': "'",
            '&apos;': "'"
        };

        return text.replace(/&[#\w]+;/g, entity => {
            return entities[entity] || entity;
        });
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
        markdown += `## 标签\n\n#RSS #${this.sanitizeFilename(feedName)}\n\n`;
        markdown += `## 备注\n\n`;
        
        return markdown;
    }

    /**
     * 清理文件名中的非法字符
     */
    private sanitizeFilename(filename: string): string {
        return filename
            .replace(/[<>:"/\\|?*]/g, '-')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .substring(0, 50); // 限制长度
    }

    /**
     * 生成订阅源ID
     */
    private generateFeedId(): string {
        return 'feed_' + Date.now().toString() + '_' + Math.random().toString(36).substring(2, 9);
    }

    /**
     * 生成文章ID
     */
    private generateItemId(feedId: string, link: string): string {
        // 使用feedId和link生成唯一ID
        return `${feedId}_${Buffer.from(link).toString('base64').substring(0, 16)}`;
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
     * 清理资源
     */
    public dispose(): void {
        this.stopAutoUpdate();
    }
}
