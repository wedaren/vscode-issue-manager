import * as vscode from 'vscode';
import * as path from 'path';
import { getIssueDir } from '../config';
import { Logger } from '../core/utils/Logger';
import { parseFileLink, type FileLocation } from '../utils/fileLinkFormatter';
import { getSingleIssueNodeByUri } from '../data/issueTreeManager';
import { collectTermsForDocument } from '../utils/issueMarkdownTerms';
import { isDocumentInDirectory } from '../utils/completionUtils';

/**
 * 解析 IssueMarkdown 文档中的链接，特别是包含 ?issueId= 查询参数的链接
 * 使得点击链接时能够正确导航到文件并保留 issueId 上下文
 */
export class IssueDocumentLinkProvider implements vscode.DocumentLinkProvider {
    /**
     * 提供文档中的链接
     */
    async provideDocumentLinks(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): Promise<vscode.DocumentLink[]> {
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

            const parsed = await parseIssueLinkPath(linkPath, document, issueDir);
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
            const fileLocation = parseFileLink(linkText, issueDir);
            
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

        if (token.isCancellationRequested) {
            return links;
        }

        // 4) 处理术语反引号链接（`术语` 或 `术语::文件名`）
        const termLinks = await this.buildTermLinks(document, issueDir, token);
        links.push(...termLinks);

        return links;
    }

    private async buildTermLinks(
        document: vscode.TextDocument,
        issueDir: string,
        token: vscode.CancellationToken
    ): Promise<vscode.DocumentLink[]> {
        const links: vscode.DocumentLink[] = [];
        if (!isDocumentInDirectory(document, issueDir)) {
            return links;
        }
        const termItems = await collectTermsForDocument(document, issueDir);
        if (termItems.length === 0) {
            return links;
        }

        const termMap = new Map<string, typeof termItems[number]>();
        for (const item of termItems) {
            termMap.set(item.displayName, item);
        }

        const lines = document.getText().split(/\r?\n/);
        let inCodeFence = false;

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            if (token.isCancellationRequested) {
                return links;
            }

            const line = lines[lineIndex];
            const trimmed = line.trim();

            if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
                inCodeFence = !inCodeFence;
                continue;
            }

            if (inCodeFence) {
                continue;
            }

            const regex = /`([^`\n]+)`/g;
            let match: RegExpExecArray | null;
            while ((match = regex.exec(line)) !== null) {
                const termText = match[1].trim();
                if (!termText) {
                    continue;
                }

                const termItem = termMap.get(termText);
                if (!termItem) {
                    continue;
                }

                const startChar = match.index + 1;
                const endChar = startChar + match[1].length;
                const range = new vscode.Range(
                    new vscode.Position(lineIndex, startChar),
                    new vscode.Position(lineIndex, endChar)
                );

                const location: FileLocation = { filePath: termItem.sourceUri.fsPath };
                if (termItem.location?.line) {
                    location.startLine = termItem.location.line;
                    location.startColumn = termItem.location.column;
                }

                const args = {
                    location,
                    source: document.uri.toString()
                };

                const cmdUri = vscode.Uri.parse(
                    `command:extension.openInSplit?${encodeURIComponent(JSON.stringify([args]))}`
                );

                const link = new vscode.DocumentLink(range, cmdUri);
                link.tooltip = `打开术语定义: ${termItem.displayName}`;
                links.push(link);
            }
        }

        return links;
    }

}

export class IssueDocumentHoverProvider implements vscode.HoverProvider {
    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        if (document.languageId !== 'markdown') {
            return;
        }

        const issueDir = getIssueDir();
        if (!issueDir) {
            return;
        }

        const text = document.getText();
        const inlineLinkPattern = /\x5B([^\]]+)\x5D\(([^\s)]+)\)/g;

        for (const match of text.matchAll(inlineLinkPattern)) {
            if (token.isCancellationRequested) {
                return;
            }

            const linkPath = match[2];
            const linkStartIndex = match.index!;
            const linkEndIndex = linkStartIndex + match[0].length;
            const range = new vscode.Range(
                document.positionAt(linkStartIndex),
                document.positionAt(linkEndIndex)
            );

            if (!range.contains(position)) {
                continue;
            }

            const parsed = await parseIssueLinkPath(linkPath, document, issueDir);
            if (!parsed?.issueId) {
                return;
            }

            const evenSplitCmdUri = `command:issueManager.quickPeekIssueEvenSplit?${encodeURIComponent(JSON.stringify([parsed.issueId]))}`;
            const tooltip = new vscode.MarkdownString(
                `快速查看 Issue (${parsed.issueId})\n\n[$(split-horizontal) 对半打开](${evenSplitCmdUri})`,
                true
            );
            tooltip.isTrusted = true;
            return new vscode.Hover(tooltip, range);
        }

        return;
    }
}

interface ParsedIssueLink {
    uri: vscode.Uri;
    tooltip?: string;
    issueId?: string;
}

async function parseIssueLinkPath(
    linkPath: string,
    document: vscode.TextDocument,
    issueDir: string
): Promise<ParsedIssueLink | null> {
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
        const issueDirPrefix = /^IssueDir[\\/]/i;
        if (issueDirPrefix.test(filePath)) {
            const relativeToIssueDir = filePath.replace(issueDirPrefix, '');
            absolutePath = path.resolve(issueDir, relativeToIssueDir);
        } else if (path.isAbsolute(filePath)) {
            absolutePath = filePath;
        } else {
            // 相对于当前文档的路径
            const currentDir = path.dirname(document.uri.fsPath);
            absolutePath = path.resolve(currentDir, filePath);
        }

        // 确保路径在 issueDir 内，使用 path.relative 进行更健壮的验证
        // 对于用户输入的绝对路径，我们允许打开（只要路径解析成功），
        // 对于相对路径或以 IssueDir 前缀的路径，仍然需要保证在 issueDir 范围内。
        const normalizedIssuePath = path.normalize(issueDir);
        let normalizedAbsPath = path.normalize(absolutePath);

        const isInputAbsolute = path.isAbsolute(filePath);

        if (!isInputAbsolute) {
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
        }

        // 创建 URI
        let uri = vscode.Uri.file(absolutePath);

        const issueNode = await getSingleIssueNodeByUri(uri);

        if (queryString) {
            const issueIdMatch = queryString.match(/(?:^|&)issueId=([^&]+)/);
            if (issueIdMatch) {
                const issueId = decodeURIComponent(issueIdMatch[1]);
                return makeQuickPeek(issueId);
            }
            // 保留其余查询参数在文件 URI 上
            uri = uri.with({ query: queryString });
        } else if (issueNode) {
            return makeQuickPeek(issueNode.id);
        }

        return { uri };
    } catch (error) {
        // 解析失败，使用 Logger 记录
        Logger.getInstance().error(`解析链接失败: ${linkPath}`, error);
        return null;
    }
}

function makeQuickPeek(id: string): ParsedIssueLink {
    const cmdUri = vscode.Uri.parse(
        `command:issueManager.quickPeekIssue?${encodeURIComponent(JSON.stringify([id]))}`
    );
    return { uri: cmdUri, tooltip: `快速查看 Issue (${id})`, issueId: id };
};
