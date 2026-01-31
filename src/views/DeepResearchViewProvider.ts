import * as vscode from "vscode";
import * as path from "path";
import { 
    readDeepResearchHistory, 
    DeepResearchDocument, 
    DeepResearchTask,
    DeepResearchTaskStatus 
} from "../data/deepResearchManager";
import { Logger } from "../core/utils/Logger";

/**
 * 深度调研视图节点类型
 */
export type DeepResearchViewNode =
    | { type: "document"; document: DeepResearchDocument }
    | { type: "task"; task: DeepResearchTask };

/**
 * 深度调研文档树节点
 */
class DeepResearchDocumentTreeItem extends vscode.TreeItem {
    constructor(public readonly document: DeepResearchDocument) {
        super(document.topic, vscode.TreeItemCollapsibleState.None);
        
        this.tooltip = `调研主题: ${document.topic}\n创建时间: ${new Date(document.createdAt).toLocaleString()}\n模式: ${this.getModeLabel(document.mode)}`;
        this.description = new Date(document.createdAt).toLocaleDateString();
        this.contextValue = "deepResearchDoc";
        this.iconPath = new vscode.ThemeIcon("file-text");
        
        // 点击打开文档
        this.command = {
            command: "vscode.open",
            title: "打开深度调研文档",
            arguments: [vscode.Uri.file(document.filePath)]
        };
    }

    private getModeLabel(mode: string): string {
        switch (mode) {
            case "auto": return "自动";
            case "local": return "本地笔记";
            case "llmOnly": return "纯 LLM";
            default: return mode;
        }
    }
}

/**
 * 深度调研任务树节点
 */
class DeepResearchTaskTreeItem extends vscode.TreeItem {
    constructor(public readonly task: DeepResearchTask) {
        super(task.topic, vscode.TreeItemCollapsibleState.None);
        
        this.tooltip = this.getTooltip();
        this.description = this.getDescription();
        this.contextValue = this.getContextValue();
        this.iconPath = this.getIcon();
    }

    private getTooltip(): string {
        const lines = [
            `调研主题: ${this.task.topic}`,
            `状态: ${this.getStatusLabel()}`,
            `模式: ${this.getModeLabel()}`,
            `创建时间: ${new Date(this.task.createdAt).toLocaleString()}`
        ];
        
        if (this.task.error) {
            lines.push(`错误: ${this.task.error}`);
        }
        
        return lines.join("\n");
    }

    private getDescription(): string {
        return this.getStatusLabel();
    }

    private getContextValue(): string {
        if (this.task.status === "running") {
            return "deepResearchTaskLoading";
        }
        return "deepResearchTask";
    }

    private getIcon(): vscode.ThemeIcon {
        switch (this.task.status) {
            case "pending":
                return new vscode.ThemeIcon("clock");
            case "running":
                return new vscode.ThemeIcon("loading~spin");
            case "completed":
                return new vscode.ThemeIcon("check");
            case "failed":
                return new vscode.ThemeIcon("error");
            case "cancelled":
                return new vscode.ThemeIcon("debug-stop");
            default:
                return new vscode.ThemeIcon("question");
        }
    }

    private getStatusLabel(): string {
        switch (this.task.status) {
            case "pending": return "等待中";
            case "running": return "调研中...";
            case "completed": return "已完成";
            case "failed": return "失败";
            case "cancelled": return "已取消";
            default: return this.task.status;
        }
    }

    private getModeLabel(): string {
        switch (this.task.mode) {
            case "auto": return "自动";
            case "local": return "本地笔记";
            case "llmOnly": return "纯 LLM";
            default: return this.task.mode;
        }
    }
}

/**
 * 深度调研视图提供器
 */
export class DeepResearchViewProvider implements vscode.TreeDataProvider<DeepResearchViewNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<DeepResearchViewNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private documentCache: DeepResearchDocument[] | null = null;
    private activeTasks: Map<string, DeepResearchTask> = new Map();

    constructor(private context: vscode.ExtensionContext) {
        this.registerCommands();
    }

    private registerCommands(): void {
        this.context.subscriptions.push(
            vscode.commands.registerCommand("issueManager.deepResearch.refresh", () => {
                this.refresh();
            })
        );
    }

    /**
     * 刷新视图
     */
    refresh(): void {
        this.documentCache = null;
        this._onDidChangeTreeData.fire();
    }

    /**
     * 添加活动任务
     */
    addActiveTask(task: DeepResearchTask): void {
        this.activeTasks.set(task.id, task);
        this.refresh();
    }

    /**
     * 更新任务状态
     */
    updateTaskStatus(taskId: string, status: DeepResearchTaskStatus, error?: string): void {
        const task = this.activeTasks.get(taskId);
        if (task) {
            task.status = status;
            task.updatedAt = Date.now();
            if (error) {
                task.error = error;
            }
            this.refresh();
        }
    }

    /**
     * 完成任务
     */
    completeTask(taskId: string): void {
        const task = this.activeTasks.get(taskId);
        if (task) {
            task.status = "completed";
            task.updatedAt = Date.now();
            // 完成的任务保留一段时间后自动移除
            setTimeout(() => {
                this.activeTasks.delete(taskId);
                this.refresh();
            }, 5000); // 5秒后移除
            this.refresh();
        }
    }

    /**
     * 取消任务
     */
    cancelTask(taskId: string): void {
        const task = this.activeTasks.get(taskId);
        if (task) {
            if (task.abortController) {
                task.abortController.abort();
            }
            task.status = "cancelled";
            task.updatedAt = Date.now();
            setTimeout(() => {
                this.activeTasks.delete(taskId);
                this.refresh();
            }, 3000); // 3秒后移除
            this.refresh();
        }
    }

    /**
     * 移除任务
     */
    removeTask(taskId: string): void {
        this.activeTasks.delete(taskId);
        this.refresh();
    }

    /**
     * 获取树节点
     */
    getTreeItem(element: DeepResearchViewNode): vscode.TreeItem {
        if (element.type === "document") {
            return new DeepResearchDocumentTreeItem(element.document);
        } else {
            return new DeepResearchTaskTreeItem(element.task);
        }
    }

    /**
     * 获取子节点
     */
    async getChildren(element?: DeepResearchViewNode): Promise<DeepResearchViewNode[]> {
        if (element) {
            return [];
        }

        const nodes: DeepResearchViewNode[] = [];

        // 添加活动任务
        const tasks = Array.from(this.activeTasks.values())
            .sort((a, b) => b.createdAt - a.createdAt);
        for (const task of tasks) {
            nodes.push({ type: "task", task });
        }

        // 添加历史文档
        if (!this.documentCache) {
            try {
                const history = await readDeepResearchHistory();
                this.documentCache = history.documents;
            } catch (error) {
                Logger.getInstance().error("加载深度调研历史失败", error);
                this.documentCache = [];
            }
        }

        for (const document of this.documentCache) {
            nodes.push({ type: "document", document });
        }

        return nodes;
    }
}
