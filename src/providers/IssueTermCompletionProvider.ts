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

        const filterResult = extractFilterKeyword(document, position, ["`", "·"], 200);
        if (!filterResult.hasTrigger && context.triggerCharacter !== "`" && context.triggerCharacter !== "·") {
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
        const backtickIndex = prefix.lastIndexOf("`");
        const middleDotIndex = prefix.lastIndexOf("·");
        const triggerIndex = Math.max(backtickIndex, middleDotIndex);
        const replaceStart = triggerIndex >= 0 ? triggerIndex : position.character;
        const replacingRange = new vscode.Range(
            new vscode.Position(position.line, replaceStart),
            position
        );

        const items = filteredItems.map((item, index) => this.createCompletionItem(item, replacingRange, index));
        return new vscode.CompletionList(items, true);
    }

    private createCompletionItem(
        item: TermDisplayItem,
        replacingRange: vscode.Range,
        sortIndex: number
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
            "·",
            item.term.definition || ""
        ].join(" ");

        return completionItem;
    }
}
