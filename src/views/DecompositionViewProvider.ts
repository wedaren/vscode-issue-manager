/**
 * 🧩 问题分解任务管理视图
 * 
 * 提供分解任务的可视化管理界面：
 * - 显示所有分解任务记录（带状态和进度）
 * - 支持展开查看子问题
 * - 异步执行分解和创建操作
 * - 支持批量创建和单个创建
 */

import * as vscode from "vscode";
import * as path from "path";
import { getIssueDir } from "../config";
import { createIssueMarkdown } from "../data/IssueMarkdowns";
import { createIssueNodes } from "../data/issueTreeManager";
import { backgroundFillIssue } from "../llm/backgroundFill";
import { Logger } from "../core/utils/Logger";
import { LLMService, DecomposedQuestion } from "../llm/LLMService";
import {
    DecompositionRecord,
    SubQuestionRecord,
    readDecompositionHistory,
    addDecompositionRecord,
    createDecompositionRecord,
    updateDecompositionRecord,
    markSubQuestionCreated,
    setParentIssueCreated,
    deleteDecompositionRecord,
    updateDecompositionStatus,
    CreatedIssueInfo
} from "../data/decompositionHistory";

/** 视图节点类型 */
export type DecompositionViewNode =
    | { type: "record"; record: DecompositionRecord }
    | { type: "subQuestion"; recordId: string; subQuestion: SubQuestionRecord }
    | { type: "info"; recordId: string; label: string; detail: string };

