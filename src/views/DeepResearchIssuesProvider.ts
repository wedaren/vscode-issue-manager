import * as vscode from "vscode";
import {
    getAllIssueMarkdowns,
    type FrontmatterData,
    type IssueMarkdown,
} from "../data/IssueMarkdowns";
import { runDeepResearchFlow } from "../commands/deepResearchIssue";
import type { ResearchOutputKind, ResearchSourceMode } from "../types/deepResearch";
import { promptIncludeEditor, promptKind, promptTopic } from "../utils/deepResearchPrompts";

type DeepResearchGroupKey = ResearchOutputKind | "未分类";

function isResearchOutputKind(value: unknown): value is ResearchOutputKind {
    return (
        value === "调研报告" || value === "技术方案" || value === "对比分析" || value === "学习笔记"
    );
}

function isResearchSourceMode(value: unknown): value is ResearchSourceMode {
    return value === "local" || value === "llmOnly";
}

function isDeepResearch(frontmatter: FrontmatterData | null | undefined): boolean {
    return !!frontmatter && frontmatter.issue_deep_research === true;
}

function getDeepResearchGroupKey(
    frontmatter: FrontmatterData | null | undefined
): DeepResearchGroupKey {
    const kind = frontmatter?.issue_research_kind;
    return isResearchOutputKind(kind) ? kind : "未分类";
}

function formatDocDescription(frontmatter: FrontmatterData | null | undefined): string {
    const topicRaw = frontmatter?.issue_research_topic;
    const topic = typeof topicRaw === "string" ? topicRaw.trim() : "";

    const modeRaw = frontmatter?.issue_research_source_mode;
    const mode = isResearchSourceMode(modeRaw) ? modeRaw : undefined;

    const parts: string[] = [];
    if (mode) {
        parts.push(mode === "local" ? "本地" : "纯LLM");
    }
    if (topic) {
        parts.push(topic);
    }

    return parts.join(" · ");
}

export type DeepResearchViewNode =
    | DeepResearchPendingTaskNode
    | DeepResearchGroupNode
    | DeepResearchDocNode;

interface DeepResearchPendingTask {
    id: string;
    topic: string;
    kind: ResearchOutputKind;
    sourceMode: ResearchSourceMode;
    includeEditor: boolean;
    createdAt: number;
    stageText: string;
    tokenSource: vscode.CancellationTokenSource;
}

export class DeepResearchPendingTaskNode extends vscode.TreeItem {
    public readonly task: DeepResearchPendingTask;

    constructor(task: DeepResearchPendingTask) {
        super(`生成中：${task.topic}`, vscode.TreeItemCollapsibleState.None);
        this.task = task;
        this.description = task.stageText;
        this.contextValue = "deepResearchTaskLoading";
        this.iconPath = new vscode.ThemeIcon("sync~spin");
        this.tooltip = `正在生成深度调研文档\n模式：${
            task.sourceMode === "local" ? "本地笔记" : "纯LLM"
        }\n类型：${task.kind}`;
    }
}

export class DeepResearchGroupNode extends vscode.TreeItem {
    public readonly key: DeepResearchGroupKey;
    public readonly docs: DeepResearchDocMeta[];

    constructor(key: DeepResearchGroupKey, docs: DeepResearchDocMeta[]) {
        super(`${key}（${docs.length}）`, vscode.TreeItemCollapsibleState.Collapsed);
        this.key = key;
        this.docs = docs;
        this.contextValue = "deepResearchGroup";
        this.iconPath = new vscode.ThemeIcon("folder");
    }
}

export interface DeepResearchDocMeta {
    title: string;
    uri: vscode.Uri;
    mtime: number;
    frontmatter: FrontmatterData | null;
}

export class DeepResearchDocNode extends vscode.TreeItem {
    public readonly meta: DeepResearchDocMeta;

    constructor(meta: DeepResearchDocMeta) {
        super(meta.title, vscode.TreeItemCollapsibleState.None);
        this.meta = meta;
        this.resourceUri = meta.uri;
        this.contextValue = "deepResearchDoc";
        this.iconPath = new vscode.ThemeIcon("book");
        this.description = formatDocDescription(meta.frontmatter);
        this.command = {
            command: "vscode.open",
            title: "打开",
            arguments: [meta.uri],
        };
        this.tooltip = meta.uri.fsPath;
    }
}

/**
 * “深度调研问题”视图：专门展示 issueDir 中标记为 `issue_deep_research: true` 的文档。
 * 目标：方便创建、集中管理、持续维护（例如删除、刷新、后续可加重跑等）。
 */
