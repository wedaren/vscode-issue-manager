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
        if (!filterResult.hasTrigger && (!context.triggerCharacter || !termTriggerChars.includes(context.triggerCharacter))) {
            return undefined;
        }

        const termItems = await collectTermsForDocument(document, issueDir);

        let filteredItems = termItems;
        if (filterResult.keyword) {
            const keyword = filterResult.keyword.toLowerCase();
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

        const lineText = document.lineAt(position.line).text;
        const prefix = lineText.slice(0, position.character);
        // 根据配置的触发前缀计算最近的触发位置（选择最后出现的触发字符串）
        const triggerIndex = termTriggers.reduce(
            (maxIndex, trigger) => Math.max(maxIndex, prefix.lastIndexOf(trigger)),
            -1
        );
        const replaceStart = triggerIndex >= 0 ? triggerIndex : position.character;
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

        completionItem.detail = path.basename(item.sourceUri.fsPath);

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
