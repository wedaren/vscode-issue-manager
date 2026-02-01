/**
 * 🌐 知识图谱视图提供者
 * 
 * 提供知识图谱的可视化管理界面：
 * - 展示分析历史
 * - 显示发现的知识连接
 * - 管理知识节点和关系
 * - 快速导航到相关文档
 */

import * as vscode from "vscode";
import { Logger } from "../core/utils/Logger";
import { KnowledgeGraphAgent, KnowledgeNode, DiscoveredConnection, KnowledgeIsland } from "../llm/KnowledgeGraphAgent";
import {
    readKnowledgeGraphHistory,
    addKnowledgeGraphReport,
    updateKnowledgeGraphReport,
    deleteKnowledgeGraphReport,
    getKnowledgeGraphSummary,
    PersistedKnowledgeGraphReport,
} from "../data/agentHistory";

// ==================== 类型定义 ====================

/** 视图节点类型 */
export type KnowledgeGraphViewNode =
    | { type: "summary"; summary: ReturnType<typeof getKnowledgeGraphSummary> }
    | { type: "report"; report: PersistedKnowledgeGraphReport }
    | { type: "header"; label: string; icon?: string }
    | { type: "connection"; reportId: string; connection: DiscoveredConnection }
    | { type: "node"; reportId: string; node: KnowledgeNode }
    | { type: "island"; reportId: string; island: KnowledgeIsland }
    | { type: "loading"; message: string }
    | { type: "empty"; message: string };

// ==================== 辅助函数 ====================

const logger = Logger.getInstance();

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

/** 获取连接强度图标 */
function getStrengthIcon(confidence: number): vscode.ThemeIcon {
    if (confidence >= 0.8) {
        return new vscode.ThemeIcon("star-full", new vscode.ThemeColor("charts.yellow"));
    } else if (confidence >= 0.5) {
        return new vscode.ThemeIcon("star-half", new vscode.ThemeColor("charts.orange"));
    } else {
        return new vscode.ThemeIcon("star-empty", new vscode.ThemeColor("charts.gray"));
    }
}

/** 获取连接类型标签 */
function getConnectionTypeLabel(type: string): string {
    const labels: Record<string, string> = {
        "semantic-similar": "🔗 语义相似",
        "concept-overlap": "🔄 概念重叠",
        "causal-relation": "➡️ 因果关系",
        "prerequisite": "📚 前置知识",
        "extension": "🌱 扩展延伸",
        "contradiction": "⚡ 矛盾对立",
        "example-of": "📝 举例说明",
        "part-of": "🧩 组成部分",
    };
    return labels[type] || `🔗 ${type}`;
}

// ==================== 视图提供者 ====================