export class DeepResearchIssuesProvider implements vscode.TreeDataProvider<DeepResearchViewNode> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<
        DeepResearchViewNode | undefined | null | void
    >();
    public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private dataCache: { groups: DeepResearchGroupNode[] } | null = null;
    private pendingTasks = new Map<string, DeepResearchPendingTask>();

    constructor(private readonly context: vscode.ExtensionContext) {
        this.registerCommands();

        vscode.workspace.onDidChangeConfiguration(
            e => {
                if (e.affectsConfiguration("issueManager.issueDir")) {
                    this.refresh();
                }
            },
            undefined,
            this.context.subscriptions
        );
    }

    private registerCommands(): void {
        this.context.subscriptions.push(
            vscode.commands.registerCommand("issueManager.deepResearch.refresh", () =>
                this.refresh()
            ),
            vscode.commands.registerCommand("issueManager.deepResearch.addTaskLocal", async () => {
                await this.runCreateTaskFlow("local");
            }),
            vscode.commands.registerCommand(
                "issueManager.deepResearch.addTaskLlmOnly",
                async () => {
                    await this.runCreateTaskFlow("llmOnly");
                }
            ),
            vscode.commands.registerCommand(
                "issueManager.deepResearch.cancelTask",
                async (...args: unknown[]) => {
                    const node = args[0];
                    if (!(node instanceof DeepResearchPendingTaskNode)) {
                        vscode.window.showWarningMessage("取消失败：未选择有效的生成任务节点。");
                        return;
                    }
                    node.task.tokenSource.cancel();
                    this.pendingTasks.delete(node.task.id);
                    this.refresh();
                }
            )
        );
    }

    public refresh(): void {
        this.dataCache = null;
        this._onDidChangeTreeData.fire();
    }

    public getTreeItem(element: DeepResearchViewNode): vscode.TreeItem {
        return element;
    }

    public async getChildren(element?: DeepResearchViewNode): Promise<DeepResearchViewNode[]> {
        if (element instanceof DeepResearchGroupNode) {
            return element.docs.map(d => new DeepResearchDocNode(d));
        }

        const pending = Array.from(this.pendingTasks.values())
            .sort((a, b) => b.createdAt - a.createdAt)
            .map(t => new DeepResearchPendingTaskNode(t));

        const { groups } = await this.getOrLoadData();
        return [...pending, ...groups];
    }

    private async runCreateTaskFlow(sourceMode: ResearchSourceMode): Promise<void> {
        const topic = await promptTopic();
        if (!topic) {
            return;
        }

        const kind = await promptKind();
        if (!kind) {
            return;
        }

        const includeEditor = await promptIncludeEditor();
        if (includeEditor === null) {
            return;
        }

        this.startPendingTask({
            topic,
            kind,
            sourceMode,
            includeEditor,
        });
    }

    private startPendingTask(params: {
        topic: string;
        kind: ResearchOutputKind;
        sourceMode: ResearchSourceMode;
        includeEditor: boolean;
    }): void {
        const id = `deepResearch-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const tokenSource = new vscode.CancellationTokenSource();
        const task: DeepResearchPendingTask = {
            id,
            topic: params.topic,
            kind: params.kind,
            sourceMode: params.sourceMode,
            includeEditor: params.includeEditor,
            createdAt: Date.now(),
            stageText: "准备中...",
            tokenSource,
        };

        this.pendingTasks.set(task.id, task);
        this.refresh();

        const progress: vscode.Progress<{ message?: string; increment?: number }> = {
            report: value => {
                if (!this.pendingTasks.has(task.id)) {
                    return;
                }
                const message = value?.message;
                if (typeof message === "string" && message.trim()) {
                    task.stageText = message.trim();
                    this._onDidChangeTreeData.fire();
                }
            },
        };

        void (async () => {
            try {
                await runDeepResearchFlow({
                    topic: task.topic,
                    kind: task.kind,
                    sourceMode: task.sourceMode,
                    includeEditor: task.includeEditor,
                    progress,
                    token: task.tokenSource.token,
                });
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                vscode.window.showErrorMessage(`深度调研生成失败：${msg}`);
            } finally {
                task.tokenSource.dispose();
                this.pendingTasks.delete(task.id);
                this.refresh();
            }
        })();
    }

    private async getOrLoadData(): Promise<{ groups: DeepResearchGroupNode[] }> {
        if (this.dataCache) {
            return this.dataCache;
        }

        const all = await getAllIssueMarkdowns({ sortBy: "mtime" });
        const deepResearchDocs = all.filter(i => isDeepResearch(i.frontmatter));

        const grouped = this.groupDocs(deepResearchDocs);
        const groups = Array.from(grouped.entries())
            .sort((a, b) => a[0].localeCompare(b[0], "zh-Hans-CN"))
            .map(([key, docs]) => new DeepResearchGroupNode(key, docs));

        this.dataCache = { groups };
        return this.dataCache;
    }

    private groupDocs(items: IssueMarkdown[]): Map<DeepResearchGroupKey, DeepResearchDocMeta[]> {
        const map = new Map<DeepResearchGroupKey, DeepResearchDocMeta[]>();

        for (const item of items) {
            const key = getDeepResearchGroupKey(item.frontmatter);
            const list = map.get(key) ?? [];
            list.push({
                title: item.title,
                uri: item.uri,
                mtime: item.mtime,
                frontmatter: item.frontmatter ?? null,
            });
            map.set(key, list);
        }

        for (const docs of map.values()) {
            docs.sort((a, b) => b.mtime - a.mtime);
        }

        return map;
    }
}
