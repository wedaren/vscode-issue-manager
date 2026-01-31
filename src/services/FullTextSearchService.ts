import * as vscode from 'vscode';
import { IssueMarkdown } from '../data/IssueMarkdowns';
import { IssueSearchResult } from '../data/issueSearchHistory';
import * as path from 'path';
import { getIssueDir } from '../config';

/**
 * 全文搜索选项
 */
export interface FullTextSearchOptions {
    /** 是否区分大小写 */
    caseSensitive?: boolean;
    /** 是否使用正则表达式 */
    useRegex?: boolean;
    /** 是否全词匹配 */
    wholeWord?: boolean;
    /** 最大返回结果数 */
    maxResults?: number;
    /** 每个文件最多返回的匹配片段数 */
    maxSnippetsPerFile?: number;
    /** 匹配片段的上下文行数 */
    contextLines?: number;
}

const DEFAULT_OPTIONS: Required<FullTextSearchOptions> = {
    caseSensitive: false,
    useRegex: false,
    wholeWord: false,
    maxResults: 100,
    maxSnippetsPerFile: 3,
    contextLines: 0
};

/**
 * 全文搜索服务
 */
export class FullTextSearchService {
    /**
     * 在指定的问题列表中进行全文搜索
     * @param keyword 搜索关键词
     * @param issues 要搜索的问题列表
     * @param options 搜索选项
     * @returns 搜索结果列表
     */
    static async searchInContent(
        keyword: string,
        issues: IssueMarkdown[],
        options: FullTextSearchOptions = {}
    ): Promise<IssueSearchResult[]> {
        const opts = { ...DEFAULT_OPTIONS, ...options };
        const normalizedKeyword = keyword.trim();
        
        if (!normalizedKeyword) {
            return [];
        }

        const issueDir = getIssueDir();
        if (!issueDir) {
            return [];
        }

        const results: IssueSearchResult[] = [];
        let resultCount = 0;

        // 创建搜索模式
        let searchPattern: RegExp;
        try {
            if (opts.useRegex) {
                // 使用用户提供的正则表达式
                const flags = opts.caseSensitive ? 'gm' : 'gim';
                searchPattern = new RegExp(normalizedKeyword, flags);
            } else {
                // 转义特殊字符并创建正则表达式
                const escaped = normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const pattern = opts.wholeWord ? `\\b${escaped}\\b` : escaped;
                const flags = opts.caseSensitive ? 'gm' : 'gim';
                searchPattern = new RegExp(pattern, flags);
            }
        } catch (error) {
            // 正则表达式无效，使用普通文本搜索
            const escaped = normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            searchPattern = new RegExp(escaped, 'gim');
        }

        // 在每个问题中搜索
        for (const issue of issues) {
            if (resultCount >= opts.maxResults) {
                break;
            }

            try {
                // 读取文件内容
                const content = await vscode.workspace.fs.readFile(issue.uri);
                const text = Buffer.from(content).toString('utf8');
                
                // 分割成行
                const lines = text.split(/\r?\n/);
                
                // 查找匹配的行
                const matchedSnippets: IssueSearchResult['matchedSnippets'] = [];
                
                for (let i = 0; i < lines.length; i++) {
                    if (matchedSnippets.length >= opts.maxSnippetsPerFile) {
                        break;
                    }

                    const line = lines[i];
                    const matches = Array.from(line.matchAll(searchPattern));
                    
                    if (matches.length > 0) {
                        // 获取第一个匹配
                        const match = matches[0];
                        const columnStart = match.index ?? 0;
                        const columnEnd = columnStart + match[0].length;
                        
                        // 构建上下文（如果需要）
                        let snippetText = line;
                        if (opts.contextLines > 0) {
                            const startLine = Math.max(0, i - opts.contextLines);
                            const endLine = Math.min(lines.length - 1, i + opts.contextLines);
                            const contextLines = lines.slice(startLine, endLine + 1);
                            snippetText = contextLines.join('\n');
                        }
                        
                        matchedSnippets.push({
                            text: snippetText,
                            lineNumber: i + 1, // 行号从1开始
                            columnStart,
                            columnEnd
                        });
                    }
                }

                // 如果找到匹配，添加到结果
                if (matchedSnippets.length > 0) {
                    const relPath = path.relative(issueDir, issue.uri.fsPath);
                    results.push({
                        filePath: relPath,
                        title: issue.title,
                        briefSummary: this.getBriefSummary(issue),
                        matchedSnippets
                    });
                    resultCount++;
                }
            } catch (error) {
                // 忽略读取失败的文件
                console.error(`Failed to read file ${issue.uri.fsPath}:`, error);
            }
        }

        return results;
    }

    /**
     * 从问题中提取简要摘要
     */
    private static getBriefSummary(issue: IssueMarkdown): string | undefined {
        const frontmatter = issue.frontmatter;
        if (!frontmatter) {
            return undefined;
        }
        
        const summary = frontmatter.issue_brief_summary;
        if (typeof summary === 'string') {
            return summary;
        }
        if (Array.isArray(summary) && summary.length > 0 && typeof summary[0] === 'string') {
            return summary[0];
        }
        return undefined;
    }

    /**
     * 高亮匹配文本（用于显示）
     * @param text 原始文本
     * @param keyword 关键词
     * @param options 搜索选项
     * @returns 高亮后的文本（使用 Markdown 格式）
     */
    static highlightMatches(
        text: string,
        keyword: string,
        options: Pick<FullTextSearchOptions, 'caseSensitive' | 'useRegex' | 'wholeWord'> = {}
    ): string {
        const opts = { ...DEFAULT_OPTIONS, ...options };
        const normalizedKeyword = keyword.trim();
        
        if (!normalizedKeyword) {
            return text;
        }

        try {
            let searchPattern: RegExp;
            if (opts.useRegex) {
                const flags = opts.caseSensitive ? 'g' : 'gi';
                searchPattern = new RegExp(normalizedKeyword, flags);
            } else {
                const escaped = normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const pattern = opts.wholeWord ? `\\b${escaped}\\b` : escaped;
                const flags = opts.caseSensitive ? 'g' : 'gi';
                searchPattern = new RegExp(pattern, flags);
            }

            // 使用 **高亮** 格式（在 VSCode 中会显示为粗体）
            return text.replace(searchPattern, '**$&**');
        } catch (error) {
            return text;
        }
    }

    /**
     * 截断文本以显示匹配附近的内容
     * @param text 原始文本
     * @param matchPosition 匹配位置
     * @param maxLength 最大长度
     * @returns 截断后的文本
     */
    static truncateAroundMatch(
        text: string,
        matchPosition: number,
        maxLength: number = 200
    ): string {
        if (text.length <= maxLength) {
            return text;
        }

        const halfLength = Math.floor(maxLength / 2);
        let start = Math.max(0, matchPosition - halfLength);
        let end = Math.min(text.length, matchPosition + halfLength);

        // 尝试在单词边界处截断
        if (start > 0) {
            const spaceIndex = text.lastIndexOf(' ', start + 20);
            if (spaceIndex > start) {
                start = spaceIndex + 1;
            }
        }

        if (end < text.length) {
            const spaceIndex = text.indexOf(' ', end - 20);
            if (spaceIndex > 0 && spaceIndex < end) {
                end = spaceIndex;
            }
        }

        let result = text.substring(start, end);
        if (start > 0) {
            result = '...' + result;
        }
        if (end < text.length) {
            result = result + '...';
        }

        return result;
    }
}
