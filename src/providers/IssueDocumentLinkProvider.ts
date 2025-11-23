import * as vscode from 'vscode';
import * as path from 'path';
import { getIssueDir } from '../config';
import { Logger } from '../core/utils/Logger';

/**
 * Issue 文档链接提供器
 * 
 * 解析 markdown 文档中的链接，特别是包含 ?issueId= 查询参数的链接
 * 使得点击链接时能够正确导航到文件并保留 issueId 上下文
 */
export class IssueDocumentLinkProvider implements vscode.DocumentLinkProvider {
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
        
        // 使用 matchAll 来匹配所有链接，避免正则状态问题
        // 注意：此正则不处理转义字符，VSCode 的内置 markdown 引擎会处理这些情况
        const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
        const matches = text.matchAll(linkPattern);
        
        for (const match of matches) {
            if (token.isCancellationRequested) {
                return [];
            }

            const linkPath = match[2]; // 链接路径（可能包含查询参数）
            const startIndex = match.index! + match[0].indexOf('(') + 1; // ( 之后的位置
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

            // 确保路径在 issueDir 内，使用 path.relative 进行更健壮的验证
            const normalizedIssuePath = path.normalize(issueDir);
            let normalizedAbsPath = path.normalize(absolutePath);
            
            // 使用 path.relative 检查路径关系
            let relativePath = path.relative(normalizedIssuePath, normalizedAbsPath);
            
            // 如果相对路径以 .. 开头，说明不在 issueDir 内
            if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
                // 路径不在 issueDir 内，尝试将其作为相对于 issueDir 的路径
                absolutePath = path.join(issueDir, filePath);
                normalizedAbsPath = path.normalize(absolutePath);
                relativePath = path.relative(normalizedIssuePath, normalizedAbsPath);
                
                // 再次验证路径在 issueDir 内，防止 ../ 逃逸
                if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
                    return null;
                }
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
            // 解析失败，使用 Logger 记录
            Logger.getInstance().error(`解析链接失败: ${linkPath}`, error);
            return null;
        }
    }
}
