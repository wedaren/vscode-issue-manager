import * as vscode from 'vscode';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { getIssueDir } from '../config';
import { generateFileName } from '../utils/fileUtils';

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
 * 仅支持JSON Feed格式，不支持传统XML RSS格式
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
     * 添加RSS订阅源（仅支持JSON Feed格式）
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
            vscode.window.showInformationMessage(`成功添加JSON Feed订阅源: ${name}`);
            return true;
        } catch (error) {
            console.error('添加RSS订阅源失败:', error);
            
            // 显示用户友好的错误提示
            const errorMessage = error instanceof Error ? error.message : '未知错误';
            
            if (errorMessage.includes('检测到XML格式')) {
                vscode.window.showErrorMessage(`无法添加订阅源 "${name}": 检测到XML格式的RSS源。本插件仅支持JSON Feed格式。`, 
                    '查看格式说明', '了解JSON Feed').then(selection => {
                    if (selection === '查看格式说明') {
                        RSSService.showJSONFeedHelp();
                    } else if (selection === '了解JSON Feed') {
                        vscode.env.openExternal(vscode.Uri.parse('https://jsonfeed.org/'));
                    }
                });
            } else if (errorMessage.includes('检测到HTML页面')) {
                vscode.window.showErrorMessage(`无法添加订阅源 "${name}": 提供的URL指向HTML页面，请确认URL指向JSON Feed格式的订阅源。`,
                    '查看格式说明').then(selection => {
                    if (selection === '查看格式说明') {
                        RSSService.showJSONFeedHelp();
                    }
                });
            } else if (errorMessage.includes('返回空内容')) {
                vscode.window.showErrorMessage(`无法添加订阅源 "${name}": 订阅源返回空内容，请检查URL是否正确。`);
            } else {
                vscode.window.showErrorMessage(`无法添加订阅源 "${name}": ${errorMessage}`, 
                    '查看格式说明', '了解JSON Feed').then(selection => {
                    if (selection === '查看格式说明') {
                        RSSService.showJSONFeedHelp();
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
            
            // 根据错误类型提供不同的提示
            const errorMessage = error instanceof Error ? error.message : '未知错误';
            
            if (errorMessage.includes('检测到XML格式')) {
                vscode.window.showWarningMessage(`订阅源 "${feed.name}" 更新失败: 该源是XML格式，但本插件仅支持JSON Feed格式。`, 
                    '禁用此源', '了解JSON Feed').then(selection => {
                    if (selection === '禁用此源') {
                        this.toggleFeed(feed.id, false);
                    } else if (selection === '了解JSON Feed') {
                        vscode.env.openExternal(vscode.Uri.parse('https://jsonfeed.org/'));
                    }
                });
            } else if (errorMessage.includes('网络') || errorMessage.includes('超时') || errorMessage.includes('连接')) {
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
        const safeTitle = this.sanitizeFilename(item.title);
        const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const filename = `RSS-${this.sanitizeFilename(feedName)}-${safeTitle}-${timestamp}.md`;

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
            const responseText = await this.fetchContent(feed.url);
            return this.parseRSSContent(responseText, feed.id);
        } catch (error) {
            throw new Error(`获取RSS内容失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
    }

    /**
     * 使用Node.js内置模块获取JSON内容
     */
    private fetchContent(url: string): Promise<string> {
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
                    'Accept': 'application/json'
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
     * 解析JSON格式的RSS内容
     */
    private parseRSSContent(content: string, feedId: string): RSSItem[] {
        // 先检测内容格式
        const trimmedContent = content.trim();
        
        // 检测是否为XML格式
        if (trimmedContent.startsWith('<?xml') || trimmedContent.startsWith('<rss') || 
            trimmedContent.startsWith('<feed') || trimmedContent.startsWith('<rdf:RDF')) {
            throw new Error('检测到XML格式的RSS源。本插件仅支持JSON Feed格式，不支持传统的XML RSS/Atom格式。请提供JSON Feed格式的订阅源。');
        }
        
        try {
            // 解析为JSON
            const jsonData = JSON.parse(content);
            return this.parseJSONFeed(jsonData, feedId);
        } catch (jsonError) {
            // 如果JSON解析失败，提供更详细的错误信息
            console.error('JSON解析失败:', jsonError);
            
            // 检查是否可能是HTML页面
            if (trimmedContent.toLowerCase().includes('<html') || trimmedContent.toLowerCase().includes('<!doctype html')) {
                throw new Error('检测到HTML页面内容。请确认URL指向的是JSON Feed格式的订阅源，而不是普通网页。');
            }
            
            // 检查是否为空内容
            if (!trimmedContent) {
                throw new Error('订阅源返回空内容。请检查URL是否正确。');
            }
            
            // 通用JSON解析错误
            throw new Error(`无法解析订阅源内容。本插件仅支持JSON Feed格式。请确认提供的URL返回有效的JSON Feed格式数据。错误详情: ${jsonError instanceof Error ? jsonError.message : '未知错误'}`);
        }
    }

    /**
     * 解析JSON格式的RSS feed
     */
    private parseJSONFeed(jsonData: any, feedId: string): RSSItem[] {
        const items: RSSItem[] = [];

        try {
            // 支持JSON Feed 1.1标准
            if (jsonData.version && jsonData.items && Array.isArray(jsonData.items)) {
                for (const item of jsonData.items) {
                    const parsedItem = this.parseJSONItem(item, feedId);
                    if (parsedItem) {
                        items.push(parsedItem);
                    }
                }
            }
            // 支持自定义JSON格式
            else if (jsonData.items && Array.isArray(jsonData.items)) {
                for (const item of jsonData.items) {
                    const parsedItem = this.parseCustomJSONItem(item, feedId);
                    if (parsedItem) {
                        items.push(parsedItem);
                    }
                }
            }
            // 支持直接的items数组
            else if (Array.isArray(jsonData)) {
                for (const item of jsonData) {
                    const parsedItem = this.parseCustomJSONItem(item, feedId);
                    if (parsedItem) {
                        items.push(parsedItem);
                    }
                }
            }
            // 如果没有找到有效的JSON Feed结构
            else {
                throw new Error('无效的JSON Feed格式。期望的格式包括: 1) 标准JSON Feed (带有version和items字段), 2) 包含items数组的对象, 3) 直接的文章数组。请检查您的JSON Feed格式是否正确。');
            }
        } catch (error) {
            console.error('解析JSON feed失败:', error);
            
            // 如果是我们抛出的格式错误，直接传播
            if (error instanceof Error && error.message.includes('无效的JSON Feed格式')) {
                throw error;
            }
            
            // 其他解析错误
            throw new Error(`解析JSON Feed时发生错误: ${error instanceof Error ? error.message : '未知错误'}`);
        }

        return items;
    }

    /**
     * 解析JSON Feed标准格式的item
     */
    private parseJSONItem(item: any, feedId: string): RSSItem | null {
        try {
            const title = item.title;
            const url = item.url || item.external_url;
            
            if (!title || !url) {
                return null;
            }

            return {
                id: this.generateItemId(feedId, url),
                feedId,
                title: title,
                link: url,
                description: item.summary || item.content_text || '',
                pubDate: item.date_published ? new Date(item.date_published) : new Date(),
                content: item.content_html || item.content_text,
                author: item.author?.name || item.author,
                categories: item.tags || undefined
            };
        } catch (error) {
            console.error('解析JSON item失败:', error);
            return null;
        }
    }

    /**
     * 解析自定义JSON格式的item
     */
    private parseCustomJSONItem(item: any, feedId: string): RSSItem | null {
        try {
            // 支持多种可能的字段名
            const title = item.title || item.name || item.subject;
            const link = item.link || item.url || item.href;
            
            if (!title || !link) {
                return null;
            }

            // 尝试多种描述字段
            const description = item.description || item.summary || item.excerpt || item.content || '';
            
            // 尝试多种日期字段
            const dateField = item.pubDate || item.publishDate || item.date || item.published || item.created;
            const pubDate = dateField ? new Date(dateField) : new Date();
            
            // 尝试多种作者字段
            const author = item.author || item.creator || item.writer;

            return {
                id: this.generateItemId(feedId, link),
                feedId,
                title: this.cleanText(title),
                link,
                description: this.cleanText(description),
                pubDate,
                content: item.content ? this.cleanText(item.content) : undefined,
                author: author ? this.cleanText(String(author)) : undefined,
                categories: item.categories || item.tags || undefined
            };
        } catch (error) {
            console.error('解析自定义JSON item失败:', error);
            return null;
        }
    }

    /**
     * 清理文本内容
     */
    private cleanText(text: string): string {
        if (typeof text !== 'string') {
            return String(text);
        }
        
        return text
            .replace(/<[^>]*>/g, '') // 移除HTML标签
            .replace(/&[#\w]+;/g, (entity) => { // 解码HTML实体
                const entities: { [key: string]: string } = {
                    '&amp;': '&',
                    '&lt;': '<',
                    '&gt;': '>',
                    '&quot;': '"',
                    '&#39;': "'",
                    '&apos;': "'",
                    '&nbsp;': ' '
                };
                return entities[entity] || entity;
            })
            .replace(/\s+/g, ' ') // 合并多个空白字符
            .trim();
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
        // 使用时间戳和随机字符串生成唯一ID
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 10);
        return `feed_${timestamp}_${random}`;
    }

    /**
     * 生成文章ID
     */
    private generateItemId(feedId: string, link: string): string {
        // 使用URL的哈希值生成更短更稳定的ID
        const hash = this.simpleHash(link);
        return `${feedId}_${hash}`;
    }

    /**
     * 简单的字符串哈希函数
     */
    private simpleHash(str: string): string {
        let hash = 0;
        if (str.length === 0) {
            return hash.toString(36);
        }

        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // 转换为32位整数
        }

        return Math.abs(hash).toString(36);
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

    /**
     * 显示JSON Feed格式帮助信息
     */
    public static showJSONFeedHelp(): void {
        const helpContent = `# JSON Feed 格式说明

本插件仅支持JSON Feed格式，不支持传统的XML RSS格式。

## 支持的JSON Feed格式:

### 1. 标准JSON Feed 1.1格式:
\`\`\`json
{
  "version": "https://jsonfeed.org/version/1.1",
  "title": "我的博客",
  "items": [
    {
      "title": "文章标题",
      "url": "https://example.com/article1",
      "date_published": "2025-01-01T00:00:00Z",
      "summary": "文章摘要",
      "author": {"name": "作者名"}
    }
  ]
}
\`\`\`

### 2. 自定义JSON格式:
\`\`\`json
{
  "items": [
    {
      "title": "文章标题",
      "link": "https://example.com/article1",
      "description": "文章描述",
      "pubDate": "2025-01-01",
      "author": "作者名"
    }
  ]
}
\`\`\`

### 3. 直接数组格式:
\`\`\`json
[
  {
    "title": "文章标题",
    "url": "https://example.com/article1",
    "date": "2025-01-01"
  }
]
\`\`\`

了解更多: https://jsonfeed.org/`;

        // 创建并显示虚拟文档
        vscode.workspace.openTextDocument({
            content: helpContent,
            language: 'markdown'
        }).then(doc => {
            vscode.window.showTextDocument(doc);
        });
    }
}
