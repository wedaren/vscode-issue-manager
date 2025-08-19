import { ContentProcessor, ContentProcessingOptions } from './ContentProcessor';
import { 
    HtmlCleanupProcessor, 
    LengthTrimProcessor, 
    SummaryExtractProcessor, 
    CustomRuleProcessor 
} from './ContentProcessors';

/**
 * 内容处理管理器
 * 管理和协调各种内容处理器
 */
export class ContentProcessorManager {
    private processors: Map<string, ContentProcessor> = new Map();

    constructor() {
        // 注册默认处理器
        this.registerProcessor(new HtmlCleanupProcessor());
        this.registerProcessor(new LengthTrimProcessor());
        this.registerProcessor(new SummaryExtractProcessor());
        this.registerProcessor(new CustomRuleProcessor());
    }

    /**
     * 注册内容处理器
     */
    public registerProcessor(processor: ContentProcessor): void {
        this.processors.set(processor.name, processor);
    }

    /**
     * 获取所有处理器
     */
    public getProcessors(): ContentProcessor[] {
        return Array.from(this.processors.values());
    }

    /**
     * 获取指定处理器
     */
    public getProcessor(name: string): ContentProcessor | undefined {
        return this.processors.get(name);
    }

    /**
     * 处理内容 - 按指定顺序应用多个处理器
     * @param content 原始内容
     * @param processorNames 要应用的处理器名称列表
     * @param options 处理选项
     */
    public processContent(
        content: string, 
        processorNames: string[], 
        options: ContentProcessingOptions = {}
    ): string {
        let processed = content;

        for (const processorName of processorNames) {
            const processor = this.processors.get(processorName);
            if (processor) {
                processed = processor.process(processed, options);
            } else {
                console.warn(`未找到处理器: ${processorName}`);
            }
        }

        return processed;
    }

    /**
     * 创建预设的处理配置
     */
    public static createPresets(): Record<string, { processors: string[]; options: ContentProcessingOptions }> {
        return {
            // 简洁模式：移除HTML，限制长度
            'concise': {
                processors: ['html-cleanup', 'length-trim'],
                options: {
                    preserveHtml: false,
                    maxLength: 300,
                    preserveLinks: true
                }
            },
            
            // 摘要模式：提取摘要，清理HTML
            'summary': {
                processors: ['html-cleanup', 'summary-extract'],
                options: {
                    preserveHtml: false,
                    summaryMode: {
                        enabled: true,
                        maxSentences: 2,
                        preferredSections: ['摘要', '总结', 'Summary', 'Abstract']
                    }
                }
            },
            
            // 清洁模式：只移除危险的HTML标签
            'clean': {
                processors: ['html-cleanup'],
                options: {
                    preserveHtml: true,
                    removeTags: ['script', 'style', 'iframe', 'object', 'embed'],
                    preserveImages: true,
                    preserveLinks: true
                }
            },
            
            // 纯文本模式：移除所有HTML标签
            'plain': {
                processors: ['html-cleanup', 'length-trim'],
                options: {
                    preserveHtml: false,
                    preserveImages: false,
                    preserveLinks: false,
                    maxLength: 500
                }
            }
        };
    }
}
