import * as vscode from 'vscode';
import * as path from 'path';
import { extractFilterKeyword, isDocumentInDirectory } from '../utils/completionUtils';
import { getIssueDir } from '../config';
import { getAllIssueMarkdowns, IssueMarkdown } from '../data/IssueMarkdowns';

/**
 * Issue 文件补全提供器
 * 提供：1) 在行首插入 `<!-- llm:queued -->` 快速标记对话；
 *       2) 从 Issue 列表插入相对链接或快速创建新 Issue（快捷命令）；
 */
export class IssueNodeCompletionProvider implements vscode.CompletionItemProvider {

    constructor(context: vscode.ExtensionContext) {
    }

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[] | vscode.CompletionList | undefined> {

        // 检查文档语言
        if (document.languageId !== 'markdown') {
            return undefined;
        }

        // 检查是否在 issueDir 下
        const issueDir = getIssueDir();
        if (!issueDir || !isDocumentInDirectory(document, issueDir)) {
            return undefined;
        }

        // 获取配置
        const config = vscode.workspace.getConfiguration('issueManager.completion');
        const triggers = config.get<string[]>('triggers', ['[', '【']);
        const maxItems = config.get<number>('maxItems', 50);
        const maxFilterLength = config.get<number>('maxFilterLength', 200);

        // 提取过滤关键字
        const filterResult = extractFilterKeyword(document, position, triggers, maxFilterLength);

        try {
            // 获取当前行文本
            const lineText = document.lineAt(position.line).text;
            // 获取光标之前的文本
            const prefix = lineText.slice(0, position.character);

            const lineStart = new vscode.Position(position.line, 0);
            const replacingRange = new vscode.Range(lineStart, position);
            const insertingAtLineStart = new vscode.Range(lineStart, lineStart);

            const insertMode = config.get<string>('insertMode', 'relativePath');

            // 已移除原固定项：`## User (timestamp)`，编号及排序已调整

            // ─── 固定项 1：<!-- llm:queued --> ─────────────────────
            const queuedItem = new vscode.CompletionItem('<!-- llm:queued -->', vscode.CompletionItemKind.Snippet);
            queuedItem.detail = '标记对话等待 LLM 处理';
            queuedItem.documentation = new vscode.MarkdownString('追加此标记后保存文件（`Cmd+S`），将立即触发 LLM 处理当前对话。');
            queuedItem.insertText = new vscode.SnippetString('<!-- llm:queued -->');
            queuedItem.sortText = '\u0000';
            queuedItem.filterText = `<!-- llm ${prefix ?? ''}`;
            queuedItem.range = { inserting: insertingAtLineStart, replacing: replacingRange };

            // ─── 固定项 2/3：新建问题 ───────────────────────────────
            const createItem = new vscode.CompletionItem('新建问题', vscode.CompletionItemKind.Keyword);
            createItem.detail = `快速新建问题:${prefix ?? ''}`;
            createItem.insertText = prefix  ?? '';
            createItem.keepWhitespace = true;
            createItem.sortText = '\u0001';
            createItem.preselect = true;
            createItem.filterText = prefix ?? '';
            createItem.command = { command: 'issueManager.createIssueFromCompletion', title: '快速新建问题', arguments: [null, prefix ?? undefined, false, insertMode, false] };

            const createBackground = new vscode.CompletionItem('新建问题（后台）', vscode.CompletionItemKind.Keyword);
            createBackground.detail = `后台创建并由 AI 填充（不打开）:${prefix ?? ''}`;
            createBackground.insertText = prefix  ?? '';
            createBackground.keepWhitespace = true;
            createBackground.sortText = '\u0002';
            createBackground.preselect = true;
            createBackground.filterText = prefix ?? '';
            createBackground.command = { command: 'issueManager.createIssueFromCompletion', title: '快速新建问题（后台）', arguments: [null, prefix ?? undefined, true, insertMode, false] };

            createItem.range = { inserting: insertingAtLineStart, replacing: replacingRange };
            createBackground.range = { inserting: insertingAtLineStart, replacing: replacingRange };

            // 仅在明确输入触发前缀时才加载 issue 补全项
            if (!filterResult.hasTrigger) {
                const isLineStart = prefix.trim().length === 0;
                const endsWithSpace = prefix.length > 0 && prefix.endsWith(' ');

                if (isLineStart) {
                    return new vscode.CompletionList([queuedItem], false);
                }
                if (endsWithSpace) {
                    return new vscode.CompletionList([createItem, createBackground], false);
                }
                return undefined;
            }

            // ─── 以下为 issue 项（需要 [ 或 【 触发） ───────────────
            const allIssues = await getAllIssueMarkdowns();

            let filtered = allIssues;
            if (filterResult.keyword) {
                filtered = this.filterIssues(allIssues, filterResult.keyword);
            }

            if (filtered.length > maxItems) {
                filtered = filtered.slice(0, maxItems);
            }

            // 计算触发范围：从触发符开始到光标位置（含右侧 ] 或 】）
            let triggerRange: vscode.Range | undefined;
            if (filterResult.triggerName) {
                const triggerStart = prefix.lastIndexOf(filterResult.triggerName);
                if (triggerStart >= 0) {
                    let rangeEnd = position;
                    const suffix = lineText.slice(position.character);
                    if (suffix.startsWith(']') || suffix.startsWith('】')) {
                        rangeEnd = new vscode.Position(position.line, position.character + 1);
                    }
                    triggerRange = new vscode.Range(
                        new vscode.Position(position.line, triggerStart),
                        rangeEnd
                    );
                }
            }

            const items = filtered.map((issue, index) =>
                this.createCompletionItem(issue, index + 3, triggerRange)
            );

            // 触发模式下只返回 issue 项，不混入固定项
            return new vscode.CompletionList(items, true);
        } catch (error) {
            console.error('补全提供器错误:', error);
            return undefined;
        }
    }

