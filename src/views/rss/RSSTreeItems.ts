import * as vscode from 'vscode';
import { RSSFeed, RSSItem } from '../../services/types/RSSTypes';

/**
 * RSS订阅源节点
 */
export class RSSFeedTreeItem extends vscode.TreeItem {
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
export class RSSItemTreeItem extends vscode.TreeItem {
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
export class RSSGroupTreeItem extends vscode.TreeItem {
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
 * RSS树节点联合类型
 */
export type RSSTreeItem = RSSFeedTreeItem | RSSItemTreeItem | RSSGroupTreeItem;
