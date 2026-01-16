import * as vscode from 'vscode';
import * as path from 'path';
import { getIssueDir } from '../config';
import { Logger } from '../core/utils/Logger';
import { parseFileLink, type FileLocation } from '../utils/fileLinkFormatter';

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

        // 1) 处理常见的 markdown 内联链接 [text](path)
        const inlineLinkPattern = /\x5B([^\]]+)\x5D\(([^\s)]+)\)/g;
        for (const match of text.matchAll(inlineLinkPattern)) {
            if (token.isCancellationRequested) {
                return [];
            }

            const linkPath = match[2]; // 链接路径（可能包含查询参数）
            const startIndex = match.index! + match[1].length + 3;
            const endIndex = startIndex + linkPath.length;

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

        // 2) 处理自定义语法 [[file:...]]，使用 command URI 打开并分屏显示
        // 支持新的统一格式：[[file:/path#L10:4-L15:8]]
        const filePattern = /\[\[file:([^\]]+)\]\]/g;
        for (const match of text.matchAll(filePattern)) {
            if (token.isCancellationRequested) {
                return [];
            }

            const filePath = match[1].trim();
            if (!filePath) continue;

            const startIndex = match.index! + '[[file:'.length;
            const endIndex = startIndex + filePath.length;

            // 使用统一的解析器解析位置信息
            const linkText = `[[file:${filePath}]]`;
            const fileLocation = parseFileLink(linkText);
            
            if (!fileLocation) {
                // 解析失败，跳过
                continue;
            }

            // 将必要信息序列化为命令参数：包含原文档 uri 和目标位置信息
            const args = {
                location: fileLocation,
                source: document.uri.toString()
            };

            const cmdUri = vscode.Uri.parse(`command:extension.openInSplit?${encodeURIComponent(JSON.stringify([args]))}`);

            const range = new vscode.Range(
                document.positionAt(startIndex),
                document.positionAt(endIndex)
            );

            const link = new vscode.DocumentLink(range, cmdUri);
            
            // 构建更详细的 tooltip
            let tooltip = '在旁边打开文件';
            if (fileLocation.startLine) {
                if (fileLocation.endLine && fileLocation.endLine !== fileLocation.startLine) {
                    tooltip += ` (L${fileLocation.startLine}`;
                    if (fileLocation.startColumn) {
                        tooltip += `:${fileLocation.startColumn}`;
                    }
                    tooltip += `-L${fileLocation.endLine}`;
                    if (fileLocation.endColumn) {
                        tooltip += `:${fileLocation.endColumn}`;
                    }
                    tooltip += ')';
                } else {
                    tooltip += ` (L${fileLocation.startLine}`;
                    if (fileLocation.startColumn) {
                        tooltip += `:${fileLocation.startColumn}`;
                    }
                    tooltip += ')';
                }
            }
            
            link.tooltip = tooltip;
            links.push(link);
        }

        // 3) 处理自定义语法 [[workspace:...]]，点击时打开工作区/文件夹
        const workspacePattern = /\[\[workspace:([^\]]+)\]\]/g;
        for (const match of text.matchAll(workspacePattern)) {
            if (token.isCancellationRequested) {
                return [];
            }

            const workspacePath = match[1].trim();
            if (!workspacePath) continue;

            const startIndex = match.index! + '[[workspace:'.length;
            const endIndex = startIndex + workspacePath.length;

            // 生成 command URI 使用 vscode.openFolder
            // 参数格式为 [ Uri, { forceNewWindow: boolean } ]
            const folderUri = workspacePath.startsWith('/') || workspacePath.match(/^[a-zA-Z]:\\/) ? vscode.Uri.file(workspacePath) : vscode.Uri.file(path.join(getIssueDir() || '', workspacePath));
            // forceNewWindow 留空或按需要设为 true/false，这里使用 false（在当前窗口打开）
            const cmdUri = vscode.Uri.parse(`command:vscode.openFolder?${encodeURIComponent(JSON.stringify([folderUri, { forceNewWindow: false }]))}`);

            const range = new vscode.Range(
                document.positionAt(startIndex),
                document.positionAt(endIndex)
            );

            const link = new vscode.DocumentLink(range, cmdUri);
            link.tooltip = '在当前窗口打开工作区/文件夹';
            links.push(link);
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

            // 如果有查询参数，优先检查是否包含 issueId
            if (queryString) {
                const issueIdMatch = queryString.match(/issueId=([^&]+)/);
                if (issueIdMatch) {
                    const issueId = decodeURIComponent(issueIdMatch[1]);
                    // 使用 command URI 调用快速查看命令，传入 issueId
                    const cmdUri = vscode.Uri.parse(`command:issueManager.quickPeekIssue?${encodeURIComponent(JSON.stringify([issueId]))}`);
                    return {
                        uri: cmdUri,
                        tooltip: `快速查看 Issue (${issueId})`
                    };
                }

                // 其余查询参数保留在文件 URI 上
                uri = uri.with({ query: queryString });
            }

            return { uri };
        } catch (error) {
            // 解析失败，使用 Logger 记录
            Logger.getInstance().error(`解析链接失败: ${linkPath}`, error);
            return null;
        }
    }
}
