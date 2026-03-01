import * as vscode from "vscode";
import * as path from "path";
import { getIssueDir } from "../config";
import { getAllIssueMarkdowns, IssueMarkdown, FrontmatterData } from "../data/IssueMarkdowns";
import { LLMService } from "../llm/LLMService";
import { Logger } from "../core/utils/Logger";
import { v4 as uuidv4 } from 'uuid';
import { addIssueSearchRecord, IssueSearchRecord, IssueSearchResult, readIssueSearchHistory, removeIssueSearchRecord } from "../data/issueSearchHistory";
import { getIssueNodesByUri } from "../data/issueTreeManager";
import { openIssueNode } from "../commands/openIssueNode";

export type IssueSearchViewNode =
    | { type: "record"; record: IssueSearchRecord }
    | { type: "subtask"; recordId: string; subtask: import("../data/issueSearchHistory").IssueSearchSubtask }
    | { type: "result"; recordId: string; result: IssueSearchResult };

interface SearchQuickPickItem extends vscode.QuickPickItem {
    action: "ai" | "filter";
    payload?: IssueMarkdown;
}

const AI_LABEL_SUFFIX = "--AI 搜索";

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

function createSearchRecord(keyword: string, type: "ai" | "filter", results: IssueSearchResult[]): IssueSearchRecord {
    const subtaskId = `${type}-${uuidv4()}`;
    return {
        id: `${type}-${uuidv4()}`,
        keyword,
        createdAt: Date.now(),
        subtasks: [
            {
                id: subtaskId,
                type,
                status: "done",
                results,
                lastRunAt: Date.now()
            }
        ]
    } as unknown as IssueSearchRecord;
}

