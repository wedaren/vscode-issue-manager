import * as vscode from "vscode";
import * as path from "path";
import { getIssueDir } from "../config";
import { getAllIssueMarkdowns, IssueMarkdown, FrontmatterData } from "../data/IssueMarkdowns";
import { LLMService } from "../llm/LLMService";
import { Logger } from "../core/utils/Logger";
import { v4 as uuidv4 } from 'uuid';
import { addIssueSearchRecord, IssueSearchRecord, IssueSearchResult, readIssueSearchHistory } from "../data/issueSearchHistory";
import { getIssueNodesByUri } from "../data/issueTreeManager";
import { openIssueNode } from "../commands/openIssueNode";
import { FullTextSearchService } from "../services/FullTextSearchService";

export type IssueSearchViewNode =
    | { type: "record"; record: IssueSearchRecord }
    | { type: "result"; recordId: string; result: IssueSearchResult };

interface SearchQuickPickItem extends vscode.QuickPickItem {
    action: "ai" | "filter" | "fulltext";
    payload?: IssueMarkdown;
}

const AI_LABEL_SUFFIX = "--AI 搜索";
const FULLTEXT_LABEL_SUFFIX = "--全文搜索";

function normalizeKeyword(value: string): string {
    return (value || "").trim();
}

function formatDate(value: number): string {
    const d = new Date(value);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function getBriefSummary(frontmatter?: FrontmatterData | null): string | undefined {
    if (!frontmatter) {
        return undefined;
    }
    const summary = frontmatter.issue_brief_summary;
    if (typeof summary === "string") {
        return summary;
    }
    if (Array.isArray(summary) && summary.length > 0 && typeof summary[0] === "string") {
        return summary[0];
    }
    return undefined;
}

function createSearchRecord(
    keyword: string,
    type: "ai" | "filter" | "fulltext",
    results: IssueSearchResult[]
): IssueSearchRecord {
    return {
        id: `${type}-${uuidv4()}`,
        keyword,
        type,
        createdAt: Date.now(),
        results
    };
}

function createPendingRecord(keyword: string): IssueSearchRecord {
    return {
        id: `pending-ai-${uuidv4()}`,
        keyword,
        type: "ai",
        createdAt: Date.now(),
        results: []
    };
}

function filterIssuesByKeyword(issues: IssueMarkdown[], keyword: string): IssueMarkdown[] {
    const normalized = normalizeKeyword(keyword).toLowerCase();
    if (!normalized) {
        return [];
    }

    return issues.filter(issue => {
        const title = issue.title.toLowerCase();
        const summary = getBriefSummary(issue.frontmatter)?.toLowerCase() || "";
        const filePath = issue.uri.fsPath.toLowerCase();
        return title.includes(normalized) || summary.includes(normalized) || filePath.includes(normalized);
    });
}

export class IssueSearchViewProvider implements vscode.TreeDataProvider<IssueSearchViewNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<IssueSearchViewNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private recordCache: IssueSearchRecord[] | null = null;
    private pendingAiRecords = new Map<string, IssueSearchRecord>();

    constructor(private context: vscode.ExtensionContext) {
        this.registerCommands();
    }

    refresh(): void {
        this.recordCache = null;
        this._onDidChangeTreeData.fire();
    }

    async getTreeItem(element: IssueSearchViewNode): Promise<vscode.TreeItem> {
        if (element.type === "record") {
            const record = element.record;
            const isPending = this.pendingAiRecords.has(record.id);
            const typeLabel = record.type === "ai" ? "AI 搜索" : record.type === "fulltext" ? "全文搜索" : "过滤";
            const label = `[${formatDate(record.createdAt)}] ${record.keyword} (${typeLabel})`;
            const collapsibleState = record.results.length > 0
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None;
            const item = new vscode.TreeItem(label, collapsibleState);
            if (isPending) {
                item.description = record.type === "ai" ? "AI 搜索中..." : "全文搜索中...";
                item.contextValue = "issueSearchRecordLoading";
                item.iconPath = new vscode.ThemeIcon("sync~spin");
                item.tooltip = record.type === "ai" ? "正在执行 AI 搜索，请稍候..." : "正在执行全文搜索，请稍候...";
            } else {
                item.description = record.results.length > 0 ? `(${record.results.length})` : "";
                item.contextValue = "issueSearchRecord";
                const iconName = record.type === "ai" ? "sparkle" : record.type === "fulltext" ? "search" : "filter";
                item.iconPath = new vscode.ThemeIcon(iconName);
            }
            return item;
        }

        const result = element.result;
        const item = new vscode.TreeItem(result.title || result.filePath, vscode.TreeItemCollapsibleState.None);
        
        // 如果有匹配片段，显示第一个匹配的内容预览
        if (result.matchedSnippets && result.matchedSnippets.length > 0) {
            const firstSnippet = result.matchedSnippets[0];
            const previewText = firstSnippet.text.replace(/\n/g, ' ').substring(0, 100);
            item.description = `L${firstSnippet.lineNumber}: ${previewText}...`;
            item.tooltip = new vscode.MarkdownString(`**匹配位置：** 第 ${firstSnippet.lineNumber} 行\n\n\`\`\`\n${firstSnippet.text}\n\`\`\``);
        } else {
            item.description = result.briefSummary || result.filePath;
        }
        
        item.contextValue = "issueSearchResult";
        const issueDir = getIssueDir();
        if (issueDir) {
            item.resourceUri = vscode.Uri.file(path.join(issueDir, result.filePath));
        }
        item.command = {
            command: "issueManager.issueSearch.openResult",
            title: "打开搜索结果",
            arguments: [result.filePath, result.matchedSnippets?.[0]?.lineNumber]
        };
        return item;
    }

    async getChildren(element?: IssueSearchViewNode): Promise<IssueSearchViewNode[]> {
        if (!element) {
            const records = await this.getRecords();
            return records.map(record => ({ type: "record", record }));
        }

        if (element.type === "record") {
            return element.record.results.map(result => ({
                type: "result",
                recordId: element.record.id,
                result
            }));
        }

        return [];
    }

    private async getRecords(): Promise<IssueSearchRecord[]> {
        if (this.recordCache) {
            return this.recordCache;
        }
        const data = await readIssueSearchHistory();
        const pending = Array.from(this.pendingAiRecords.values());
        this.recordCache = [...pending, ...(data.records || [])];
        return this.recordCache;
    }

    private registerCommands(): void {
        this.context.subscriptions.push(
            vscode.commands.registerCommand("issueManager.issueSearch.addTask", async () => {
                await this.runSearchFlow();
            }),
            vscode.commands.registerCommand("issueManager.issueSearch.refresh", () => this.refresh()),
            vscode.commands.registerCommand("issueManager.issueSearch.openResult", async (filePath: string, lineNumber?: number) => {
                await this.openResultByFilePath(filePath, lineNumber);
            })
        );
    }

    private async runSearchFlow(): Promise<void> {
        const issueDir = getIssueDir();
        if (!issueDir) {
            vscode.window.showErrorMessage('请先配置 "issueManager.issueDir"');
            vscode.commands.executeCommand('workbench.action.openSettings', 'issueManager.issueDir');
            return;
        }

        const issues = await getAllIssueMarkdowns({ sortBy: "vtime" });
        if (issues.length === 0) {
            vscode.window.showInformationMessage("当前没有可搜索的问题。");
        }

        const quickPick = vscode.window.createQuickPick<SearchQuickPickItem>();
        quickPick.placeholder = "请输入搜索关键词，选择 AI 搜索、全文搜索或 issueMarkdown 过滤";
        quickPick.matchOnDescription = true;
        quickPick.matchOnDetail = false;

        const staticItems = this.buildFilterItems(issues);
        const buildAiItem = (value: string): SearchQuickPickItem => ({
            label: `${value}${AI_LABEL_SUFFIX}`,
            description: "使用 AI 进行语义搜索",
            alwaysShow: true,
            action: "ai"
        });
        const buildFullTextItem = (value: string): SearchQuickPickItem => ({
            label: `${value}${FULLTEXT_LABEL_SUFFIX}`,
            description: "在问题的完整内容中搜索关键词",
            alwaysShow: true,
            action: "fulltext"
        });

        const updateItems = (value: string) => {
            const aiItem = buildAiItem(value || "");
            const fullTextItem = buildFullTextItem(value || "");
            quickPick.items = [aiItem, fullTextItem, ...staticItems];
            quickPick.activeItems = [fullTextItem]; // 默认选中全文搜索
        };

        updateItems("");

        const disposables: vscode.Disposable[] = [];
        const disposeAll = () => {
            disposables.forEach(d => d.dispose());
            quickPick.dispose();
        };

        disposables.push(
            quickPick.onDidChangeValue(value => updateItems(value)),
            quickPick.onDidAccept(async () => {
                const selected = quickPick.selectedItems[0];
                if (!selected) {
                    disposeAll();
                    return;
                }

                const keyword = normalizeKeyword(quickPick.value);

                if (selected.action === "ai") {
                    this.startAiSearch(keyword, issues);
                    disposeAll();
                    return;
                }
                if (selected.action === "fulltext") {
                    this.startFullTextSearch(keyword, issues);
                    disposeAll();
                    return;
                }
                if (selected.action === "filter" && selected.payload) {
                    await this.handleFilterSearch(keyword, selected.payload, issues);
                }

                disposeAll();
            }),
            quickPick.onDidHide(() => disposeAll())
        );

        quickPick.show();
    }

    private buildFilterItems(issues: IssueMarkdown[]): SearchQuickPickItem[] {
        const items: SearchQuickPickItem[] = [];
        let lastGroup = "";

        issues.forEach(issue => {
            const time = issue.vtime ?? issue.mtime;
            const groupLabel = formatDate(time);
            if (groupLabel !== lastGroup) {
                items.push({
                    label: groupLabel,
                    kind: vscode.QuickPickItemKind.Separator,
                    action: "filter"
                });
                lastGroup = groupLabel;
            }

            items.push({
                label: issue.title,
                description: getBriefSummary(issue.frontmatter) || "",
                action: "filter",
                payload: issue
            });
        });

        return items;
    }

    private startFullTextSearch(keyword: string, issues: IssueMarkdown[]): void {
        if (!keyword) {
            vscode.window.showInformationMessage("请输入搜索关键词后再进行全文搜索。");
            return;
        }

        const pendingRecord = createPendingRecord(keyword);
        pendingRecord.type = "fulltext";
        this.pendingAiRecords.set(pendingRecord.id, pendingRecord);
        this.refresh();

        void this.handleFullTextSearch(pendingRecord, issues);
    }

    private async handleFullTextSearch(pendingRecord: IssueSearchRecord, issues: IssueMarkdown[]): Promise<void> {
        const keyword = pendingRecord.keyword;
        
        try {
            // 执行全文搜索
            const results = await FullTextSearchService.searchInContent(keyword, issues, {
                caseSensitive: false,
                useRegex: false,
                wholeWord: false,
                maxResults: 50,
                maxSnippetsPerFile: 3,
                contextLines: 0
            });

            this.pendingAiRecords.delete(pendingRecord.id);

            if (results.length === 0) {
                vscode.window.showInformationMessage(`全文搜索未找到包含 "${keyword}" 的问题。`);
                this.refresh();
                return;
            }

            const record = createSearchRecord(keyword, "fulltext", results);
            await addIssueSearchRecord(record);
            this.refresh();
            
            vscode.window.showInformationMessage(`全文搜索完成，找到 ${results.length} 个匹配的问题。`);
        } catch (error) {
            this.pendingAiRecords.delete(pendingRecord.id);
            Logger.getInstance().error("全文搜索失败", error);
            vscode.window.showErrorMessage(`全文搜索失败: ${error}`);
            this.refresh();
        }
    }

    private startAiSearch(keyword: string, issues: IssueMarkdown[]): void {
        if (!keyword) {
            vscode.window.showInformationMessage("请输入搜索关键词后再进行 AI 搜索。");
            return;
        }

        const pendingRecord = createPendingRecord(keyword);
        this.pendingAiRecords.set(pendingRecord.id, pendingRecord);
        this.refresh();

        void this.handleAiSearch(pendingRecord, issues);
    }

    private async handleAiSearch(pendingRecord: IssueSearchRecord, issues: IssueMarkdown[]): Promise<void> {
        const keyword = pendingRecord.keyword;
        const matches = await LLMService.searchIssueMarkdowns(keyword);
        const issueDir = getIssueDir() || "";
        const issueMap = new Map<string, IssueMarkdown>();
        issues.forEach(issue => {
            issueMap.set(issue.uri.fsPath, issue);
        });

        const results: IssueSearchResult[] = [];
        matches.forEach(match => {
            const absPath = path.resolve(issueDir, match.filePath);

            // 安全性校验：确保解析后的路径仍在 issueDir 目录内，防止路径遍历
            const relativeToIssueDir = path.relative(issueDir, absPath);
            if (relativeToIssueDir.startsWith("..") || path.isAbsolute(relativeToIssueDir)) {
                Logger.getInstance().warn(`AI 返回的路径可能存在遍历风险，已跳过: ${match.filePath}`);
                return;
            }

            const issue = issueMap.get(absPath);
            if (!issue) {
                return;
            }
            const relPath = path.relative(issueDir, issue.uri.fsPath);
            results.push({
                filePath: relPath,
                title: issue.title,
                briefSummary: getBriefSummary(issue.frontmatter)
            });
        });

        this.pendingAiRecords.delete(pendingRecord.id);

        if (results.length === 0) {
            vscode.window.showInformationMessage("AI 搜索未找到相关问题。");
            this.refresh();
            return;
        }

        const record = createSearchRecord(keyword, "ai", results);
        await addIssueSearchRecord(record);
        this.refresh();
    }

    private async handleFilterSearch(keyword: string, selected: IssueMarkdown, issues: IssueMarkdown[]): Promise<void> {
        const issueDir = getIssueDir();
        if (!issueDir) {
            return;
        }

        const targetIssues = keyword
            ? filterIssuesByKeyword(issues, keyword)
            : [selected];

        if (keyword && targetIssues.length === 0) {
            vscode.window.showInformationMessage("未找到匹配的 issueMarkdown 记录。");
            return;
        }

        const results: IssueSearchResult[] = targetIssues.map(issue => ({
            filePath: path.relative(issueDir, issue.uri.fsPath),
            title: issue.title,
            briefSummary: getBriefSummary(issue.frontmatter)
        }));

        const record = createSearchRecord(keyword || selected.title, "filter", results);
        await addIssueSearchRecord(record);
        this.refresh();

        await this.openResultByFilePath(path.relative(issueDir, selected.uri.fsPath));
    }

    private async openResultByFilePath(filePath: string, lineNumber?: number): Promise<void> {
        const issueDir = getIssueDir();
        if (!issueDir) {
            return;
        }

        try {
            const absPath = path.isAbsolute(filePath) ? filePath : path.join(issueDir, filePath);
            const uri = vscode.Uri.file(absPath);
            const nodes = await getIssueNodesByUri(uri);
            if (nodes.length > 0) {
                await openIssueNode(nodes[0]);
                
                // 如果有行号，跳转到指定行
                if (lineNumber !== undefined && lineNumber > 0) {
                    const editor = vscode.window.activeTextEditor;
                    if (editor && editor.document.uri.fsPath === absPath) {
                        const position = new vscode.Position(lineNumber - 1, 0);
                        editor.selection = new vscode.Selection(position, position);
                        editor.revealRange(
                            new vscode.Range(position, position),
                            vscode.TextEditorRevealType.InCenter
                        );
                    }
                }
                return;
            }
            
            // 如果不在树中，直接打开文件
            const document = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(document, { preview: false });
            
            // 跳转到指定行
            if (lineNumber !== undefined && lineNumber > 0) {
                const position = new vscode.Position(lineNumber - 1, 0);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(
                    new vscode.Range(position, position),
                    vscode.TextEditorRevealType.InCenter
                );
            }
        } catch (error) {
            Logger.getInstance().error("打开搜索结果失败", error);
            vscode.window.showErrorMessage("打开搜索结果失败。");
        }
    }
}
