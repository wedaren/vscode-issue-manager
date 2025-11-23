import * as vscode from 'vscode';
import * as path from 'path';
import { getIssueDir } from '../config';

/**
 * Issue 文档链接提供器
 * 
 * 解析 markdown 文档中的链接，特别是包含 ?issueId= 查询参数的链接
 * 使得点击链接时能够正确导航到文件并保留 issueId 上下文
 */
export class IssueDocumentLinkProvider implements vscode.DocumentLinkProvider {
    /**
     * 匹配 markdown 链接的正则表达式
     * 支持格式: [text](path?issueId=xxx) 或 [text](path?issueId=xxx&other=value)
     */
    private readonly linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;

    /**
     * 提供文档中的链接
     */
    provideDocumentLinks(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DocumentLink[]> {
        // 只处理 markdown 文档
        if (document.languageId !== 'markdown') {
            return [];
        }

        const issueDir = getIssueDir();
        if (!issueDir) {
            return [];
        }

        const links: vscode.DocumentLink[] = [];
        const text = document.getText();
        
        // 重置正则表达式的 lastIndex
        this.linkPattern.lastIndex = 0;
        
        let match;
        while ((match = this.linkPattern.exec(text)) !== null) {
            if (token.isCancellationRequested) {
                return [];
            }

            const linkText = match[1]; // 链接文本
            const linkPath = match[2]; // 链接路径（可能包含查询参数）
            const startIndex = match.index + match[0].indexOf('(') + 1; // ( 之后的位置
            const endIndex = startIndex + linkPath.length;

            // 解析路径和查询参数
            const parsed = this.parseLinkPath(linkPath, document, issueDir);
            if (parsed) {
                const range = new vscode.Range(
                    document.positionAt(startIndex),
                    document.positionAt(endIndex)
                );
                
                const link = new vscode.DocumentLink(range, parsed.uri);
                link.tooltip = parsed.tooltip;
                links.push(link);
            }
        }

        return links;
    }

    /**
     * 解析链接路径，提取文件路径和查询参数
     */
    private parseLinkPath(
        linkPath: string,
        document: vscode.TextDocument,
        issueDir: string
    ): { uri: vscode.Uri; tooltip?: string } | null {
        try {
            // 分离路径和查询参数
            const queryIndex = linkPath.indexOf('?');
            let filePath: string;
            let queryString: string | undefined;

            if (queryIndex !== -1) {
                filePath = linkPath.substring(0, queryIndex);
                queryString = linkPath.substring(queryIndex + 1);
            } else {
                filePath = linkPath;
            }

            // 跳过外部链接（http/https）
            if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
                return null;
            }

            // 跳过锚点链接
            if (filePath.startsWith('#')) {
                return null;
            }

            // 解析相对路径
            let absolutePath: string;
            if (path.isAbsolute(filePath)) {
                absolutePath = filePath;
            } else {
                // 相对于当前文档的路径
                const currentDir = path.dirname(document.uri.fsPath);
                absolutePath = path.resolve(currentDir, filePath);
            }

            // 确保路径在 issueDir 内
            const normalizedIssuePath = path.normalize(issueDir);
            const normalizedAbsPath = path.normalize(absolutePath);
            
            if (!normalizedAbsPath.startsWith(normalizedIssuePath)) {
                // 路径不在 issueDir 内，尝试将其作为相对于 issueDir 的路径
                absolutePath = path.join(issueDir, filePath);
            }

            // 创建 URI
            let uri = vscode.Uri.file(absolutePath);

            // 如果有查询参数，附加到 URI
            if (queryString) {
                uri = uri.with({ query: queryString });
                
                // 提取 issueId 用于 tooltip
                const issueIdMatch = queryString.match(/issueId=([^&]+)/);
                if (issueIdMatch) {
                    const issueId = decodeURIComponent(issueIdMatch[1]);
                    return {
                        uri,
                        tooltip: `打开文件 (issueId: ${issueId})`
                    };
                }
            }

            return { uri };
        } catch (error) {
            // 解析失败，忽略此链接
            console.error('解析链接失败:', linkPath, error);
            return null;
        }
    }
}
