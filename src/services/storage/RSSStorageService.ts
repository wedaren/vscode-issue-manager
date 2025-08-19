import * as vscode from 'vscode';
import { RSSConfig, RSSFeedConfig, DEFAULT_RSS_CONFIG } from '../types/RSSConfig';
import { RSSItem, RSSFeed } from '../types/RSSTypes';
import { 
    ensureIssueManagerDir, 
    getRSSConfigFilePath, 
    getFeedHistoryFilePath,
    writeJSONLFile, 
    readJSONLFile, 
    readLastJSONLRecords, 
    checkFileExists, 
    readYAMLFile, 
    writeYAMLFile 
} from '../../utils/fileUtils';

/**
 * RSS 存储服务
 * 负责 RSS 配置和历史记录的持久化存储
 */
export class RSSStorageService {
    /**
     * 加载 RSS 配置从 YAML 文件
     */
    public static async loadConfig(): Promise<RSSConfig> {
        const configFilePath = getRSSConfigFilePath();
        if (!configFilePath) {
            console.warn('无法获取RSS配置文件路径，使用默认配置');
            return { ...DEFAULT_RSS_CONFIG };
        }

        // 检查配置文件是否存在
        if (await checkFileExists(configFilePath)) {
            try {
                const config = await readYAMLFile<RSSConfig>(configFilePath);
                if (config && this.validateConfig(config)) {
                    console.log(`RSS配置已从 ${configFilePath.fsPath} 加载`);
                    return config;
                } else {
                    console.error('RSS配置文件格式无效，使用默认配置');
                }
            } catch (error) {
                console.error('读取RSS配置文件失败:', error);
            }
        } else {
            // 尝试从 VS Code 设置迁移
            const migratedConfig = await this.migrateFromVSCodeSettings();
            if (migratedConfig) {
                return migratedConfig;
            }
        }

        // 创建默认配置文件
        const defaultConfig = { ...DEFAULT_RSS_CONFIG };
        await this.saveConfig(defaultConfig);
        return defaultConfig;
    }

    /**
     * 保存 RSS 配置到 YAML 文件
     */
    public static async saveConfig(config: RSSConfig): Promise<boolean> {
        const configFilePath = getRSSConfigFilePath();
        if (!configFilePath) {
            console.error('无法获取RSS配置文件路径');
            return false;
        }

        // 确保目录存在
        const issueManagerDir = await ensureIssueManagerDir();
        if (!issueManagerDir) {
            console.error('无法创建 .issueManager 目录');
            return false;
        }

        try {
            const success = await writeYAMLFile(configFilePath, config);
            if (success) {
                console.log(`RSS配置已保存到: ${configFilePath.fsPath}`);
                return true;
            } else {
                console.error('保存RSS配置失败');
                return false;
            }
        } catch (error) {
            console.error('保存RSS配置时发生错误:', error);
            return false;
        }
    }

    /**
     * 加载订阅源状态（从配置文件中的lastUpdated字段）
     */
    public static async loadFeedStates(): Promise<Map<string, { lastUpdated?: Date }>> {
        const feedStates = new Map<string, { lastUpdated?: Date }>();

        try {
            const config = await this.loadConfig();
            for (const feed of config.feeds) {
                if (feed.lastUpdated) {
                    feedStates.set(feed.id, {
                        lastUpdated: new Date(feed.lastUpdated)
                    });
                }
            }
            console.log(`加载RSS状态: ${feedStates.size}个订阅源`);
        } catch (error) {
            console.log('RSS状态加载失败:', error);
        }

        return feedStates;
    }

    /**
     * 保存订阅源状态（更新配置文件中的lastUpdated字段）
     */
    public static async saveFeedStates(feedStates: Map<string, { lastUpdated?: Date }>): Promise<boolean> {
        try {
            const config = await this.loadConfig();
            
            // 更新配置中每个feed的lastUpdated字段
            for (const feed of config.feeds) {
                const feedState = feedStates.get(feed.id);
                if (feedState && feedState.lastUpdated) {
                    feed.lastUpdated = feedState.lastUpdated.toISOString();
                }
            }
            
            const success = await this.saveConfig(config);
            if (success) {
                console.log(`RSS状态已保存: ${feedStates.size}个订阅源`);
                return true;
            }
            return false;
        } catch (error) {
            console.error('保存RSS状态失败:', error);
            return false;
        }
    }

