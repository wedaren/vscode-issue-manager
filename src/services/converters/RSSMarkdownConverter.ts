import { RSSItem, RSSFeed } from '../types/RSSTypes';
import { ContentProcessorManager } from './ContentProcessorManager';
import { ContentProcessingOptions } from './ContentProcessor';
import { RSSContentProcessingConfig } from '../config/RSSContentProcessingConfig';

/**
 * RSS Markdown 转换器
 * 负责将 RSS 文章转换为 Markdown 格式，支持内容处理和定制
 */
export class RSSMarkdownConverter {
    private static processorManager = new ContentProcessorManager();

    /**
     * 将 RSS 文章转换为 Markdown 内容
     * @param item RSS 文章项
     * @param feed RSS 订阅源（可选）
     * @param useCustomProcessing 是否使用自定义内容处理（默认true）
     * @param processingOptions 显式的内容处理选项（可选，会覆盖配置文件设置）
     * @returns Markdown 格式的文本内容
     */
    public static convertToMarkdown(
        item: RSSItem, 
        feed?: RSSFeed, 
        useCustomProcessing: boolean = true,
        processingOptions?: {
            preset?: string;
            processors?: string[];
            options?: ContentProcessingOptions;
        }
    ): string {
        const feedName = feed?.name || 'RSS订阅';
        const publishDate = item.pubDate.toLocaleString('zh-CN');

        let markdown = `# ${item.title}\n\n`;
        markdown += `**来源**: [${feedName}](${feed?.url || ''})\n\n`;
        markdown += `**原文链接**: [${item.link}](${item.link})\n\n`;
        markdown += `**发布时间**: ${publishDate}\n\n`;

        if (item.author) {
            markdown += `**作者**: ${item.author}\n\n`;
        }

        // 获取内容处理配置
        let finalProcessingOptions = processingOptions;
        if (!finalProcessingOptions && useCustomProcessing) {
            // 先检查订阅源特定配置
            const feedSpecificConfig = RSSContentProcessingConfig.getFeedSpecificConfig(item.feedId);
            if (feedSpecificConfig) {
                finalProcessingOptions = feedSpecificConfig;
            } else {
                // 使用默认配置
                finalProcessingOptions = RSSContentProcessingConfig.getDefaultProcessingConfig();
            }
        }

        // 处理描述内容
        let processedDescription = item.description;
        if (finalProcessingOptions) {
            processedDescription = this.processContent(processedDescription, finalProcessingOptions);
        }
        markdown += `## 描述\n\n${processedDescription}\n\n`;

        // 处理主要内容
        if (item.content) {
            let processedContent = item.content;
            if (finalProcessingOptions) {
                processedContent = this.processContent(processedContent, finalProcessingOptions);
            }
            markdown += `## 内容\n\n${processedContent}\n\n`;
        }

        return markdown;
    }

    /**
     * 处理内容
     */
    private static processContent(
        content: string, 
        processingOptions: {
            preset?: string;
            processors?: string[];
            options?: ContentProcessingOptions;
        }
    ): string {
        // 如果指定了预设配置
        if (processingOptions.preset) {
            const presets = ContentProcessorManager.createPresets();
            const presetConfig = presets[processingOptions.preset];
            if (presetConfig) {
                return this.processorManager.processContent(
                    content, 
                    presetConfig.processors, 
                    presetConfig.options
                );
            }
        }

        // 使用自定义处理器和选项
        const processors = processingOptions.processors || [];
        const options = processingOptions.options || {};
        
        return this.processorManager.processContent(content, processors, options);
    }

    /**
     * 获取可用的预设配置
     */
    public static getAvailablePresets(): Record<string, { processors: string[]; options: ContentProcessingOptions }> {
        return ContentProcessorManager.createPresets();
    }

    /**
     * 获取可用的处理器列表
     */
    public static getAvailableProcessors(): Array<{ name: string; description: string }> {
        return this.processorManager.getProcessors().map(p => ({
            name: p.name,
            description: p.description
        }));
    }
}
