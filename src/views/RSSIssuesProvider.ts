import * as vscode from 'vscode';
import { RSSService } from '../services/RSSService';
import { RSSFeed, RSSItem } from '../services/types/RSSTypes';

/**
 * RSS订阅源节点
 */
class RSSFeedTreeItem extends vscode.TreeItem {
    constructor(
        public readonly feed: RSSFeed,
        public readonly itemCount: number,
        public readonly lastUpdated?: Date
    ) {
        super(feed.name, vscode.TreeItemCollapsibleState.Collapsed);
        this.id = `feed_${feed.id}`;
        this.contextValue = 'rssFeed';
        this.description = `(${itemCount})`;
        this.tooltip = new vscode.MarkdownString(
            `**名称**: ${feed.name}\n\n**URL**: ${feed.url}\n\n**状态**: ${feed.enabled ? '启用' : '禁用'}\n\n**最后更新**: ${lastUpdated ? lastUpdated.toLocaleString('zh-CN') : '从未更新'}`
        );
        
        // 根据启用状态设置图标
        this.iconPath = new vscode.ThemeIcon(
            feed.enabled ? 'rss' : 'circle-slash',
            feed.enabled ? undefined : new vscode.ThemeColor('disabledForeground')
        );
    }
}

/**
 * RSS文章节点
 */
class RSSItemTreeItem extends vscode.TreeItem {
    constructor(
        public readonly item: RSSItem,
        public readonly feedName: string
    ) {
        super(item.title, vscode.TreeItemCollapsibleState.None);
        this.id = `item_${item.id}`;
        this.contextValue = 'rssItem';
        this.description = feedName;
        this.tooltip = new vscode.MarkdownString(
            `**标题**: ${item.title}\n\n**来源**: ${feedName}\n\n**发布时间**: ${item.pubDate.toLocaleString('zh-CN')}\n\n**链接**: [${item.link}](${item.link})\n\n**描述**: ${item.description.substring(0, 200)}${item.description.length > 200 ? '...' : ''}`
        );
        
        this.iconPath = new vscode.ThemeIcon('globe');
        
        // 点击时在浏览器中打开原文链接
        this.command = {
            command: 'issueManager.rss.previewMarkdown',
            title: '打开原文',
            arguments: [this]
        };
    }
}

/**
 * 分组节点（按日期分组）
 */
class RSSGroupTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly items: RSSItem[]
    ) {
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        this.id = `group_${label}`;
        this.contextValue = 'rssGroup';
        this.description = `(${items.length})`;
        this.iconPath = new vscode.ThemeIcon('calendar');
    }
}

/**
 * RSS问题视图提供器
 */
