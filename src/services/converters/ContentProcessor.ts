/**
 * 内容处理器接口
 * 定义内容转换和裁剪的基础接口
 */
export interface ContentProcessor {
    /**
     * 处理内容
     * @param content 原始内容
     * @param options 处理选项
     * @returns 处理后的内容
     */
    process(content: string, options?: Record<string, any>): string;
    
    /**
     * 处理器名称
     */
    readonly name: string;
    
    /**
     * 处理器描述
     */
    readonly description: string;
}

/**
 * 内容处理选项
 */
export interface ContentProcessingOptions {
    /** 最大长度（字符数） */
    maxLength?: number;
    
    /** 是否保留HTML标签 */
    preserveHtml?: boolean;
    
    /** 要移除的HTML标签列表 */
    removeTags?: string[];
    
    /** 是否保留图片 */
    preserveImages?: boolean;
    
    /** 是否保留链接 */
    preserveLinks?: boolean;
    
    /** 自定义规则表达式 */
    customRules?: {
        pattern: string;
        replacement: string;
        flags?: string;
    }[];
    
    /** 摘要模式：提取内容摘要 */
    summaryMode?: {
        enabled: boolean;
        maxSentences?: number;
        preferredSections?: string[]; // 优先提取的章节标题
    };
}

/**
 * 内容类型
 */
export enum ContentType {
    HTML = 'html',
    MARKDOWN = 'markdown',
    PLAIN_TEXT = 'plain-text'
}