function createPendingRecord(keyword: string): IssueSearchRecord {
    const aiId = `ai-${uuidv4()}`;
    return {
        id: `pending-${uuidv4()}`,
        keyword,
        createdAt: Date.now(),
        subtasks: [
            {
                id: aiId,
                type: "ai",
                status: "pending",
                results: []
            }
        ]
    } as unknown as IssueSearchRecord;
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

function filterIssuesByTitle(issues: IssueMarkdown[], keyword: string): IssueMarkdown[] {
    const normalized = normalizeKeyword(keyword).toLowerCase();
    if (!normalized) return [];
    return issues.filter(issue => issue.title.toLowerCase().includes(normalized));
}

function filterIssuesBySummary(issues: IssueMarkdown[], keyword: string): IssueMarkdown[] {
    const normalized = normalizeKeyword(keyword).toLowerCase();
    if (!normalized) return [];
    return issues.filter(issue => {
        const summary = getBriefSummary(issue.frontmatter)?.toLowerCase() || "";
        return summary.includes(normalized);
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
            const isPending = this.pendingAiRecords.has(record.id) || record.subtasks.some(s => s.status === "pending" || s.status === "running");
            const total = record.subtasks.reduce((n, s) => n + (s.results?.length || 0), 0);
            const label = `[${formatDate(record.createdAt)}] ${record.keyword}`;
            const collapsibleState = record.subtasks.length > 0
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None;
            const item = new vscode.TreeItem(label, collapsibleState);
            item.description = total > 0 ? `(${total})` : "";
            item.contextValue = "issueSearchRecord";
            if (isPending) {
                item.iconPath = new vscode.ThemeIcon("sync~spin");
                item.tooltip = "子任务正在执行中，点击可重试。";
            } else {
                item.iconPath = new vscode.ThemeIcon("search");
            }
            // 点击记录节点运行重试命令（用户可点击图标或条目触发）
            item.command = {
                command: "issueManager.issueSearch.retryTask",
                title: "重试搜索会话",
                arguments: [{ type: "record", record }]
            } as any;
            return item;
        }

        if (element.type === "subtask") {
            const s = element.subtask;
            const typeLabel = s.type === "ai" ? "AI 搜索" : s.type === "title" ? "标题过滤" : s.type === "summary" ? "摘要过滤" : "过滤";
            const label = `${typeLabel} (${s.status})`;
            const collapsible = s.results && s.results.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
            const item = new vscode.TreeItem(label, collapsible);
            item.description = s.results && s.results.length > 0 ? `(${s.results.length})` : "";
            item.contextValue = "issueSearchSubtask";
            if (s.status === "pending" || s.status === "running") {
                item.iconPath = new vscode.ThemeIcon("sync~spin");
            } else if (s.status === "done") {
                item.iconPath = new vscode.ThemeIcon("pass") as any;
            } else {
                item.iconPath = new vscode.ThemeIcon("error") as any;
                if (s.error) {
                    item.tooltip = s.error;
                }
            }
            // 点击子任务节点执行重试子任务命令
            item.command = {
                command: "issueManager.issueSearch.retrySubtask",
                title: "重试子任务",
                arguments: [{ type: "subtask", recordId: element.recordId, subtask: element.subtask }]
            } as any;
            return item;
        }

        const result = element.result;
        const item = new vscode.TreeItem(result.title || result.filePath, vscode.TreeItemCollapsibleState.None);
        item.description = result.briefSummary || result.filePath;
        item.contextValue = "issueSearchResult";
        const issueDir = getIssueDir();
        if (issueDir) {
            item.resourceUri = vscode.Uri.file(path.join(issueDir, result.filePath));
        }
        item.command = {
            command: "issueManager.issueSearch.openResult",
            title: "打开搜索结果",
            arguments: [result.filePath]
        };
        return item;
    }

    async getChildren(element?: IssueSearchViewNode): Promise<IssueSearchViewNode[]> {
        if (!element) {
            const records = await this.getRecords();
            return records.map(record => ({ type: "record", record }));
        }

        if (element.type === "record") {
            return element.record.subtasks.map(subtask => ({ type: "subtask", recordId: element.record.id, subtask }));
        }

        if (element.type === "subtask") {
            return element.subtask.results.map(result => ({ type: "result", recordId: element.recordId, result }));
        }

        return [];
    }

    private async getRecords(): Promise<IssueSearchRecord[]> {
        if (this.recordCache) {
            return this.recordCache;
        }
        const data = await readIssueSearchHistory();
        const pending = Array.from(this.pendingAiRecords.values());
        // 合并 pending（位于最前）与持久化记录，避免重复
        const persisted = data.records || [];
        const ids = new Set<string>(pending.map(r => r.id));
        const merged = [...pending, ...persisted.filter(r => !ids.has(r.id))];
        this.recordCache = merged;
        return this.recordCache;
    }

    private registerCommands(): void {
        this.context.subscriptions.push(
            vscode.commands.registerCommand("issueManager.issueSearch.addTask", async () => {
                await this.runSearchFlow();
            }),
            vscode.commands.registerCommand("issueManager.issueSearch.refresh", () => this.refresh()),
            vscode.commands.registerCommand("issueManager.issueSearch.retryTask", async (node?: IssueSearchViewNode) => {
                if (!node || node.type !== "record") {
                    vscode.window.showWarningMessage("请在任务节点上执行重试。");
                    return;
                }
                const issues = await getAllIssueMarkdowns({ sortBy: "vtime" });
                // 顺序重试：先 filter 再 ai
                for (const sub of node.record.subtasks) {
                    await this.runSubtask(node.record.id, sub.id, issues);
                }
            }),
            vscode.commands.registerCommand("issueManager.issueSearch.retrySubtask", async (node?: IssueSearchViewNode) => {
                if (!node || node.type !== "subtask") {
                    vscode.window.showWarningMessage("请在子任务节点上执行重试。");
                    return;
                }
                const issues = await getAllIssueMarkdowns({ sortBy: "vtime" });
                await this.runSubtask(node.recordId, node.subtask.id, issues);
            }),
            vscode.commands.registerCommand("issueManager.issueSearch.deleteTask", async (node?: IssueSearchViewNode) => {
                await this.deleteSearchTask(node);
            }),
            vscode.commands.registerCommand("issueManager.issueSearch.openResult", async (filePath: string) => {
                await this.openResultByFilePath(filePath);
            })
        );
    }

    private async deleteSearchTask(node?: IssueSearchViewNode): Promise<void> {
        if (!node) {
            vscode.window.showWarningMessage("未找到要删除的项目。请在记录或子任务节点上执行删除。");
            return;
        }

        if (node.type === "record") {
            const { record } = node;
            const isPendingTask = this.pendingAiRecords.has(record.id);
            const confirmed = await vscode.window.showWarningMessage(
                `确认删除搜索任务“${record.keyword}”吗？`,
                { modal: true },
                "删除"
            );
            if (confirmed !== "删除") {
                return;
            }

            if (isPendingTask) {
                this.pendingAiRecords.delete(record.id);
                this.refresh();
                vscode.window.showInformationMessage("已删除搜索任务。该 AI 搜索结果将不再写入历史。");
                return;
            }

            const removed = await removeIssueSearchRecord(record.id);
            this.refresh();
            if (removed) {
                vscode.window.showInformationMessage("已删除搜索任务。");
                return;
            }
            vscode.window.showWarningMessage("搜索任务不存在或已被删除。");
            return;
        }

        if (node.type === "subtask") {
            const { recordId, subtask } = node;
            const confirmed = await vscode.window.showWarningMessage(
                `确认删除子任务“${subtask.type}”吗？`,
                { modal: true },
                "删除"
            );
            if (confirmed !== "删除") {
                return;
            }

            // 如果记录在 pending map 中，直接更新
            if (this.pendingAiRecords.has(recordId)) {
                const r = this.pendingAiRecords.get(recordId)!;
                r.subtasks = r.subtasks.filter(s => s.id !== subtask.id);
                if (r.subtasks.length === 0) {
                    this.pendingAiRecords.delete(recordId);
                }
                this.refresh();
                vscode.window.showInformationMessage("已删除子任务（未持久化）。");
                return;
            }

            const data = await readIssueSearchHistory();
            const records = data.records || [];
            const idx = records.findIndex(r => r.id === recordId);
            if (idx === -1) {
                vscode.window.showWarningMessage("未找到对应的记录。");
                return;
            }
            const record = records[idx];
            record.subtasks = record.subtasks.filter(s => s.id !== subtask.id);
            if (record.subtasks.length === 0) {
                // 删除整条记录
                await removeIssueSearchRecord(recordId);
                this.refresh();
                vscode.window.showInformationMessage("已删除子任务并移除整条记录。");
                return;
            }
            await addIssueSearchRecord(record);
            this.refresh();
            vscode.window.showInformationMessage("已删除子任务。");
            return;
        }

        vscode.window.showWarningMessage("仅支持删除记录或子任务。请在相应节点上操作。");
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
        quickPick.placeholder = "请输入搜索关键词并回车 — 将创建一个包含过滤与 AI 子任务的搜索会话";
        quickPick.matchOnDescription = true;
        quickPick.matchOnDetail = false;

        const staticItems = this.buildFilterItems(issues);

        const updateItems = (value: string) => {
            // 仅显示 issue 列表用于选择或允许用户输入关键词回车创建会话
            quickPick.items = [...staticItems];
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
                const typed = normalizeKeyword(quickPick.value);
                const keyword = typed || (selected && selected.payload ? selected.payload.title : "");
                // 统一创建一个总任务（含 filter 与 ai 两个子任务），并立即执行 filter 子任务与异步触发 ai 子任务
                const issueDir = getIssueDir();
                if (!issueDir) {
                    disposeAll();
                    return;
                }

                // 计算标题过滤与摘要过滤的初始结果：优先使用用户输入的 keyword 进行全库过滤；
                // 如果用户未输入 keyword（即 typed 为空），再使用下拉项的选中 payload 作为单条结果
                let titleResults: IssueSearchResult[] = [];
                let summaryResults: IssueSearchResult[] = [];
                if (typed) {
                    const titleMatched = filterIssuesByTitle(issues, keyword);
                    const summaryMatched = filterIssuesBySummary(issues, keyword);
                    titleResults = titleMatched.map(issue => ({ filePath: path.relative(issueDir, issue.uri.fsPath), title: issue.title, briefSummary: getBriefSummary(issue.frontmatter) }));
                    summaryResults = summaryMatched.map(issue => ({ filePath: path.relative(issueDir, issue.uri.fsPath), title: issue.title, briefSummary: getBriefSummary(issue.frontmatter) }));
                } else if (selected && selected.action === "filter" && selected.payload) {
                    const rel = path.relative(issueDir, selected.payload.uri.fsPath);
                    titleResults = [{ filePath: rel, title: selected.payload.title, briefSummary: getBriefSummary(selected.payload.frontmatter) }];
                    summaryResults = [{ filePath: rel, title: selected.payload.title, briefSummary: getBriefSummary(selected.payload.frontmatter) }];
                }

                const titleSubtaskId = `title-${uuidv4()}`;
                const summarySubtaskId = `summary-${uuidv4()}`;
                const aiSubtaskId = `ai-${uuidv4()}`;
                const record: IssueSearchRecord = {
                    id: `search-${uuidv4()}`,
                    keyword,
                    createdAt: Date.now(),
                    subtasks: [
                        { id: titleSubtaskId, type: "title", status: "done", results: titleResults, lastRunAt: Date.now() },
                        { id: summarySubtaskId, type: "summary", status: "done", results: summaryResults, lastRunAt: Date.now() },
                        { id: aiSubtaskId, type: "ai", status: "pending", results: [] }
                    ]
                } as unknown as IssueSearchRecord;

                // 持久化当前记录（filter 已有结果，ai 为 pending）
                await addIssueSearchRecord(record);
                // 在 pending map 中注册该记录以便显示 loading
                this.pendingAiRecords.set(record.id, record);
                this.refresh();

                // 异步触发 AI 子任务
                void this.runSubtask(record.id, aiSubtaskId, issues);
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

    private startAiSearch(keyword: string, issues: IssueMarkdown[]): void {
        if (!keyword) {
            vscode.window.showInformationMessage("请输入搜索关键词后再进行 AI 搜索。");
            return;
        }

        const pendingRecord = createPendingRecord(keyword);
        this.pendingAiRecords.set(pendingRecord.id, pendingRecord);
        // 持久化初始记录（AI 子任务为 pending）
        void addIssueSearchRecord(pendingRecord);
        this.refresh();
        const subtaskId = pendingRecord.subtasks && pendingRecord.subtasks[0] ? pendingRecord.subtasks[0].id : "";
        void this.runSubtask(pendingRecord.id, subtaskId, issues);
    }

    private async handleAiSearch(pendingRecord: IssueSearchRecord, issues: IssueMarkdown[]): Promise<void> {
        const keyword = pendingRecord.keyword;
        const matches = await LLMService.searchIssueMarkdowns(keyword);

        if (!this.pendingAiRecords.has(pendingRecord.id)) {
            return;
        }

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

    private async getRecordById(recordId: string): Promise<IssueSearchRecord | undefined> {
        if (this.pendingAiRecords.has(recordId)) {
            return this.pendingAiRecords.get(recordId);
        }
        const data = await readIssueSearchHistory();
        return (data.records || []).find(r => r.id === recordId);
    }

    private async runSubtask(recordId: string, subtaskId: string, issues: IssueMarkdown[]): Promise<void> {
        const record = await this.getRecordById(recordId);
        if (!record) {
            return;
        }
        const sub = record.subtasks.find(s => s.id === subtaskId);
        if (!sub) {
            return;
        }
        if (sub.status === "running") {
            return;
        }

        sub.status = "running";
        sub.lastRunAt = Date.now();
        this.pendingAiRecords.set(record.id, record);
        this.refresh();

        try {
            if (sub.type === "filter" || sub.type === "title" || sub.type === "summary") {
                const issueDir = getIssueDir();
                if (!issueDir) {
                    sub.status = "failed";
                    sub.error = "未配置 issueDir";
                    await addIssueSearchRecord(record);
                    this.refresh();
                    return;
                }

                let matched: IssueMarkdown[] = [];
                if (sub.type === "filter") {
                    matched = record.keyword ? filterIssuesByKeyword(issues, record.keyword) : [];
                } else if (sub.type === "title") {
                    matched = record.keyword ? filterIssuesByTitle(issues, record.keyword) : [];
                } else if (sub.type === "summary") {
                    matched = record.keyword ? filterIssuesBySummary(issues, record.keyword) : [];
                }

                sub.results = matched.map(issue => ({ filePath: path.relative(issueDir, issue.uri.fsPath), title: issue.title, briefSummary: getBriefSummary(issue.frontmatter) }));
                sub.status = "done";
                sub.lastRunAt = Date.now();
                await addIssueSearchRecord(record);
                // 如果所有子任务都非 running/pending，则从 pending map 移除
                const hasRunningOrPending = record.subtasks.some(s => s.status === "pending" || s.status === "running");
                if (!hasRunningOrPending) {
                    this.pendingAiRecords.delete(record.id);
                }
                this.refresh();
                return;
            }

            if (sub.type === "ai") {
                const matches = await LLMService.searchIssueMarkdowns(record.keyword);
                const issueDir = getIssueDir() || "";
                const issueMap = new Map<string, IssueMarkdown>();
                issues.forEach(issue => issueMap.set(issue.uri.fsPath, issue));

                const results: IssueSearchResult[] = [];
                matches.forEach(match => {
                    const absPath = path.resolve(issueDir, match.filePath);
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
                    results.push({ filePath: relPath, title: issue.title, briefSummary: getBriefSummary(issue.frontmatter) });
                });

                sub.results = results;
                sub.status = results.length > 0 ? "done" : "failed";
                sub.lastRunAt = Date.now();
                if (sub.status === "failed") {
                    sub.error = "AI 未找到匹配项";
                }
                // 持久化并清理 pending map
                await addIssueSearchRecord(record);
                this.pendingAiRecords.delete(record.id);
                this.refresh();
                return;
            }
        } catch (error: any) {
            sub.status = "failed";
            sub.error = error?.message || String(error);
            await addIssueSearchRecord(record);
            this.pendingAiRecords.delete(record.id);
            this.refresh();
            return;
        }
    }

    private async openResultByFilePath(filePath: string): Promise<void> {
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
                return;
            }
            await vscode.window.showTextDocument(uri, { preview: false });
        } catch (error) {
            Logger.getInstance().error("打开搜索结果失败", error);
            vscode.window.showErrorMessage("打开搜索结果失败。");
        }
    }
}
