import * as vscode from "vscode";
import * as path from "path";
import { getIssueDir } from "../config";
import { extractFilterKeyword, isDocumentInDirectory } from "../utils/completionUtils";
import { collectTermsForDocument, type TermDisplayItem } from "../utils/issueMarkdownTerms";

export class IssueTermCompletionProvider implements vscode.CompletionItemProvider {
    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[] | vscode.CompletionList | undefined> {
        if (document.languageId !== "markdown") {
            return undefined;
        }

        const issueDir = getIssueDir();
        if (!issueDir || !isDocumentInDirectory(document, issueDir)) {
            return undefined;
        }

        if (token.isCancellationRequested) {
            return undefined;
        }

        // 从配置中读取术语补全的触发前缀（package.json: issueManager.completion.termTriggers）
        const completionConfig = vscode.workspace.getConfiguration('issueManager.completion');
        const termTriggers = completionConfig.get<string[]>('termTriggers', ['`', '·']);
        // 注册时只使用每个触发字符串的首字符，这里用于快速匹配触发字符位置
        const termTriggerChars = [...new Set(termTriggers.map(t => (t || '').charAt(0)).filter(c => !!c))];

        const filterResult = extractFilterKeyword(document, position, termTriggers, 200);

        const lineText = document.lineAt(position.line).text;
        const prefix = lineText.slice(0, position.character);
        // 当没有显式触发前缀时，只使用光标前的最后一个词作为关键字，避免把整行作为关键字
        const lastTokenMatch = prefix.match(/([^\s`·\[\]\(\)\<\>\{\}]+)$/);
        const lastToken = lastTokenMatch ? lastTokenMatch[1] : '';

        // 如果既没有显式触发前缀，也没有已输入的关键字，并且触发字符不匹配，则不提供补全
        if (!filterResult.hasTrigger && !lastToken && (!context.triggerCharacter || !termTriggerChars.includes(context.triggerCharacter))) {
            return undefined;
        }

        const termItems = await collectTermsForDocument(document, issueDir);

        let filteredItems = termItems;
        const effectiveKeyword = filterResult.hasTrigger ? (filterResult.keyword || '') : lastToken;
        if (effectiveKeyword) {
            const keyword = effectiveKeyword.toLowerCase();
            filteredItems = termItems.filter((item) => {
                const display = item.displayName.toLowerCase();
                const name = item.term.name.toLowerCase();
                const base = item.sourceBaseName.toLowerCase();
                const definition = (item.term.definition || "").toLowerCase();
                return display.includes(keyword) || name.includes(keyword) || base.includes(keyword) || definition.includes(keyword);
            });
        }

        if (filteredItems.length === 0) {
            return undefined;
        }

        const maxItems = vscode.workspace.getConfiguration("issueManager.completion").get<number>("maxItems", 200);
        if (filteredItems.length > maxItems) {
            filteredItems = filteredItems.slice(0, maxItems);
        }

        // 根据配置的触发前缀计算光标前最近出现且最长匹配的触发器位置（支持多字符触发器）
        const { index: triggerIndex, trigger: triggerString } = termTriggers.reduce(
            (best, trigger) => {
                const idx = prefix.lastIndexOf(trigger);
                if (idx > best.index) {
                    return { index: idx, trigger };
                }
                return best;
            },
            { index: -1, trigger: '' }
        );

        // 只有当触发前缀后面紧邻光标处的 token（即触发后没有空白或其他分隔符）时，才视为有效触发
        const triggerValid = triggerIndex >= 0 && (() => {
            const after = prefix.slice(triggerIndex + (triggerString ? triggerString.length : 0));
            // 触发后不应包含空白字符或其他触发字符（比如另一个反引号）
            return /^[^\[\]\(\)<>{}\s`]*$/.test(after);
        })();
        const effectiveHasTrigger = filterResult.hasTrigger && triggerValid;

        // 如果找到有效触发前缀，替换从触发位置开始；否则如果用户输入了关键字，则替换关键字范围；否则在光标处插入
        let replaceStart: number;
        if (effectiveHasTrigger) {
            replaceStart = triggerIndex;
        } else if (lastToken) {
            replaceStart = Math.max(0, position.character - lastToken.length);
        } else {
            replaceStart = position.character;
        }
        const replacingRange = new vscode.Range(
            new vscode.Position(position.line, replaceStart),
            position
        );

        const items = filteredItems.map((item, index) => this.createCompletionItem(item, replacingRange, index, termTriggers));
        return new vscode.CompletionList(items, true);
    }

    private createCompletionItem(
        item: TermDisplayItem,
        replacingRange: vscode.Range,
        sortIndex: number,
        termTriggers: string[]
    ): vscode.CompletionItem {
        const completionItem = new vscode.CompletionItem(item.displayName, vscode.CompletionItemKind.Constant);
        completionItem.insertText = `\`${item.displayName}\``;
        completionItem.range = replacingRange;
        completionItem.sortText = sortIndex.toString().padStart(6, "0");

        completionItem.detail = item.term.definition || '无定义';

        const docParts: string[] = [`**${item.displayName}**`];
        if (item.term.definition) {
            docParts.push(item.term.definition);
        }
        docParts.push(`来源: ${path.basename(item.sourceUri.fsPath)}`);

        completionItem.documentation = new vscode.MarkdownString(docParts.join("\n\n"));
        completionItem.filterText = [
            item.displayName,
            `\`${item.displayName}\``,
            item.term.name,
            item.sourceBaseName,
            // 把所有配置的触发前缀也包含在 filterText 中，保证筛选一致性
            ...(termTriggers || []),
            item.term.definition || ""
        ].join(" ");

        return completionItem;
    }
}