export class KnowledgeGraphViewProvider implements vscode.TreeDataProvider<KnowledgeGraphViewNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<KnowledgeGraphViewNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private agent: KnowledgeGraphAgent;
    private isAnalyzing = false;
    private currentProgress = "";
    private expandedReports = new Set<string>();
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.agent = new KnowledgeGraphAgent();
    }

    /**
     * 创建并注册视图
     */
    static register(context: vscode.ExtensionContext): KnowledgeGraphViewProvider {
        const provider = new KnowledgeGraphViewProvider(context);

        // 注册树视图
        const treeView = vscode.window.createTreeView("issueManager.views.knowledgeGraph", {
            treeDataProvider: provider,
            showCollapseAll: true,
        });
        context.subscriptions.push(treeView);

        // 注册命令
        context.subscriptions.push(...provider.registerCommands());

        return provider;
    }

    /**
     * 注册命令
     */
    private registerCommands(): vscode.Disposable[] {
        return [
            // 运行分析
            vscode.commands.registerCommand("issueManager.knowledgeGraph.analyze", () =>
                this.runAnalysis()
            ),

            // 刷新视图
            vscode.commands.registerCommand("issueManager.knowledgeGraph.refresh", () =>
                this.refresh()
            ),

            // 切换收藏
            vscode.commands.registerCommand("issueManager.knowledgeGraph.toggleStar", (node: KnowledgeGraphViewNode) =>
                this.toggleStar(node)
            ),

            // 删除报告
            vscode.commands.registerCommand("issueManager.knowledgeGraph.deleteReport", (node: KnowledgeGraphViewNode) =>
                this.deleteReport(node)
            ),

            // 查看连接详情
            vscode.commands.registerCommand("issueManager.knowledgeGraph.viewConnection", (node: KnowledgeGraphViewNode) =>
                this.viewConnection(node)
            ),

            // 跳转到源文档
            vscode.commands.registerCommand("issueManager.knowledgeGraph.goToSource", (node: KnowledgeGraphViewNode) =>
                this.goToSource(node)
            ),

            // 导出报告
            vscode.commands.registerCommand("issueManager.knowledgeGraph.exportReport", (node: KnowledgeGraphViewNode) =>
                this.exportReport(node)
            ),

            // 从连接创建问题
            vscode.commands.registerCommand("issueManager.knowledgeGraph.createIssueFromConnection", (node: KnowledgeGraphViewNode) =>
                this.createIssueFromConnection(node)
            ),
        ];
    }

    /**
     * 运行知识图谱分析
     */
    private async runAnalysis(): Promise<void> {
        if (this.isAnalyzing) {
            vscode.window.showWarningMessage("知识图谱分析正在进行中...");
            return;
        }

        this.isAnalyzing = true;
        this.refresh();

        try {
            // 设置进度回调
            this.agent.onProgress = (state, message) => {
                this.currentProgress = `${state.phase}: ${message}`;
                this.refresh();
            };

            // 运行分析
            const report = await this.agent.analyze();

            // 保存报告
            const persisted = addKnowledgeGraphReport(report);

            vscode.window.showInformationMessage(
                `✨ 知识图谱分析完成！发现 ${report.discoveredConnections.length} 个连接，${report.nodes.length} 个节点`
            );

            // 展开新报告
            this.expandedReports.add(persisted.id);

        } catch (error) {
            logger.warn("知识图谱分析失败", error);
            vscode.window.showErrorMessage(`知识图谱分析失败: ${error}`);
        } finally {
            this.isAnalyzing = false;
            this.currentProgress = "";
            this.refresh();
        }
    }

    /**
     * 刷新视图
     */
    public refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * 切换收藏状态
     */
    private toggleStar(node: KnowledgeGraphViewNode): void {
        if (node.type !== "report") {
            return;
        }
        
        updateKnowledgeGraphReport(node.report.id, {
            starred: !node.report.starred,
        });
        this.refresh();
    }

    /**
     * 删除报告
     */
    private async deleteReport(node: KnowledgeGraphViewNode): Promise<void> {
        if (node.type !== "report") {
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            `确定要删除这份知识图谱报告吗？`,
            { modal: true },
            "删除"
        );

        if (confirm === "删除") {
            deleteKnowledgeGraphReport(node.report.id);
            this.refresh();
        }
    }

    /**
     * 查看连接详情
     */
    private async viewConnection(node: KnowledgeGraphViewNode): Promise<void> {
        if (node.type !== "connection") {
            return;
        }

        const connection = node.connection;
        const doc = await vscode.workspace.openTextDocument({
            content: `# 知识连接详情\n\n` +
                `## ${connection.sourceNode.title} ↔️ ${connection.targetNode.title}\n\n` +
                `**连接类型**: ${getConnectionTypeLabel(connection.relationshipType)}\n\n` +
                `**置信度**: ${(connection.confidence * 100).toFixed(0)}%\n\n` +
                `**AI 解释**:\n${connection.explanation}\n\n` +
                `**共享概念**:\n${connection.sharedConcepts.map(c => `- ${c}`).join("\n") || "暂无"}\n\n` +
                `**建议链接文本**: ${connection.suggestedLinkText || "暂无"}`,
            language: "markdown",
        });
        await vscode.window.showTextDocument(doc);
    }

    /**
     * 跳转到源文档
     */
    private async goToSource(node: KnowledgeGraphViewNode): Promise<void> {
        let filePath: string | undefined;

        if (node.type === "node") {
            filePath = node.node.filePath;
        } else if (node.type === "connection") {
            filePath = node.connection.sourceNode.filePath;
        }

        if (filePath) {
            try {
                const uri = vscode.Uri.file(filePath);
                const doc = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(doc);
            } catch (error) {
                vscode.window.showErrorMessage(`无法打开文件: ${filePath}`);
            }
        }
    }

    /**
     * 导出报告
     */
    private async exportReport(node: KnowledgeGraphViewNode): Promise<void> {
        if (node.type !== "report") {
            return;
        }

        const report = node.report;
        const content = this.generateReportMarkdown(report);

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`knowledge-graph-${formatDate(report.timestamp).replace(/[: ]/g, "-")}.md`),
            filters: { "Markdown": ["md"] },
        });

        if (uri) {
            await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));
            vscode.window.showInformationMessage(`报告已导出到 ${uri.fsPath}`);
        }
    }

    /**
     * 生成报告 Markdown
     */
    private generateReportMarkdown(report: PersistedKnowledgeGraphReport): string {
        let md = `# 知识图谱分析报告\n\n`;
        md += `**分析时间**: ${formatDate(report.timestamp)}\n\n`;
        md += `**节点数量**: ${report.nodes.length}\n\n`;
        md += `**连接数量**: ${report.discoveredConnections.length}\n\n`;

        md += `## 📊 摘要\n\n`;
        md += `- 总节点数: ${report.summary.totalNodes}\n`;
        md += `- 已有连接: ${report.summary.existingConnections}\n`;
        md += `- 发现连接: ${report.summary.discoveredConnections}\n`;
        md += `- 知识孤岛: ${report.summary.knowledgeIslands}\n`;
        md += `- 覆盖度: ${report.summary.coverageScore}%\n`;
        md += `- 内聚度: ${report.summary.cohesionScore}%\n\n`;

        md += `## 🔗 发现的连接\n\n`;
        for (const conn of report.discoveredConnections) {
            md += `### ${conn.sourceNode.title} ↔️ ${conn.targetNode.title}\n\n`;
            md += `- **类型**: ${getConnectionTypeLabel(conn.relationshipType)}\n`;
            md += `- **置信度**: ${(conn.confidence * 100).toFixed(0)}%\n`;
            md += `- **解释**: ${conn.explanation}\n\n`;
        }

        if (report.knowledgeIslands.length > 0) {
            md += `## 🏝️ 知识孤岛\n\n`;
            for (const island of report.knowledgeIslands) {
                md += `### ${island.theme}\n\n`;
                md += `**原因**: ${island.isolationReason}\n\n`;
                md += `**建议**: ${island.integrationSuggestion}\n\n`;
            }
        }

        return md;
    }

    /**
     * 从连接创建问题
     */
    private async createIssueFromConnection(node: KnowledgeGraphViewNode): Promise<void> {
        if (node.type !== "connection") {
            return;
        }

        const conn = node.connection;
        const title = `探索知识连接: ${conn.sourceNode.title} ↔️ ${conn.targetNode.title}`;
        const content = `## 知识连接待探索\n\n` +
            `**连接类型**: ${getConnectionTypeLabel(conn.relationshipType)}\n\n` +
            `**AI 解释**:\n${conn.explanation}\n\n` +
            `**共享概念**: ${conn.sharedConcepts.join(", ") || "暂无"}\n\n` +
            `## 待办事项\n\n- [ ] 验证连接有效性\n- [ ] 补充相关内容\n- [ ] 创建链接`;

        // 使用 VS Code 命令创建问题
        await vscode.commands.executeCommand("issueManager.recordContent", {
            content: `# ${title}\n\n${content}`,
        });
    }

    // ==================== TreeDataProvider 实现 ====================

    getTreeItem(element: KnowledgeGraphViewNode): vscode.TreeItem {
        switch (element.type) {
            case "summary":
                return this.createSummaryItem(element);
            case "report":
                return this.createReportItem(element);
            case "header":
                return this.createHeaderItem(element);
            case "connection":
                return this.createConnectionItem(element);
            case "node":
                return this.createNodeItem(element);
            case "island":
                return this.createIslandItem(element);
            case "loading":
                return this.createLoadingItem(element);
            case "empty":
                return this.createEmptyItem(element);
            default:
                return new vscode.TreeItem("Unknown");
        }
    }

    async getChildren(element?: KnowledgeGraphViewNode): Promise<KnowledgeGraphViewNode[]> {
        if (!element) {
            return this.getRootChildren();
        }

        switch (element.type) {
            case "report":
                return this.getReportChildren(element.report);
            default:
                return [];
        }
    }

    private getRootChildren(): KnowledgeGraphViewNode[] {
        const nodes: KnowledgeGraphViewNode[] = [];

        // 加载状态
        if (this.isAnalyzing) {
            nodes.push({ type: "loading", message: this.currentProgress || "正在分析知识图谱..." });
            return nodes;
        }

        // 统计摘要
        const summary = getKnowledgeGraphSummary();
        if (summary.totalReports > 0) {
            nodes.push({ type: "summary", summary });
        }

        // 历史报告
        const history = readKnowledgeGraphHistory();
        if (history.reports.length === 0) {
            nodes.push({
                type: "empty",
                message: "暂无分析记录。点击上方 ▶️ 开始知识图谱分析！",
            });
        } else {
            for (const report of history.reports.slice(0, 20)) {
                nodes.push({ type: "report", report });
            }
        }

        return nodes;
    }

    private getReportChildren(report: PersistedKnowledgeGraphReport): KnowledgeGraphViewNode[] {
        const nodes: KnowledgeGraphViewNode[] = [];

        // 强连接
        const strongConnections = report.discoveredConnections.filter(c => c.confidence >= 0.7);
        if (strongConnections.length > 0) {
            nodes.push({ type: "header", label: `⭐ 强连接 (${strongConnections.length})`, icon: "star" });
            for (const conn of strongConnections.slice(0, 10)) {
                nodes.push({ type: "connection", reportId: report.id, connection: conn });
            }
        }

        // 普通连接
        const normalConnections = report.discoveredConnections.filter(c => c.confidence < 0.7);
        if (normalConnections.length > 0) {
            nodes.push({ type: "header", label: `🔗 其他连接 (${normalConnections.length})`, icon: "link" });
            for (const conn of normalConnections.slice(0, 10)) {
                nodes.push({ type: "connection", reportId: report.id, connection: conn });
            }
        }

        // 知识孤岛
        if (report.knowledgeIslands.length > 0) {
            nodes.push({ type: "header", label: `🏝️ 知识孤岛 (${report.knowledgeIslands.length})`, icon: "warning" });
            for (const island of report.knowledgeIslands) {
                nodes.push({ type: "island", reportId: report.id, island });
            }
        }

        return nodes;
    }

    // ==================== TreeItem 创建方法 ====================

    private createSummaryItem(element: { type: "summary"; summary: ReturnType<typeof getKnowledgeGraphSummary> }): vscode.TreeItem {
        const s = element.summary;
        const item = new vscode.TreeItem(
            `📊 共 ${s.totalReports} 次分析，${s.totalConnections} 个连接`,
            vscode.TreeItemCollapsibleState.None
        );
        item.description = `${s.totalNodes} 个节点`;
        item.tooltip = new vscode.MarkdownString(
            `### 知识图谱统计\n\n` +
            `- 分析次数: **${s.totalReports}**\n` +
            `- 收藏报告: **${s.starredReports}**\n` +
            `- 总连接数: **${s.totalConnections}**\n` +
            `- 总节点数: **${s.totalNodes}**`
        );
        item.contextValue = "knowledgeGraph.summary";
        return item;
    }

    private createReportItem(element: { type: "report"; report: PersistedKnowledgeGraphReport }): vscode.TreeItem {
        const r = element.report;
        const item = new vscode.TreeItem(
            `${r.starred ? "⭐ " : ""}${formatDate(r.timestamp)}`,
            this.expandedReports.has(r.id)
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.Collapsed
        );

        item.description = `${r.discoveredConnections.length} 连接 · ${r.nodes.length} 节点`;
        item.iconPath = new vscode.ThemeIcon("graph", new vscode.ThemeColor("charts.purple"));
        item.tooltip = new vscode.MarkdownString(
            `### 分析报告\n\n` +
            `**时间**: ${formatDate(r.timestamp)}\n\n` +
            `**连接**: ${r.discoveredConnections.length}\n\n` +
            `**节点**: ${r.nodes.length}\n\n` +
            `**覆盖度**: ${r.summary.coverageScore}%\n\n` +
            `**内聚度**: ${r.summary.cohesionScore}%`
        );
        item.contextValue = r.starred ? "knowledgeGraph.report.starred" : "knowledgeGraph.report";
        return item;
    }

    private createHeaderItem(element: { type: "header"; label: string; icon?: string }): vscode.TreeItem {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        item.contextValue = "knowledgeGraph.header";
        return item;
    }

    private createConnectionItem(element: { type: "connection"; reportId: string; connection: DiscoveredConnection }): vscode.TreeItem {
        const c = element.connection;
        
        const item = new vscode.TreeItem(
            `${c.sourceNode.title} ↔️ ${c.targetNode.title}`,
            vscode.TreeItemCollapsibleState.None
        );
        item.description = `${(c.confidence * 100).toFixed(0)}%`;
        item.iconPath = getStrengthIcon(c.confidence);
        item.tooltip = new vscode.MarkdownString(
            `### ${getConnectionTypeLabel(c.relationshipType)}\n\n` +
            `**置信度**: ${(c.confidence * 100).toFixed(0)}%\n\n` +
            `**解释**: ${c.explanation}\n\n` +
            `**共享概念**: ${c.sharedConcepts.join(", ") || "暂无"}`
        );
        item.contextValue = "knowledgeGraph.connection";
        item.command = {
            command: "issueManager.knowledgeGraph.viewConnection",
            title: "查看详情",
            arguments: [element],
        };
        return item;
    }

    private createNodeItem(element: { type: "node"; reportId: string; node: KnowledgeNode }): vscode.TreeItem {
        const n = element.node;
        const item = new vscode.TreeItem(
            n.title,
            vscode.TreeItemCollapsibleState.None
        );
        item.description = n.concepts.slice(0, 3).join(", ");
        item.iconPath = new vscode.ThemeIcon("file-text");
        item.tooltip = new vscode.MarkdownString(
            `### ${n.title}\n\n` +
            `**概念**: ${n.concepts.join(", ")}\n\n` +
            `**关键词**: ${n.keywords.join(", ")}`
        );
        item.contextValue = "knowledgeGraph.node";
        item.command = {
            command: "issueManager.knowledgeGraph.goToSource",
            title: "打开文档",
            arguments: [element],
        };
        return item;
    }

    private createIslandItem(element: { type: "island"; reportId: string; island: KnowledgeIsland }): vscode.TreeItem {
        const i = element.island;
        const item = new vscode.TreeItem(
            `🏝️ ${i.theme}`,
            vscode.TreeItemCollapsibleState.None
        );
        item.description = `${i.nodes.length} 个节点`;
        item.iconPath = new vscode.ThemeIcon("warning", new vscode.ThemeColor("editorWarning.foreground"));
        item.tooltip = new vscode.MarkdownString(
            `### 知识孤岛: ${i.theme}\n\n` +
            `**原因**: ${i.isolationReason}\n\n` +
            `**建议**: ${i.integrationSuggestion}`
        );
        item.contextValue = "knowledgeGraph.island";
        return item;
    }

    private createLoadingItem(element: { type: "loading"; message: string }): vscode.TreeItem {
        const item = new vscode.TreeItem(element.message, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon("loading~spin");
        return item;
    }

    private createEmptyItem(element: { type: "empty"; message: string }): vscode.TreeItem {
        const item = new vscode.TreeItem(element.message, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon("info");
        return item;
    }
}
