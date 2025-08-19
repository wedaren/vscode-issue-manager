/**
 * RSS配置文件类型定义
 */

export interface RSSConfig {
    version: string;
    feeds: RSSFeedConfig[];
}

export interface RSSFeedConfig {
    id: string;
    name: string;
    url: string;
    enabled: boolean;
    updateInterval?: number; // 分钟，可选，使用全局默认值
    lastUpdated?: string; // ISO 字符串格式的最后更新时间
    tags?: string[];
    description?: string;
}

export const DEFAULT_RSS_CONFIG: RSSConfig = {
    version: "1.0",
    feeds: [
        {
            id: "example-tech",
            name: "技术博客示例",
            url: "https://example.com/rss.xml",
            enabled: false,
            updateInterval: 60, // 1小时（分钟）
            tags: ["技术", "示例"],
            description: "这是一个示例RSS订阅源，请替换为您的实际订阅"
        }
    ]
};
