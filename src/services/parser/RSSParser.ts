import * as cheerio from 'cheerio';
import { RSSItem, RSSFormat, RSSParseResult } from '../types/RSSTypes';

/**
 * RSS内容解析器
 */
export class RSSParser {
    /**
     * 解析RSS内容（自动检测格式）
     */
    public static parseContent(content: string, feedId: string): RSSItem[] {
        const trimmedContent = content.trim();
        
        // 检测内容格式
        if (RSSParser.isXMLContent(trimmedContent)) {
            console.log('检测到XML格式，使用XML解析器');
            return RSSParser.parseXMLFeed(trimmedContent, feedId);
        }
        
        try {
            // 尝试解析为JSON
            const jsonData = JSON.parse(content);
            console.log('检测到JSON格式，使用JSON解析器');
            return RSSParser.parseJSONFeed(jsonData, feedId);
        } catch (jsonError) {
            // 提供详细的错误信息
            console.error('JSON解析失败:', jsonError);
            
            if (trimmedContent.toLowerCase().includes('<html') || trimmedContent.toLowerCase().includes('<!doctype html')) {
                throw new Error('检测到HTML页面内容。请确认URL指向的是RSS订阅源（支持JSON Feed或XML RSS格式），而不是普通网页。');
            }
            
            if (!trimmedContent) {
                throw new Error('订阅源返回空内容。请检查URL是否正确。');
            }
            
            throw new Error(`无法解析订阅源内容。支持的格式包括：1) JSON Feed格式，2) XML RSS/Atom格式。请确认提供的URL返回有效的订阅源数据。错误详情: ${jsonError instanceof Error ? jsonError.message : '未知错误'}`);
        }
    }

    /**
     * 检测是否为XML内容
     */
    private static isXMLContent(content: string): boolean {
        try {
            const $ = cheerio.load(content, { xmlMode: true });
            
            // 检查是否包含RSS/Atom/RDF的根元素
            const hasRSSElements = $('rss').length > 0 || 
                                 $('feed').length > 0 || 
                                 $('rdf\\:RDF, RDF').length > 0 ||
                                 $('channel').length > 0 ||
                                 $('atom').length > 0;
            
            if (hasRSSElements) {
                return true;
            }
            
            // 检查是否以XML声明开头或包含XML标签结构
            const trimmed = content.trim();
            const looksLikeXML = trimmed.startsWith('<?xml') || 
                               (trimmed.startsWith('<') && trimmed.endsWith('>') && 
                                (trimmed.includes('<rss') || trimmed.includes('<feed') || 
                                 trimmed.includes('<rdf:RDF') || trimmed.includes('<channel')));
            
            return looksLikeXML;
            
        } catch (error) {
            console.warn('Cheerio XML检测时发生错误，使用备用检测方法:', error);
            const trimmed = content.trim();
            
            return trimmed.startsWith('<') && 
                   (trimmed.includes('<rss') || 
                    trimmed.includes('<feed') || 
                    trimmed.includes('<rdf:RDF') ||
                    trimmed.includes('<?xml') ||
                    trimmed.includes('<channel') ||
                    trimmed.includes('<atom'));
        }
    }