    /**
     * 加载指定订阅源的文章历史
     */
    public static async loadFeedItems(feedId: string): Promise<RSSItem[]> {
        const feedFilePath = getFeedHistoryFilePath(feedId);
        if (!feedFilePath) {
            return [];
        }

        try {
            const items = await readJSONLFile<RSSItem>(feedFilePath);
            if (items && items.length > 0) {
                return items.map((item: any) => ({
                    ...item,
                    pubDate: new Date(item.pubDate)
                }));
            }
        } catch (error) {
            console.log(`加载订阅源 "${feedId}" 失败:`, error);
        }

        return [];
    }

    /**
     * 保存指定订阅源的文章历史
     */
    public static async saveFeedItems(feedId: string, items: RSSItem[]): Promise<boolean> {
        const feedFilePath = getFeedHistoryFilePath(feedId);
        if (!feedFilePath) {
            return false;
        }

        // 确保目录存在
        const issueManagerDir = await ensureIssueManagerDir();
        if (!issueManagerDir) {
            console.error('无法创建 .issueManager 目录，保存失败');
            return false;
        }

        try {
            const success = await writeJSONLFile(feedFilePath, items);
            if (success) {
                console.log(`保存订阅源 "${feedId}": ${items.length}篇文章`);
                return true;
            }
            return false;
        } catch (error) {
            console.error(`保存订阅源 "${feedId}" 失败:`, error);
            return false;
        }
    }

    /**
     * 加载所有订阅源的文章历史
     */
    public static async loadAllFeedItems(feeds: RSSFeed[]): Promise<Map<string, RSSItem[]>> {
        const feedItemsMap = new Map<string, RSSItem[]>();

        for (const feed of feeds) {
            const items = await this.loadFeedItems(feed.id);
            if (items.length > 0) {
                feedItemsMap.set(feed.id, items);
                console.log(`加载订阅源 "${feed.name}": ${items.length}篇文章`);
            }
        }

        return feedItemsMap;
    }

    /**
     * 保存所有订阅源的文章历史
     */
    public static async saveAllFeedItems(feedItemsMap: Map<string, RSSItem[]>): Promise<number> {
        let savedFeeds = 0;

        for (const [feedId, items] of feedItemsMap) {
            const success = await this.saveFeedItems(feedId, items);
            if (success) {
                savedFeeds++;
            }
        }

        console.log(`RSS历史记录保存完成: ${savedFeeds}个订阅源`);
        return savedFeeds;
    }

    /**
     * 流式加载指定订阅源的最近文章（内存友好）
     */
    public static async loadRecentFeedItems(feedId: string, maxItems: number = 100): Promise<RSSItem[]> {
        const feedFilePath = getFeedHistoryFilePath(feedId);
        if (!feedFilePath) {
            return [];
        }

        try {
            // 使用流式读取，只读取最近的记录
            const records = await readLastJSONLRecords<RSSItem>(feedFilePath, maxItems);
            if (!records || records.length === 0) {
                return [];
            }

            // 转换日期并按时间排序
            const convertedItems = records.map((item: any) => ({
                ...item,
                pubDate: new Date(item.pubDate)
            }));

            convertedItems.sort((a: RSSItem, b: RSSItem) => b.pubDate.getTime() - a.pubDate.getTime());
            return convertedItems.slice(0, maxItems);
        } catch (error) {
            console.error('流式读取RSS文章失败:', error);
            return [];
        }
    }

    /**
     * 验证配置文件格式
     */
    private static validateConfig(config: any): config is RSSConfig {
        return config &&
               typeof config.version === 'string' &&
               Array.isArray(config.feeds);
    }

    /**
     * 从 VS Code 设置迁移配置
     */
    private static async migrateFromVSCodeSettings(): Promise<RSSConfig | null> {
        const config = vscode.workspace.getConfiguration('issueManager');
        const feedsConfig = config.get<RSSFeed[]>('rss.feeds', []);

        if (feedsConfig.length > 0) {
            console.log('检测到VS Code设置中的RSS配置，开始迁移...');
            
            const migratedConfig: RSSConfig = {
                version: "1.0",
                feeds: feedsConfig.map(feed => ({
                    id: feed.id,
                    name: feed.name,
                    url: feed.url,
                    enabled: feed.enabled,
                    updateInterval: feed.updateInterval,
                    tags: [],
                    description: ""
                }))
            };

            await this.saveConfig(migratedConfig);

            // 清除 VS Code 设置中的 feeds 配置（保留全局设置）
            await config.update('rss.feeds', undefined, vscode.ConfigurationTarget.Global);
            console.log('RSS配置迁移完成');
            return migratedConfig;
        }

        return null;
    }
}
