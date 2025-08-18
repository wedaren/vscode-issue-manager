/**
 * RSS订阅源接口
 */
export interface RSSFeed {
    id: string;
    name: string;
    url: string;
    enabled: boolean;
    lastUpdated?: Date;
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
 * 支持的RSS格式类型
 */
export enum RSSFormat {
    JSON_FEED = 'json-feed',
    RSS_2_0 = 'rss-2.0',
    ATOM = 'atom',
    RDF = 'rdf'
}
