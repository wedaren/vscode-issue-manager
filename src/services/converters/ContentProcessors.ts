import { ContentProcessor, ContentProcessingOptions, ContentType } from './ContentProcessor';

/**
 * HTML清理处理器
 * 清理和过滤HTML内容
 */
export class HtmlCleanupProcessor implements ContentProcessor {
    public readonly name = 'html-cleanup';
    public readonly description = '清理和过滤HTML内容';

    public process(content: string, options: ContentProcessingOptions = {}): string {
        let processed = content;

        // 移除指定的HTML标签
        if (options.removeTags && options.removeTags.length > 0) {
            const tagRegex = new RegExp(`<\\/?(?:${options.removeTags.join('|')})\\b[^>]*>`, 'gi');
            processed = processed.replace(tagRegex, '');
        }

        // 如果不保留HTML标签，则移除所有标签
        if (!options.preserveHtml) {
            // 保留图片和链接（如果指定）
            if (options.preserveImages && options.preserveLinks) {
                processed = processed.replace(/<(?!\/?(img|a)\b)[^>]+>/gi, '');
            } else if (options.preserveImages) {
                processed = processed.replace(/<(?!\/?(img)\b)[^>]+>/gi, '');
            } else if (options.preserveLinks) {
                processed = processed.replace(/<(?!\/?(a)\b)[^>]+>/gi, '');
            } else {
                processed = processed.replace(/<[^>]+>/g, '');
            }
        }

        // 清理多余的空白字符
        processed = processed.replace(/\s+/g, ' ').trim();

        return processed;
    }
}

/**
 * 长度裁剪处理器
 * 按指定长度裁剪内容
 */
export class LengthTrimProcessor implements ContentProcessor {
    public readonly name = 'length-trim';
    public readonly description = '按指定长度裁剪内容';

    public process(content: string, options: ContentProcessingOptions = {}): string {
        if (!options.maxLength || content.length <= options.maxLength) {
            return content;
        }

        // 智能裁剪：尽量在句子边界处截断
        let trimmed = content.substring(0, options.maxLength);
        const lastSentenceEnd = Math.max(
            trimmed.lastIndexOf('。'),
            trimmed.lastIndexOf('！'),
            trimmed.lastIndexOf('？'),
            trimmed.lastIndexOf('.'),
            trimmed.lastIndexOf('!'),
            trimmed.lastIndexOf('?')
        );

        if (lastSentenceEnd > options.maxLength * 0.7) {
            trimmed = trimmed.substring(0, lastSentenceEnd + 1);
        } else {
            // 如果没有合适的句子边界，在词边界处截断
            const lastSpaceIndex = trimmed.lastIndexOf(' ');
            if (lastSpaceIndex > options.maxLength * 0.8) {
                trimmed = trimmed.substring(0, lastSpaceIndex);
            }
            trimmed += '...';
        }

        return trimmed;
    }
}

/**
 * 摘要提取处理器
 * 智能提取内容摘要
 */
export class SummaryExtractProcessor implements ContentProcessor {
    public readonly name = 'summary-extract';
    public readonly description = '智能提取内容摘要';

    public process(content: string, options: ContentProcessingOptions = {}): string {
        if (!options.summaryMode?.enabled) {
            return content;
        }

        const maxSentences = options.summaryMode.maxSentences || 3;
        const preferredSections = options.summaryMode.preferredSections || [];

        // 首先尝试提取优先章节
        if (preferredSections.length > 0) {
            for (const section of preferredSections) {
                const sectionRegex = new RegExp(`#{1,6}\\s*${section}[^#]*?(?=#{1,6}|$)`, 'i');
                const match = content.match(sectionRegex);
                if (match) {
                    return this.extractSentences(match[0], maxSentences);
                }
            }
        }

        // 如果没有找到优先章节，提取文章开头的句子
        return this.extractSentences(content, maxSentences);
    }

    private extractSentences(text: string, maxSentences: number): string {
        // 移除标题标记
        text = text.replace(/#{1,6}\s*/g, '');
        
        // 按句子分割（支持中英文句号）
        const sentences = text.split(/[。！？.!?]+/).filter(s => s.trim().length > 0);
        
        return sentences.slice(0, maxSentences).join('。') + (sentences.length > maxSentences ? '...' : '');
    }
}

/**
 * 自定义规则处理器
 * 应用用户自定义的正则表达式规则
 */
export class CustomRuleProcessor implements ContentProcessor {
    public readonly name = 'custom-rules';
    public readonly description = '应用自定义正则表达式规则';

    public process(content: string, options: ContentProcessingOptions = {}): string {
        if (!options.customRules || options.customRules.length === 0) {
            return content;
        }

        let processed = content;

        for (const rule of options.customRules) {
            try {
                const regex = new RegExp(rule.pattern, rule.flags || 'g');
                processed = processed.replace(regex, rule.replacement);
            } catch (error) {
                console.warn(`无效的正则表达式规则: ${rule.pattern}`, error);
            }
        }

        return processed;
    }
}
