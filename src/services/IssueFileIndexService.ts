import * as path from 'path';
import * as vscode from 'vscode';
import { TitleCacheService } from './TitleCacheService';
import { getAllMarkdownFiles } from '../utils/markdown';
import { getRelativePathToIssueDir } from '../utils/fileUtils';
import { getIssueDir } from '../config';
import { Logger } from '../core/utils/Logger';

/**
 * Issue 文件索引条目
 */
export interface IssueFileEntry {
    /** 绝对路径 */
    fsPath: string;
    /** 相对于 issueDir 的路径 */
    relPath: string;
    /** 文件名（含扩展名） */
    filename: string;
    /** 标题（从 titleCache 获取） */
    title: string;
    /** 最后修改时间戳 */
    mtime: number;
}

/**
 * Issue 文件索引服务
 * 提供文件列表、过滤、排序等功能，用于补全提示
 */
export class IssueFileIndexService {
    private static instance: IssueFileIndexService | null = null;
    private cache: IssueFileEntry[] = [];
    private loaded = false;
    private readonly logger: Logger;

    private constructor() {
        this.logger = Logger.getInstance();
    }

    static getInstance(): IssueFileIndexService {
        if (!IssueFileIndexService.instance) {
            IssueFileIndexService.instance = new IssueFileIndexService();
        }
        return IssueFileIndexService.instance;
    }

    /**
     * 预加载文件索引
     */
    async preload(): Promise<void> {
        if (this.loaded) {
            return;
        }

        try {
            const issueDir = getIssueDir();
            if (!issueDir) {
                this.loaded = true;
                return;
            }

            // 确保 TitleCache 已加载
            await TitleCacheService.getInstance().preload();

            // 获取所有 Markdown 文件
            const files = await getAllMarkdownFiles();
            
            // 并发获取文件元数据
            const entries = await Promise.all(
                files.map(async (file): Promise<IssueFileEntry | null> => {
                    try {
                        const relPath = getRelativePathToIssueDir(file.fsPath);
                        if (!relPath) {
                            return null;
                        }

                        const stat = await vscode.workspace.fs.stat(file);
                        const cachedTitle = await TitleCacheService.getInstance().get(relPath);
                        const title = cachedTitle || path.basename(file.fsPath, '.md');

                        return {
                            fsPath: file.fsPath,
                            relPath,
                            filename: path.basename(file.fsPath),
                            title,
                            mtime: stat.mtime
                        };
                    } catch (e) {
                        this.logger.warn(`获取文件信息失败: ${file.fsPath}`, e);
                        return null;
                    }
                })
            );

            // 过滤掉失败的项，并按修改时间降序排序
            this.cache = entries
                .filter((entry): entry is IssueFileEntry => entry !== null)
                .sort((a, b) => b.mtime - a.mtime);

            this.loaded = true;
        } catch (e) {
            this.logger.error('预加载文件索引失败:', e);
            this.loaded = true;
        }
    }

    /**
     * 重新加载索引
     */
    async reload(): Promise<void> {
        this.loaded = false;
        this.cache = [];
        await this.preload();
    }

    /**
     * 列出文件，支持关键字过滤和数量限制
     * @param query 过滤关键字（可选）
     * @param limit 最大返回数量（可选）
     */
    async listFiles(options: {
        query?: string;
        limit?: number;
    } = {}): Promise<IssueFileEntry[]> {
        await this.preload();

        let result = this.cache;

        // 应用关键字过滤
        if (options.query && options.query.trim()) {
            const query = options.query.trim().toLowerCase();
            result = this.filterByQuery(result, query);
        }

        // 应用数量限制
        if (options.limit && options.limit > 0) {
            result = result.slice(0, options.limit);
        }

        return result;
    }

    /**
     * 根据查询字符串过滤文件列表
     * 只要包含关键字即可（文件名、标题或路径中包含）
     */
    private filterByQuery(entries: IssueFileEntry[], query: string): IssueFileEntry[] {
        return entries.filter(entry => {
            const filenameLower = entry.filename.toLowerCase();
            const titleLower = entry.title.toLowerCase();
            const relPathLower = entry.relPath.toLowerCase();

            // 只要任一字段包含关键字就匹配
            return filenameLower.includes(query) ||
                   titleLower.includes(query) ||
                   relPathLower.includes(query);
        });
        // 保持原有的修改时间排序（在 cache 中已排序）
    }

    /**
     * 清理实例
     */
    dispose(): void {
        this.cache = [];
        this.loaded = false;
    }
}