export class RSSIssuesProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private viewMode: 'feeds' | 'articles' = 'feeds';
    private rssService: RSSService;

    constructor(private context: vscode.ExtensionContext) {
        this.rssService = RSSService.getInstance();
        
        // 注册命令
        this.registerCommands();
        
        // 启动自动更新
        this.rssService.startAutoUpdate();
    }

    private registerCommands(): void {
        // 切换视图模式
        this.context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.rss.switchToFeedsView', () => {
                this.setViewMode('feeds');
            })
        );

        this.context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.rss.switchToArticlesView', () => {
                this.setViewMode('articles');
            })
        );

        // 添加RSS订阅源
        this.context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.rss.addFeed', async () => {
                await this.addFeed();
            })
        );

        // 删除RSS订阅源
        this.context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.rss.removeFeed', async (item: RSSFeedTreeItem) => {
                await this.removeFeed(item.feed.id);
            })
        );

        // 切换订阅源启用状态
        this.context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.rss.toggleFeed', async (item: RSSFeedTreeItem) => {
                await this.toggleFeed(item.feed.id, !item.feed.enabled);
            })
        );

        // 更新订阅源
        this.context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.rss.updateFeed', async (item: RSSFeedTreeItem) => {
                await this.updateFeed(item.feed);
            })
        );

        // 更新所有订阅源
        this.context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.rss.updateAllFeeds', async () => {
                await this.updateAllFeeds();
            })
        );

        // 转换为Markdown
        this.context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.rss.convertToMarkdown', async (item: RSSItemTreeItem) => {
                await this.convertToMarkdown(item.item);
            })
        );

        // 预览Markdown
        this.context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.rss.previewMarkdown', async (item: RSSItemTreeItem) => {
                await this.previewMarkdown(item.item);
            })
        );

        // 添加到关注问题
        this.context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.rss.addToFocused', async (item: RSSItemTreeItem) => {
                await this.addToFocused(item.item);
            })
        );

        // 添加到问题总览
        this.context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.rss.addToOverview', async (item: RSSItemTreeItem) => {
                await this.addToOverview(item.item);
            })
        );

        // 刷新视图
        this.context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.rss.refresh', () => {
                this.refresh();
            })
        );

        // 清理旧的历史记录
        this.context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.rss.cleanupOldItems', async () => {
                await this.cleanupOldItems();
            })
        );

        // 显示历史统计信息
        this.context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.rss.showHistoryStats', async () => {
                await this.showHistoryStats();
            })
        );
    }

    /**
     * 设置视图模式
     */
    private setViewMode(mode: 'feeds' | 'articles'): void {
        this.viewMode = mode;
        this.updateViewModeContext();
        this.refresh();
    }

    /**
     * 更新视图模式上下文
     */
    private updateViewModeContext(): void {
        vscode.commands.executeCommand('setContext', 'issueManager.rssViewMode', this.viewMode);
    }

    /**
     * 刷新视图
     */
    public refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * 获取树项
     */
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * 获取子元素
     */
    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        if (!element) {
            // 根节点
            if (this.viewMode === 'feeds') {
                return this.getFeedNodes();
            } else {
                return this.getArticleGroups();
            }
        }

        if (element instanceof RSSFeedTreeItem) {
            // 订阅源的子节点：该订阅源的文章
            return this.getFeedArticles(element.feed.id);
        }

        if (element instanceof RSSGroupTreeItem) {
            // 分组的子节点：该分组的文章
            return this.getGroupArticles(element.items);
        }

        return [];
    }

    /**
     * 获取订阅源节点列表
     */
    private getFeedNodes(): RSSFeedTreeItem[] {
        const feeds = this.rssService.getFeeds();
        return feeds.map(feed => {
            const itemCount = this.rssService.getFeedItems(feed.id).length;
            const lastUpdated = this.rssService.getFeedLastUpdated(feed.id);
            return new RSSFeedTreeItem(feed, itemCount, lastUpdated);
        });
    }

    /**
     * 获取指定订阅源的文章节点
     */
    private getFeedArticles(feedId: string): RSSItemTreeItem[] {
        const items = this.rssService.getFeedItems(feedId);
        const feeds = this.rssService.getFeeds();
        const feed = feeds.find(f => f.id === feedId);
        const feedName = feed?.name || 'RSS';

        return items.map(item => new RSSItemTreeItem(item, feedName));
    }

    /**
     * 获取按日期分组的文章
     */
    private getArticleGroups(): RSSGroupTreeItem[] {
        const allItems = this.rssService.getAllItems();
        if (allItems.length === 0) {
            return [];
        }

        // 按日期分组，key 用标准化日期字符串（YYYY-MM-DD），特殊分组用 '今天'、'昨天'、'更早'
        const groups = new Map<string, RSSItem[]>();
        const today = new Date();
        const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
        const oneWeekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

        // 标准化日期字符串
        const dateToKey = (date: Date) => {
            return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
        };

        const todayKey = dateToKey(today);
        const yesterdayKey = dateToKey(yesterday);

        for (const item of allItems) {
            const itemDate = this.normalizeDate(item.pubDate);
            const itemKey = dateToKey(itemDate);

            let groupKey: string;
            if (itemKey === todayKey) {
                groupKey = '今天';
            } else if (itemKey === yesterdayKey) {
                groupKey = '昨天';
            } else if (itemDate >= this.normalizeDate(oneWeekAgo)) {
                groupKey = itemKey; // 一周内用标准化日期字符串
            } else {
                groupKey = '更早';
            }

            if (!groups.has(groupKey)) {
                groups.set(groupKey, []);
            }
            groups.get(groupKey)!.push(item);
        }

        // 转换为树节点，按顺序排列
        const orderedKeys = ['今天', '昨天'];
        const result: RSSGroupTreeItem[] = [];

        // 添加今天和昨天
        for (const key of orderedKeys) {
            if (groups.has(key)) {
                result.push(new RSSGroupTreeItem(key, groups.get(key)!));
                groups.delete(key);
            }
        }

        // 一周内的日期分组（标准化日期字符串），按日期倒序
        const weekDateKeys: string[] = [];
        for (const [key, items] of groups.entries()) {
            if (key !== '更早') {
                weekDateKeys.push(key);
            }
        }
        weekDateKeys.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

        for (const key of weekDateKeys) {
            // 显示时格式化为本地化标签
            const date = new Date(key);
            const label = this.formatDate(date);
            result.push(new RSSGroupTreeItem(label, groups.get(key)!));
            groups.delete(key);
        }

        // 添加更早的文章
        if (groups.has('更早')) {
            result.push(new RSSGroupTreeItem('更早', groups.get('更早')!));
        }

        return result;
    }

    /**
     * 获取分组中的文章节点
     */
    private getGroupArticles(items: RSSItem[]): RSSItemTreeItem[] {
        const feeds = this.rssService.getFeeds();
        return items.map(item => {
            const feed = feeds.find(f => f.id === item.feedId);
            const feedName = feed?.name || 'RSS';
            return new RSSItemTreeItem(item, feedName);
        });
    }

    /**
     * 标准化日期（只保留年月日）
     */
    private normalizeDate(date: Date): Date {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    }

    /**
     * 格式化日期
     */
    private formatDate(date: Date): string {
        const options: Intl.DateTimeFormatOptions = { 
            month: 'long', 
            day: 'numeric', 
            weekday: 'long' 
        };
        return new Intl.DateTimeFormat(undefined, options).format(date);
    }

    /**
     * 添加RSS订阅源
     */
    private async addFeed(): Promise<void> {
        const name = await vscode.window.showInputBox({
            prompt: '请输入RSS订阅源名称',
            placeHolder: '例如：技术博客',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return '名称不能为空';
                }
                return null;
            }
        });

        if (!name) {
            return;
        }

        const url = await vscode.window.showInputBox({
            prompt: '请输入RSS订阅源URL',
            placeHolder: '例如：https://example.com/rss.xml',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'URL不能为空';
                }
                try {
                    new URL(value);
                    return null;
                } catch {
                    return 'URL格式不正确';
                }
            }
        });

        if (!url) {
            return;
        }

        const loading = vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: '正在添加RSS订阅源...',
            cancellable: false
        }, async () => {
            const success = await this.rssService.addFeed(name.trim(), url.trim());
            if (success) {
                vscode.window.showInformationMessage(`RSS订阅源 "${name}" 添加成功`);
                this.refresh();
            } else {
                vscode.window.showErrorMessage(`添加RSS订阅源失败，请检查URL是否正确`);
            }
        });

        await loading;
    }

    /**
     * 删除RSS订阅源
     */
    private async removeFeed(feedId: string): Promise<void> {
        const feeds = this.rssService.getFeeds();
        const feed = feeds.find(f => f.id === feedId);
        if (!feed) {
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            `确定要删除RSS订阅源 "${feed.name}" 吗？`,
            { modal: true },
            '确定'
        );

        if (confirm === '确定') {
            const success = await this.rssService.removeFeed(feedId);
            if (success) {
                vscode.window.showInformationMessage(`RSS订阅源 "${feed.name}" 已删除`);
                this.refresh();
            } else {
                vscode.window.showErrorMessage('删除RSS订阅源失败');
            }
        }
    }

    /**
     * 切换订阅源启用状态
     */
    private async toggleFeed(feedId: string, enabled: boolean): Promise<void> {
        const success = await this.rssService.toggleFeed(feedId, enabled);
        if (success) {
            const statusText = enabled ? '启用' : '禁用';
            vscode.window.showInformationMessage(`RSS订阅源已${statusText}`);
            this.refresh();
        } else {
            vscode.window.showErrorMessage('操作失败');
        }
    }

    /**
     * 更新单个订阅源
     */
    private async updateFeed(feed: RSSFeed): Promise<void> {
        const loading = vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `正在更新 "${feed.name}"...`,
            cancellable: false
        }, async () => {
            try {
                await this.rssService.updateFeed(feed);
                vscode.window.showInformationMessage(`"${feed.name}" 更新成功`);
                this.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`更新 "${feed.name}" 失败: ${error instanceof Error ? error.message : '未知错误'}`);
            }
        });

        await loading;
    }

    /**
     * 更新所有订阅源
     */
    private async updateAllFeeds(): Promise<void> {
        const feeds = this.rssService.getFeeds().filter(f => f.enabled);
        if (feeds.length === 0) {
            vscode.window.showInformationMessage('没有启用的RSS订阅源');
            return;
        }

        const loading = vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `正在更新 ${feeds.length} 个RSS订阅源...`,
            cancellable: false
        }, async () => {
            try {
                await this.rssService.updateAllFeeds();
                vscode.window.showInformationMessage(`${feeds.length} 个RSS订阅源更新完成`);
                this.refresh();
            } catch (error) {
                vscode.window.showWarningMessage('部分RSS订阅源更新失败，请查看输出面板获取详细信息');
            }
        });

        await loading;
    }

    /**
     * 转换为Markdown并保存到问题目录
     */
    private async convertToMarkdown(item: RSSItem): Promise<void> {
        const uri = await this.rssService.convertToMarkdown(item);
        if (uri) {
            // 打开生成的Markdown文件
            await vscode.window.showTextDocument(uri);
            
            // 刷新相关视图
            vscode.commands.executeCommand('issueManager.refreshAllViews');
            
            vscode.window.showInformationMessage(`文章已转换为Markdown格式并保存`);
        }
    }

    /**
     * 预览Markdown内容（虚拟文件）
     */
    private async previewMarkdown(item: RSSItem): Promise<void> {
        try {
            // 创建虚拟文件URI
            const virtualUri = this.rssService.createVirtualFile(item);
            
            // 在编辑器中打开虚拟文件
            const document = await vscode.workspace.openTextDocument(virtualUri);
            await vscode.window.showTextDocument(document, {preview: true});
            
            vscode.window.showInformationMessage('正在预览文章内容，您可以编辑后保存到问题目录');
        } catch (error) {
            console.error('预览Markdown失败:', error);
            vscode.window.showErrorMessage('预览文章失败');
        }
    }

    /**
     * 添加到关注问题
     */
    private async addToFocused(item: RSSItem): Promise<void> {
        // 先转换为Markdown
        const uri = await this.rssService.convertToMarkdown(item);
        if (uri) {
            // 添加到关注问题
            await vscode.commands.executeCommand('issueManager.addIssueToTree', [uri], null, true);
            vscode.window.showInformationMessage(`"${item.title}" 已添加到关注问题`);
        }
    }

    /**
     * 添加到问题总览
     */
    private async addToOverview(item: RSSItem): Promise<void> {
        // 先转换为Markdown
        const uri = await this.rssService.convertToMarkdown(item);
        if (uri) {
            // 添加到问题总览
            await vscode.commands.executeCommand('issueManager.addIssueToTree', [uri], null, false);
            vscode.window.showInformationMessage(`"${item.title}" 已添加到问题总览`);
        }
    }

    /**
     * 清理旧的历史记录
     */
    private async cleanupOldItems(): Promise<void> {
        try {
            const result = await this.rssService.cleanupOldItems();
            vscode.window.showInformationMessage(
                `已清理 ${result.removedCount} 个旧的RSS文章记录`
            );
            this.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(
                `清理历史记录失败: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * 显示历史统计信息
     */
    private async showHistoryStats(): Promise<void> {
        try {
            const stats = await this.rssService.getHistoryStats();
            
            let message = 'RSS历史统计:\n\n';
            for (const [feedId, count] of Object.entries(stats.itemsByFeed)) {
                const feedName = this.rssService.getFeeds().find(f => f.id === feedId)?.name || feedId;
                message += `${feedName}: ${count} 篇文章\n`;
            }
            message += `\n总计: ${stats.totalItems} 篇文章`;
            
            if (stats.oldestDate && stats.newestDate) {
                message += `\n时间范围: ${stats.oldestDate.toLocaleDateString()} - ${stats.newestDate.toLocaleDateString()}`;
            }
            
            vscode.window.showInformationMessage(message);
        } catch (error) {
            vscode.window.showErrorMessage(
                `获取历史统计失败: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * 清理资源
     */
    public dispose(): void {
        this.rssService.dispose();
    }
}
