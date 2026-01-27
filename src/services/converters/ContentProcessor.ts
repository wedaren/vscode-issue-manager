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
    
    /** 图片处理选项 */
    imageProcessOptions?: {
        /** Base64 图片大小阈值(字节) */
        base64SizeThreshold?: number;
        /** 是否提取大型 base64 图片到本地文件 */
        extractBase64Images?: boolean;
        /** 是否移除大型 base64 图片 */
        removeBase64Images?: boolean;
        /** 当提取失败时是否回退到保留 base64 */
        fallbackToBase64?: boolean;
    };
    
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