    /**
     * 解析XML格式的RSS feed
     */
    private static parseXMLFeed(xmlContent: string, feedId: string): RSSItem[] {
        const items: RSSItem[] = [];

        try {
            const $ = cheerio.load(xmlContent, { xmlMode: true });

            // 解析RSS 2.0格式
            if ($('rss').length > 0 || $('channel').length > 0) {
                $('item').each((_, element) => {
                    const item = RSSParser.parseRSSItem($, $(element), feedId);
                    if (item) {
                        items.push(item);
                    }
                });
            }
            // 解析Atom格式
            else if ($('feed').length > 0) {
                $('entry').each((_, element) => {
                    const item = RSSParser.parseAtomEntry($, $(element), feedId);
                    if (item) {
                        items.push(item);
                    }
                });
            }
            // 解析RDF格式
            else if ($('rdf\\:RDF, RDF').length > 0) {
                $('item').each((_, element) => {
                    const item = RSSParser.parseRDFItem($, $(element), feedId);
                    if (item) {
                        items.push(item);
                    }
                });
            }

            return items;
        } catch (error) {
            console.error('解析XML RSS失败:', error);
            throw new Error(`XML RSS解析失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
    }

    /**
     * 解析JSON格式的RSS feed
     */
    private static parseJSONFeed(jsonData: any, feedId: string): RSSItem[] {
        const items: RSSItem[] = [];

        try {
            // 支持JSON Feed 1.1标准
            if (jsonData.version && jsonData.items && Array.isArray(jsonData.items)) {
                for (const item of jsonData.items) {
                    const parsedItem = RSSParser.parseJSONItem(item, feedId);
                    if (parsedItem) {
                        items.push(parsedItem);
                    }
                }
            }
            // 支持自定义JSON格式
            else if (jsonData.items && Array.isArray(jsonData.items)) {
                for (const item of jsonData.items) {
                    const parsedItem = RSSParser.parseCustomJSONItem(item, feedId);
                    if (parsedItem) {
                        items.push(parsedItem);
                    }
                }
            }
            // 支持直接的items数组
            else if (Array.isArray(jsonData)) {
                for (const item of jsonData) {
                    const parsedItem = RSSParser.parseCustomJSONItem(item, feedId);
                    if (parsedItem) {
                        items.push(parsedItem);
                    }
                }
            }
            else {
                throw new Error('无效的JSON Feed格式。期望的格式包括: 1) 标准JSON Feed (带有version和items字段), 2) 包含items数组的对象, 3) 直接的文章数组。请检查您的JSON Feed格式是否正确。');
            }
        } catch (error) {
            console.error('解析JSON feed失败:', error);
            
            if (error instanceof Error && error.message.includes('无效的JSON Feed格式')) {
                throw error;
            }
            
            throw new Error(`解析JSON Feed时发生错误: ${error instanceof Error ? error.message : '未知错误'}`);
        }

        return items;
    }

    /**
     * 解析RSS 2.0格式的item
     */
    private static parseRSSItem($: cheerio.CheerioAPI, $item: cheerio.Cheerio<any>, feedId: string): RSSItem | null {
        try {
            const title = $item.find('title').text().trim();
            const link = $item.find('link').text().trim() || $item.find('guid').text().trim();

            if (!title || !link) {
                return null;
            }

            const description = $item.find('description').text().trim();
            const pubDateStr = $item.find('pubDate').text().trim();
            const author = $item.find('author').text().trim() || 
                          $item.find('dc\\:creator, creator').text().trim();
            const content = $item.find('content\\:encoded, encoded').text().trim() || description;

            // 处理分类
            const categories: string[] = [];
            $item.find('category').each((_, cat) => {
                const catText = $(cat).text().trim();
                if (catText) {
                    categories.push(catText);
                }
            });

            return {
                id: RSSParser.generateItemId(feedId, link),
                feedId,
                title: RSSParser.cleanText(title),
                link,
                description: RSSParser.cleanText(description),
                pubDate: pubDateStr ? new Date(pubDateStr) : new Date(),
                content: content ? RSSParser.cleanText(content) : undefined,
                author: author ? RSSParser.cleanText(author) : undefined,
                categories: categories.length > 0 ? categories : undefined
            };
        } catch (error) {
            console.error('解析RSS item失败:', error);
            return null;
        }
    }

    /**
     * 解析Atom格式的entry
     */
    private static parseAtomEntry($: cheerio.CheerioAPI, $entry: cheerio.Cheerio<any>, feedId: string): RSSItem | null {
        try {
            const title = $entry.find('title').text().trim();
            let link = '';

            // Atom的link处理
            const $link = $entry.find('link[rel="alternate"], link').first();
            if ($link.length > 0) {
                link = $link.attr('href') || $link.text().trim();
            }

            if (!title || !link) {
                return null;
            }

            const summary = $entry.find('summary').text().trim();
            const content = $entry.find('content').text().trim() || summary;
            const publishedStr = $entry.find('published').text().trim() || 
                               $entry.find('updated').text().trim();
            
            // Atom作者处理
            const author = $entry.find('author name').text().trim() || 
                          $entry.find('author').text().trim();

            // 处理分类
            const categories: string[] = [];
            $entry.find('category').each((_, cat) => {
                const term = $(cat).attr('term') || $(cat).text().trim();
                if (term) {
                    categories.push(term);
                }
            });

            return {
                id: RSSParser.generateItemId(feedId, link),
                feedId,
                title: RSSParser.cleanText(title),
                link,
                description: RSSParser.cleanText(summary),
                pubDate: publishedStr ? new Date(publishedStr) : new Date(),
                content: content ? RSSParser.cleanText(content) : undefined,
                author: author ? RSSParser.cleanText(author) : undefined,
                categories: categories.length > 0 ? categories : undefined
            };
        } catch (error) {
            console.error('解析Atom entry失败:', error);
            return null;
        }
    }

    /**
     * 解析RDF格式的item
     */
    private static parseRDFItem($: cheerio.CheerioAPI, $item: cheerio.Cheerio<any>, feedId: string): RSSItem | null {
        try {
            const title = $item.find('title').text().trim();
            const link = $item.find('link').text().trim();

            if (!title || !link) {
                return null;
            }

            const description = $item.find('description').text().trim();
            const pubDateStr = $item.find('dc\\:date, date').text().trim();
            const author = $item.find('dc\\:creator, creator').text().trim();

            return {
                id: RSSParser.generateItemId(feedId, link),
                feedId,
                title: RSSParser.cleanText(title),
                link,
                description: RSSParser.cleanText(description),
                pubDate: pubDateStr ? new Date(pubDateStr) : new Date(),
                author: author ? RSSParser.cleanText(author) : undefined
            };
        } catch (error) {
            console.error('解析RDF item失败:', error);
            return null;
        }
    }

    /**
     * 解析JSON Feed标准格式的item
     */
    private static parseJSONItem(item: any, feedId: string): RSSItem | null {
        try {
            const title = item.title;
            const url = item.url || item.external_url;
            
            if (!title || !url) {
                return null;
            }

            return {
                id: RSSParser.generateItemId(feedId, url),
                feedId,
                title: title,
                link: url,
                description: item.summary || item.content_text || '',
                pubDate: item.date_published ? new Date(item.date_published) : new Date(),
                content: item.content_html || item.content_text,
                author: item.author?.name || item.author,
                categories: item.tags || undefined
            };
        } catch (error) {
            console.error('解析JSON item失败:', error);
            return null;
        }
    }

    /**
     * 解析自定义JSON格式的item
     */
    private static parseCustomJSONItem(item: any, feedId: string): RSSItem | null {
        try {
            // 支持多种可能的字段名
            const title = item.title || item.name || item.subject;
            const link = item.link || item.url || item.href;
            
            if (!title || !link) {
                return null;
            }

            // 尝试多种描述字段
            const description = item.description || item.summary || item.excerpt || item.content || '';
            
            // 尝试多种日期字段
            const dateField = item.pubDate || item.publishDate || item.date || item.published || item.created;
            const pubDate = dateField ? new Date(dateField) : new Date();
            
            // 尝试多种作者字段
            const author = item.author || item.creator || item.writer;

            return {
                id: RSSParser.generateItemId(feedId, link),
                feedId,
                title: RSSParser.cleanText(title),
                link,
                description: RSSParser.cleanText(description),
                pubDate,
                content: item.content ? RSSParser.cleanText(item.content) : undefined,
                author: author ? RSSParser.cleanText(String(author)) : undefined,
                categories: item.categories || item.tags || undefined
            };
        } catch (error) {
            console.error('解析自定义JSON item失败:', error);
            return null;
        }
    }

    /**
     * 清理文本内容
     */
    private static cleanText(text: string): string {
        if (typeof text !== 'string') {
            return String(text);
        }
        
        return text
            .replace(/<[^>]*>/g, '') // 移除HTML标签
            .replace(/&[#\w]+;/g, (entity) => { // 解码HTML实体
                const entities: { [key: string]: string } = {
                    '&amp;': '&',
                    '&lt;': '<',
                    '&gt;': '>',
                    '&quot;': '"',
                    '&#39;': "'",
                    '&apos;': "'",
                    '&nbsp;': ' '
                };
                return entities[entity] || entity;
            })
            .replace(/\s+/g, ' ') // 合并多个空白字符
            .trim();
    }

    /**
     * 生成文章ID
     */
    private static generateItemId(feedId: string, link: string): string {
        const hash = RSSParser.simpleHash(link);
        return `${feedId}_${hash}`;
    }

    /**
     * 简单的字符串哈希函数
     */
    private static simpleHash(str: string): string {
        let hash = 0;
        if (str.length === 0) {
            return hash.toString(36);
        }

        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // 转换为32位整数
        }

        return Math.abs(hash).toString(36);
    }
}
