/**
 * RSS订阅源接口
 */
export interface RSSFeed {
    id: string;
    name: string;
    url: string;
    enabled: boolean;
    updateInterval?: number; // 更新间隔（分钟）
}

/**
 * RSS文章项接口
 */
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
 * RSS解析结果
 */
export interface RSSParseResult {
    items: RSSItem[];
    feedInfo?: {
        title?: string;
        description?: string;
        link?: string;
    };
}

/**
 * RSS解析统计信息
 */
export interface RSSParseStats {
    /** 成功解析的文章数量 */
    successCount: number;
    /** 解析失败的文章数量 */
    failedCount: number;
    /** 解析失败的文章信息 */
    failedItems: Array<{
        title?: string;
        link?: string;
        error: string;
    }>;
}

/**
 * 包含统计信息的RSS解析结果
 */
export interface RSSParseResultWithStats {
    items: RSSItem[];
    stats: RSSParseStats;
    feedInfo?: {
        title?: string;
        description?: string;
        link?: string;
    };
}

/**
 * 支持的RSS格式类型
 */
export enum RSSFormat {
    JSON_FEED = 'json-feed',
    RSS_2_0 = 'rss-2.0',
    ATOM = 'atom',
    RDF = 'rdf'
}
