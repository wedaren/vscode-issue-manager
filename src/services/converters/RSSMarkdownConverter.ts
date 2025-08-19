import { RSSItem, RSSFeed } from '../types/RSSTypes';

/**
 * RSS Markdown 转换器
 * 负责将 RSS 文章转换为 Markdown 格式
 */
export class RSSMarkdownConverter {
    /**
     * 将 RSS 文章转换为 Markdown 内容
     * @param item RSS 文章项
     * @param feed RSS 订阅源（可选）
     * @returns Markdown 格式的文本内容
     */
    public static convertToMarkdown(item: RSSItem, feed?: RSSFeed): string {
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

        if (item.content) {
            markdown += `${item.content}\n\n`;
        }

        return markdown;
    }

    /**
     * 生成虚拟文件的 Markdown 内容（与转换方法相同，但为了语义清晰单独提供）
     * @param item RSS 文章项
     * @param feed RSS 订阅源（可选）
     * @returns Markdown 格式的文本内容
     */
    public static generatePreviewMarkdown(item: RSSItem, feed?: RSSFeed): string {
        return this.convertToMarkdown(item, feed);
    }
}