/** 格式化日期 */
function formatDate(timestamp: number): string {
    const d = new Date(timestamp);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hour = String(d.getHours()).padStart(2, "0");
    const minute = String(d.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day} ${hour}:${minute}`;
}

/** 获取状态图标 */
function getStatusIcon(status: DecompositionRecord["status"]): vscode.ThemeIcon {
    switch (status) {
        case "pending":
            return new vscode.ThemeIcon("circle-outline");
        case "processing":
            return new vscode.ThemeIcon("sync~spin");
        case "completed":
            return new vscode.ThemeIcon("check", new vscode.ThemeColor("charts.green"));
        case "partial":
            return new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor("charts.yellow"));
        case "cancelled":
            return new vscode.ThemeIcon("circle-slash", new vscode.ThemeColor("charts.red"));
        default:
            return new vscode.ThemeIcon("circle-outline");
    }
}

/** 获取优先级图标 */
function getPriorityIcon(priority: "P0" | "P1" | "P2"): vscode.ThemeIcon {
    switch (priority) {
        case "P0":
            return new vscode.ThemeIcon("flame", new vscode.ThemeColor("charts.red"));
        case "P1":
            return new vscode.ThemeIcon("star", new vscode.ThemeColor("charts.yellow"));
        case "P2":
            return new vscode.ThemeIcon("bookmark", new vscode.ThemeColor("charts.blue"));
        default:
            return new vscode.ThemeIcon("bookmark");
    }
}

/** 获取优先级描述 */
function getPriorityDescription(priority: "P0" | "P1" | "P2"): string {
    switch (priority) {
        case "P0":
            return "核心基础";
        case "P1":
            return "重要扩展";
        case "P2":
            return "可选深入";
        default:
            return "";
    }
}

/**
 * 分解任务管理视图提供者
 */
export class DecompositionViewProvider implements vscode.TreeDataProvider<DecompositionViewNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<DecompositionViewNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private recordCache: DecompositionRecord[] | null = null;
    private pendingRecords = new Map<string, DecompositionRecord>();
    private processingRecords = new Set<string>();

    constructor(private context: vscode.ExtensionContext) {
        this.registerCommands();
    }

    /**
     * 刷新视图
     */
    refresh(): void {
        this.recordCache = null;
        this._onDidChangeTreeData.fire();
    }

    /**
     * 获取树节点项
     */
    async getTreeItem(element: DecompositionViewNode): Promise<vscode.TreeItem> {
        if (element.type === "record") {
            return this.createRecordTreeItem(element.record);
        }

        if (element.type === "subQuestion") {
            return this.createSubQuestionTreeItem(element.recordId, element.subQuestion);
        }

        if (element.type === "info") {
            const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
            item.description = element.detail;
            item.contextValue = "decompositionInfo";
            return item;
        }

        return new vscode.TreeItem("未知节点");
    }

    /**
     * 创建分解记录树节点
     */
    private createRecordTreeItem(record: DecompositionRecord): vscode.TreeItem {
        const isPending = this.pendingRecords.has(record.id);
        const isProcessing = this.processingRecords.has(record.id);

        const label = record.rootQuestion;
        const createdCount = record.subQuestions.filter(sq => sq.isCreated).length;
        const totalCount = record.subQuestions.length;

        const item = new vscode.TreeItem(
            label,
            vscode.TreeItemCollapsibleState.Collapsed
        );

        // 状态显示
        if (isPending) {
            item.iconPath = new vscode.ThemeIcon("sync~spin");
            item.description = "AI 分解中...";
            item.contextValue = "decompositionRecordPending";
            item.tooltip = "正在使用 AI 分解问题，请稍候...";
        } else if (isProcessing) {
            item.iconPath = new vscode.ThemeIcon("sync~spin");
            item.description = `创建中 (${createdCount}/${totalCount})`;
            item.contextValue = "decompositionRecordProcessing";
            item.tooltip = "正在创建问题文件...";
        } else {
            item.iconPath = getStatusIcon(record.status);
            item.description = `${createdCount}/${totalCount} | ${formatDate(record.createdAt)}`;
            item.contextValue = record.status === "completed" 
                ? "decompositionRecordCompleted" 
                : "decompositionRecord";
            
            // 详细 tooltip
            item.tooltip = new vscode.MarkdownString();
            item.tooltip.appendMarkdown(`### ${record.rootQuestion}\n\n`);
            item.tooltip.appendMarkdown(`**状态**: ${this.getStatusText(record.status)}\n\n`);
            item.tooltip.appendMarkdown(`**进度**: ${record.progress}% (${createdCount}/${totalCount})\n\n`);
            item.tooltip.appendMarkdown(`**预估时间**: ${record.estimatedTotalTime}\n\n`);
            item.tooltip.appendMarkdown(`**创建时间**: ${formatDate(record.createdAt)}\n\n`);
            if (record.overview) {
                item.tooltip.appendMarkdown(`---\n\n${record.overview}`);
            }
        }

        return item;
    }

    /**
     * 创建子问题树节点
     */
    private createSubQuestionTreeItem(recordId: string, sq: SubQuestionRecord): vscode.TreeItem {
        const item = new vscode.TreeItem(
            `[${sq.priority}] ${sq.title}`,
            vscode.TreeItemCollapsibleState.None
        );

        if (sq.isCreated && sq.createdIssue) {
            item.iconPath = new vscode.ThemeIcon("check", new vscode.ThemeColor("charts.green"));
            item.description = "已创建";
            item.contextValue = "decompositionSubQuestionCreated";
            
            // 点击打开已创建的文件
            const issueDir = getIssueDir();
            if (issueDir) {
                const filePath = path.join(issueDir, sq.createdIssue.filePath);
                item.command = {
                    command: "vscode.open",
                    title: "打开问题",
                    arguments: [vscode.Uri.file(filePath)]
                };
            }
        } else {
            item.iconPath = getPriorityIcon(sq.priority);
            item.description = `${getPriorityDescription(sq.priority)} · ${sq.keywords.slice(0, 3).join(", ")}`;
            item.contextValue = "decompositionSubQuestion";
        }

        // tooltip
        item.tooltip = new vscode.MarkdownString();
        item.tooltip.appendMarkdown(`### ${sq.title}\n\n`);
        item.tooltip.appendMarkdown(`**优先级**: ${sq.priority} - ${getPriorityDescription(sq.priority)}\n\n`);
        item.tooltip.appendMarkdown(`**关键词**: ${sq.keywords.join(", ")}\n\n`);
        if (sq.dependencies.length > 0) {
            item.tooltip.appendMarkdown(`**依赖**: #${sq.dependencies.join(", #")}\n\n`);
        }
        item.tooltip.appendMarkdown(`---\n\n${sq.description}`);

        return item;
    }

    /**
     * 获取状态文本
     */
    private getStatusText(status: DecompositionRecord["status"]): string {
        switch (status) {
            case "pending": return "⏳ 待处理";
            case "processing": return "🔄 进行中";
            case "completed": return "✅ 已完成";
            case "partial": return "🟡 部分完成";
            case "cancelled": return "❌ 已取消";
            default: return "未知";
        }
    }

    /**
     * 获取子节点
     */
    async getChildren(element?: DecompositionViewNode): Promise<DecompositionViewNode[]> {
        if (!element) {
            // 根节点：返回所有分解记录
            const records = await this.getRecords();
            return records.map(record => ({ type: "record", record }));
        }

        if (element.type === "record") {
            const record = element.record;
            const children: DecompositionViewNode[] = [];

            // 添加概览信息
            children.push({
                type: "info",
                recordId: record.id,
                label: "📋 概述",
                detail: record.overview.substring(0, 80) + (record.overview.length > 80 ? "..." : "")
            });

            children.push({
                type: "info",
                recordId: record.id,
                label: "⏱️ 预估时间",
                detail: record.estimatedTotalTime
            });

            // 添加子问题（按优先级排序）
            const sortedSubQuestions = [...record.subQuestions].sort((a, b) => {
                const priorityOrder = { P0: 0, P1: 1, P2: 2 };
                return priorityOrder[a.priority] - priorityOrder[b.priority];
            });

            for (const sq of sortedSubQuestions) {
                children.push({
                    type: "subQuestion",
                    recordId: record.id,
                    subQuestion: sq
                });
            }

            return children;
        }

        return [];
    }

    /**
     * 获取所有记录
     */
    private async getRecords(): Promise<DecompositionRecord[]> {
        if (this.recordCache) {
            return this.recordCache;
        }
        const data = await readDecompositionHistory();
        const pending = Array.from(this.pendingRecords.values());
        this.recordCache = [...pending, ...(data.records || [])];
        return this.recordCache;
    }

    /**
     * 注册命令
     */
    private registerCommands(): void {
        this.context.subscriptions.push(
            // 新建分解任务
            vscode.commands.registerCommand(
                "issueManager.decomposition.addTask",
                () => this.runDecomposeFlow()
            ),

            // 刷新视图
            vscode.commands.registerCommand(
                "issueManager.decomposition.refresh",
                () => this.refresh()
            ),

            // 批量创建所有子问题
            vscode.commands.registerCommand(
                "issueManager.decomposition.batchCreate",
                (node: DecompositionViewNode) => this.batchCreateFromRecord(node)
            ),

            // 创建单个子问题
            vscode.commands.registerCommand(
                "issueManager.decomposition.createSubQuestion",
                (node: DecompositionViewNode) => this.createSingleSubQuestion(node)
            ),

            // 删除分解记录
            vscode.commands.registerCommand(
                "issueManager.decomposition.deleteRecord",
                (node: DecompositionViewNode) => this.deleteRecord(node)
            ),

            // 打开父问题
            vscode.commands.registerCommand(
                "issueManager.decomposition.openParent",
                (node: DecompositionViewNode) => this.openParentIssue(node)
            ),

            // 取消分解任务
            vscode.commands.registerCommand(
                "issueManager.decomposition.cancel",
                (node: DecompositionViewNode) => this.cancelRecord(node)
            ),

            // 重新分解
            vscode.commands.registerCommand(
                "issueManager.decomposition.retry",
                (node: DecompositionViewNode) => this.retryDecompose(node)
            ),

            // 从 Chat 结果打开视图（添加记录并聚焦视图）
            vscode.commands.registerCommand(
                "issueManager.decomposition.openViewWithResult",
                (decomposition: DecomposedQuestion) => this.openViewWithResult(decomposition)
            )
        );
    }

    /**
     * 从 Chat 结果打开视图（添加记录并聚焦视图）
     */
    async openViewWithResult(decomposition: DecomposedQuestion): Promise<void> {
        // 添加记录
        const recordId = await this.addDecompositionOnly(decomposition, "chat");
        this.refresh();

        // 聚焦到分解视图
        await vscode.commands.executeCommand("issueManager.views.decomposition.focus");
        
        vscode.window.showInformationMessage(
            `已将分解结果添加到「问题分解」视图，可在此管理和创建子问题`,
            "立即批量创建"
        ).then(async (action) => {
            if (action === "立即批量创建") {
                await this.batchCreateFromRecordId(recordId);
            }
        });
    }

    /**
     * 运行分解流程（类似搜索视图的异步流程）
     */
    async runDecomposeFlow(): Promise<void> {
        const issueDir = getIssueDir();
        if (!issueDir) {
            vscode.window.showErrorMessage('请先配置 "issueManager.issueDir"');
            vscode.commands.executeCommand('workbench.action.openSettings', 'issueManager.issueDir');
            return;
        }

        // 获取用户输入
        const question = await vscode.window.showInputBox({
            prompt: "请输入要分解的复杂问题",
            placeHolder: "例如：如何系统学习 TypeScript？",
            validateInput: (value) => {
                if (!value || value.trim().length < 5) {
                    return "请输入至少 5 个字符的问题描述";
                }
                return null;
            }
        });

        if (!question) {
            return;
        }

        await this.startAiDecompose(question.trim());
    }

    /**
     * 开始 AI 分解（异步）
     */
    async startAiDecompose(question: string): Promise<void> {
        // 创建待处理记录（占位）
        const pendingRecord = createDecompositionRecord(
            {
                rootQuestion: question,
                overview: "正在分析问题...",
                subQuestions: [],
                suggestedPath: "",
                estimatedTotalTime: ""
            },
            "command"
        );
        pendingRecord.status = "processing";

        this.pendingRecords.set(pendingRecord.id, pendingRecord);
        this.refresh();

        try {
            // 调用 LLM 分解
            const result = await LLMService.decomposeQuestion(question);
            
            if (!result) {
                throw new Error("AI 分解返回空结果");
            }

            // 移除待处理记录
            this.pendingRecords.delete(pendingRecord.id);

            // 创建正式记录
            const record = createDecompositionRecord(result, "command");
            await addDecompositionRecord(record);
            this.refresh();

            // 显示成功通知
            const action = await vscode.window.showInformationMessage(
                `✅ 问题已分解为 ${result.subQuestions.length} 个子问题`,
                "批量创建",
                "稍后处理"
            );

            if (action === "批量创建") {
                await this.batchCreateFromRecordId(record.id);
            }

        } catch (error) {
            this.pendingRecords.delete(pendingRecord.id);
            this.refresh();

            Logger.getInstance().error("AI 分解失败", error);
            vscode.window.showErrorMessage(
                `AI 分解失败: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * 从分解结果批量创建问题（供外部调用，如 Chat Participant）
     */
    async addDecompositionAndBatchCreate(decomposition: DecomposedQuestion, source: "chat" | "command" | "quickopen" = "chat"): Promise<void> {
        const record = createDecompositionRecord(decomposition, source);
        await addDecompositionRecord(record);
        this.refresh();

        await this.batchCreateFromRecordId(record.id);
    }

    /**
     * 仅添加分解记录（不立即创建）
     */
    async addDecompositionOnly(decomposition: DecomposedQuestion, source: "chat" | "command" | "quickopen" = "chat"): Promise<string> {
        const record = createDecompositionRecord(decomposition, source);
        await addDecompositionRecord(record);
        this.refresh();
        return record.id;
    }

    /**
     * 从记录批量创建
     */
    private async batchCreateFromRecord(node: DecompositionViewNode): Promise<void> {
        if (node.type !== "record") {
            return;
        }
        await this.batchCreateFromRecordId(node.record.id);
    }

    /**
     * 通过记录ID批量创建
     */
    private async batchCreateFromRecordId(recordId: string): Promise<void> {
        const data = await readDecompositionHistory();
        const record = data.records.find(r => r.id === recordId);
        if (!record) {
            vscode.window.showErrorMessage("找不到分解记录");
            return;
        }

        const issueDir = getIssueDir();
        if (!issueDir) {
            vscode.window.showErrorMessage("请先配置问题目录");
            return;
        }

        // 标记为处理中
        this.processingRecords.add(recordId);
        await updateDecompositionStatus(recordId, "processing");
        this.refresh();

        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: "正在创建问题结构...",
                    cancellable: false
                },
                async (progress) => {
                    // 1. 创建父问题
                    progress.report({ message: "创建父问题..." });

                    const parentContent = this.generateParentMarkdown(record);
                    const parentUri = await createIssueMarkdown({
                        markdownBody: parentContent,
                        frontmatter: { title: record.rootQuestion }
                    });

                    if (!parentUri) {
                        throw new Error("创建父问题失败");
                    }

                    const parentNodes = await createIssueNodes([parentUri]);
                    const parentNodeId = parentNodes?.[0]?.id;

                    if (parentNodeId) {
                        const parentIssue: CreatedIssueInfo = {
                            subQuestionId: -1,
                            title: record.rootQuestion,
                            filePath: path.relative(issueDir, parentUri.fsPath),
                            nodeId: parentNodeId,
                            createdAt: Date.now()
                        };
                        await setParentIssueCreated(recordId, parentIssue);
                    }

                    // 2. 按优先级创建子问题
                    const sortedQuestions = [...record.subQuestions]
                        .filter(sq => !sq.isCreated)
                        .sort((a, b) => {
                            const priorityOrder = { P0: 0, P1: 1, P2: 2 };
                            return priorityOrder[a.priority] - priorityOrder[b.priority];
                        });

                    const total = sortedQuestions.length;
                    for (let i = 0; i < sortedQuestions.length; i++) {
                        const sq = sortedQuestions[i];
                        progress.report({
                            message: `创建子问题 ${i + 1}/${total}: ${sq.title}`,
                            increment: (100 / total)
                        });

                        const childContent = this.generateSubQuestionMarkdown(sq, record);
                        const childUri = await createIssueMarkdown({
                            markdownBody: childContent,
                            frontmatter: {
                                title: sq.title,
                                priority: sq.priority,
                                keywords: sq.keywords
                            }
                        });

                        if (childUri) {
                            const childNodes = await createIssueNodes([childUri], parentNodeId);
                            const childNodeId = childNodes?.[0]?.id;

                            const createdIssue: CreatedIssueInfo = {
                                subQuestionId: sq.id,
                                title: sq.title,
                                filePath: path.relative(issueDir, childUri.fsPath),
                                nodeId: childNodeId,
                                createdAt: Date.now()
                            };

                            await markSubQuestionCreated(recordId, sq.id, createdIssue);

                            // 后台填充内容
                            backgroundFillIssue(
                                childUri,
                                `请详细研究并撰写关于"${sq.title}"的内容。\n\n背景：${sq.description}\n\n建议内容大纲：${sq.suggestedContent}`,
                                childNodeId,
                                { timeoutMs: 60000 }
                            ).catch((err) => {
                                Logger.getInstance().warn(`后台填充子问题失败: ${sq.title}`, err);
                            });
                        }

                        // 每创建一个就刷新视图
                        this.recordCache = null;
                        this._onDidChangeTreeData.fire();
                    }
                }
            );

            // 完成
            this.processingRecords.delete(recordId);
            await updateDecompositionStatus(recordId, "completed");
            this.refresh();

            vscode.commands.executeCommand("issueManager.refreshAllViews");
            vscode.window.showInformationMessage(
                `✅ 已创建 ${record.subQuestions.length + 1} 个问题文件`
            );

        } catch (error) {
            this.processingRecords.delete(recordId);
            await updateDecompositionStatus(recordId, "partial");
            this.refresh();

            Logger.getInstance().error("批量创建失败", error);
            vscode.window.showErrorMessage(
                `批量创建失败: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * 创建单个子问题
     */
    private async createSingleSubQuestion(node: DecompositionViewNode): Promise<void> {
        if (node.type !== "subQuestion") {
            return;
        }

        const { recordId, subQuestion: sq } = node;
        if (sq.isCreated) {
            vscode.window.showInformationMessage("该子问题已创建");
            return;
        }

        const issueDir = getIssueDir();
        if (!issueDir) {
            vscode.window.showErrorMessage("请先配置问题目录");
            return;
        }

        const data = await readDecompositionHistory();
        const record = data.records.find(r => r.id === recordId);
        if (!record) {
            return;
        }

        try {
            const content = this.generateSubQuestionMarkdown(sq, record);
            const uri = await createIssueMarkdown({
                markdownBody: content,
                frontmatter: {
                    title: sq.title,
                    priority: sq.priority,
                    keywords: sq.keywords
                }
            });

            if (uri) {
                // 如果父问题已创建，作为子节点添加
                const parentNodeId = record.parentIssue?.nodeId;
                const nodes = await createIssueNodes([uri], parentNodeId);
                const nodeId = nodes?.[0]?.id;

                const createdIssue: CreatedIssueInfo = {
                    subQuestionId: sq.id,
                    title: sq.title,
                    filePath: path.relative(issueDir, uri.fsPath),
                    nodeId,
                    createdAt: Date.now()
                };

                await markSubQuestionCreated(recordId, sq.id, createdIssue);
                this.refresh();

                const action = await vscode.window.showInformationMessage(
                    `✅ 已创建: ${sq.title}`,
                    "打开",
                    "后台填充内容"
                );

                if (action === "打开") {
                    await vscode.window.showTextDocument(uri);
                } else if (action === "后台填充内容") {
                    backgroundFillIssue(
                        uri,
                        `请详细研究并撰写关于"${sq.title}"的内容。\n\n背景：${sq.description}\n\n建议内容大纲：${sq.suggestedContent}`,
                        nodeId,
                        { timeoutMs: 60000 }
                    );
                    vscode.window.showInformationMessage("已开始后台填充内容");
                }
            }
        } catch (error) {
            Logger.getInstance().error("创建子问题失败", error);
            vscode.window.showErrorMessage(`创建子问题失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 删除分解记录
     */
    private async deleteRecord(node: DecompositionViewNode): Promise<void> {
        if (node.type !== "record") {
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            `确定要删除分解记录 "${node.record.rootQuestion}" 吗？`,
            { modal: true },
            "删除"
        );

        if (confirm === "删除") {
            await deleteDecompositionRecord(node.record.id);
            this.refresh();
            vscode.window.showInformationMessage("已删除分解记录");
        }
    }

    /**
     * 打开父问题
     */
    private async openParentIssue(node: DecompositionViewNode): Promise<void> {
        if (node.type !== "record") {
            return;
        }

        const record = node.record;
        if (!record.parentIssue) {
            vscode.window.showInformationMessage("父问题尚未创建");
            return;
        }

        const issueDir = getIssueDir();
        if (!issueDir) {
            return;
        }

        const filePath = path.join(issueDir, record.parentIssue.filePath);
        await vscode.window.showTextDocument(vscode.Uri.file(filePath));
    }

    /**
     * 取消分解任务
     */
    private async cancelRecord(node: DecompositionViewNode): Promise<void> {
        if (node.type !== "record") {
            return;
        }

        await updateDecompositionStatus(node.record.id, "cancelled");
        this.refresh();
        vscode.window.showInformationMessage("已取消分解任务");
    }

    /**
     * 重新分解
     */
    private async retryDecompose(node: DecompositionViewNode): Promise<void> {
        if (node.type !== "record") {
            return;
        }

        const question = node.record.rootQuestion;
        await deleteDecompositionRecord(node.record.id);
        this.refresh();

        await this.startAiDecompose(question);
    }

    /**
     * 生成父问题 Markdown
     */
    private generateParentMarkdown(record: DecompositionRecord): string {
        const subQuestionsSection = record.subQuestions
            .map((q) => {
                const depStr = q.dependencies.length > 0
                    ? ` (依赖: ${q.dependencies.map(d => `#${d}`).join(", ")})`
                    : "";
                return `- [ ] **[${q.priority}]** ${q.id}. ${q.title}${depStr}`;
            })
            .join("\n");

        return `# ${record.rootQuestion}

## 概述

${record.overview}

## 子问题清单

${subQuestionsSection}

## 建议学习路径

${record.suggestedPath}

## 预估时间

**${record.estimatedTotalTime}**

---

*此问题结构由「问题分解专家」生成*
*生成时间: ${new Date(record.createdAt).toLocaleString("zh-CN")}*
`;
    }

    /**
     * 生成子问题 Markdown
     */
    private generateSubQuestionMarkdown(sq: SubQuestionRecord, record: DecompositionRecord): string {
        const dependenciesSection = sq.dependencies.length > 0
            ? `## 前置依赖

${sq.dependencies.map((depId) => {
    const dep = record.subQuestions.find((q) => q.id === depId);
    return dep ? `- #${depId}: ${dep.title}` : `- #${depId}`;
}).join("\n")}

`
            : "";

        return `# ${sq.title}

## 概述

${sq.description}

## 优先级

**${sq.priority}** - ${getPriorityDescription(sq.priority)}

${dependenciesSection}## 关键词

${sq.keywords.map(k => `- ${k}`).join("\n")}

## 内容大纲

${sq.suggestedContent}

## 笔记

<!-- 在此添加您的研究笔记 -->



---

*此问题由「问题分解专家」生成*
*父问题: ${record.rootQuestion}*
`;
    }
}