    /**
     * 过滤 issue（包含匹配）
     */
    private filterIssues(issues: IssueMarkdown[], query: string): IssueMarkdown[] {
        const queryLower = query.toLowerCase();
        return issues.filter(issue => {
            const titleLower = issue.title.toLowerCase();
            const basename = path.basename(issue.uri.fsPath).toLowerCase();
            const basenameNoExt = basename.replace(/\.[^.]+$/, '');
            return titleLower.includes(queryLower) ||
                basename.includes(queryLower) ||
                basenameNoExt.includes(queryLower);
        });
    }

    /**
     * 创建补全项
     */
    private createCompletionItem(
        issue: IssueMarkdown,
        sortIndex: number,
        triggerRange?: vscode.Range
    ): vscode.CompletionItem {
        const title = issue.title;
        const maxTitleLen = 16;
        const displayTitle = title.length > maxTitleLen ? title.slice(0, maxTitleLen) + '…' : title;
        const basename = path.basename(issue.uri.fsPath);
        const basenameNoExt = basename.replace(/\.[^.]+$/, '');
        const relativePath = `IssueDir/${basename}`;

        const item = new vscode.CompletionItem(
            title,
            vscode.CompletionItemKind.Reference
        );

        item.sortText = sortIndex.toString().padStart(6, '0');

        // 过滤文本：无扩展名文件名、文件名、标题，以及中文分词变体
        const spacefy = (s: string) => s.split('').join(' ');
        const parts: string[] = [basenameNoExt, basename, title, spacefy(title), spacefy(basename)];

        item.detail = `${relativePath}  ${this.relativeTime(issue.mtime)}`;
        item.documentation = new vscode.MarkdownString(`**${title}**`);

        // 统一使用 markdown link 格式
        item.insertText = `[${displayTitle}](${relativePath})`;

        if (triggerRange) {
            // 同时包含 [ 和 【 以兼容两种触发符
            item.filterText = '[【' + parts.join(' ');
            item.range = triggerRange;
        } else {
            item.filterText = parts.join(' ');
        }

        return item;
    }

    private relativeTime(ms: number): string {
        const diff = Date.now() - ms;
        const sec = Math.floor(diff / 1000);
        if (sec < 60) { return `${sec}秒前`; }
        const min = Math.floor(sec / 60);
        if (min < 60) { return `${min}分钟前`; }
        const hr = Math.floor(min / 60);
        if (hr < 24) { return `${hr}小时前`; }
        const day = Math.floor(hr / 24);
        if (day < 30) { return `${day}天前`; }
        const mon = Math.floor(day / 30);
        if (mon < 12) { return `${mon}个月前`; }
        return `${Math.floor(mon / 12)}年前`;
    }
}
