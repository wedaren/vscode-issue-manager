/**
 * 🔍 代码审阅视图提供者
 * 
 * 提供代码审阅的可视化管理界面：
 * - 展示审阅历史
 * - 显示发现的问题和建议
 * - 支持问题状态管理
 * - 快速创建问题文档
 * - 一键跳转到代码位置
 */

import * as vscode from "vscode";
import * as path from "path";
import { Logger } from "../core/utils/Logger";
import {
    CodeReviewAgent,
    CodeReviewReport,
    CodeFinding,
    AgentState,
    AgentThought,
    IssueSeverity,
    IssueCategory,
} from "../llm/CodeReviewAgent";
import {
    readCodeReviewHistory,
    addCodeReviewRecord,
    updateFindingStatus,
    linkFindingToIssue,
    getCodeReviewRecord,
    deleteCodeReviewRecord,
    getCodeReviewSummary,
    PersistedReviewRecord,
    PersistedFinding,
    FindingStatus,
} from "../data/codeReviewHistory";
import { createIssueMarkdown } from "../data/IssueMarkdowns";

// ==================== 类型定义 ====================

/** 视图节点类型 */
export type CodeReviewViewNode =
    | { type: "header"; label: string; detail?: string }
    | { type: "summary"; summary: ReturnType<typeof getCodeReviewSummary> }
    | { type: "review"; record: PersistedReviewRecord }
    | { type: "finding"; reviewId: string; finding: PersistedFinding }
    | { type: "actionItem"; reviewId: string; action: string; priority: "immediate" | "shortTerm" | "longTerm" }
    | { type: "insight"; reviewId: string; insight: string }
    | { type: "agentThought"; reviewId: string; thought: AgentThought }
    | { type: "loading"; message: string }
    | { type: "empty"; message: string };

// ==================== 辅助函数 ====================

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

/** 格式化持续时间 */
function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${Math.round(ms / 1000)}秒`;
    return `${Math.round(ms / 60000)}分钟`;
}

/** 获取严重程度图标 */
function getSeverityIcon(severity: IssueSeverity): vscode.ThemeIcon {
    switch (severity) {
        case "critical":
            return new vscode.ThemeIcon("error", new vscode.ThemeColor("errorForeground"));
        case "major":
            return new vscode.ThemeIcon("warning", new vscode.ThemeColor("editorWarning.foreground"));
        case "minor":
            return new vscode.ThemeIcon("info", new vscode.ThemeColor("editorInfo.foreground"));
        case "suggestion":
            return new vscode.ThemeIcon("lightbulb", new vscode.ThemeColor("charts.blue"));
        default:
            return new vscode.ThemeIcon("circle-outline");
    }
}

/** 获取严重程度标签 */
function getSeverityLabel(severity: IssueSeverity): string {
    switch (severity) {
        case "critical": return "🔴 严重";
        case "major": return "🟠 重要";
        case "minor": return "🟡 次要";
        case "suggestion": return "💡 建议";
        default: return severity;
    }
}

/** 获取类别标签 */
function getCategoryLabel(category: IssueCategory): string {
    const labels: Record<IssueCategory, string> = {
        "security": "🔒 安全",
        "performance": "⚡ 性能",
        "maintainability": "🔧 可维护性",
        "reliability": "🛡️ 可靠性",
        "architecture": "🏗️ 架构",
        "best-practice": "✨ 最佳实践",
        "documentation": "📝 文档",
        "testing": "🧪 测试",
        "type-safety": "📐 类型安全",
    };
    return labels[category] || category;
}

/** 获取状态图标 */
function getStatusIcon(status: FindingStatus): vscode.ThemeIcon {
    switch (status) {
        case "open":
            return new vscode.ThemeIcon("circle-outline");
        case "fixed":
            return new vscode.ThemeIcon("check", new vscode.ThemeColor("charts.green"));
        case "wont-fix":
            return new vscode.ThemeIcon("circle-slash");
        case "false-positive":
            return new vscode.ThemeIcon("x");
        default:
            return new vscode.ThemeIcon("circle-outline");
    }
}

/** 获取风险等级图标 */
function getRiskIcon(risk: "low" | "medium" | "high"): vscode.ThemeIcon {
    switch (risk) {
        case "high":
            return new vscode.ThemeIcon("flame", new vscode.ThemeColor("errorForeground"));
        case "medium":
            return new vscode.ThemeIcon("warning", new vscode.ThemeColor("editorWarning.foreground"));
        case "low":
            return new vscode.ThemeIcon("shield", new vscode.ThemeColor("charts.green"));
        default:
            return new vscode.ThemeIcon("question");
    }
}

// ==================== 视图提供者 ====================

/**
 * 代码审阅视图提供者
 */
export class CodeReviewViewProvider implements vscode.TreeDataProvider<CodeReviewViewNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<CodeReviewViewNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private currentAgent: CodeReviewAgent | null = null;
    private isReviewing = false;
    private currentProgress: string = "";
    private expandedReviews = new Set<string>();

    constructor(private context: vscode.ExtensionContext) {}

    /**
     * 注册命令
     */
    public registerCommands(): vscode.Disposable[] {
        return [
            // 开始审阅
            vscode.commands.registerCommand("issueManager.codeReview.start", () => this.startReview()),
            vscode.commands.registerCommand("issueManager.codeReview.startFolder", (uri: vscode.Uri) => 
                this.startReview({ type: "folder", paths: [uri.fsPath] })
            ),
            vscode.commands.registerCommand("issueManager.codeReview.startFile", (uri: vscode.Uri) => 
                this.startReview({ type: "files", paths: [uri.fsPath] })
            ),
            vscode.commands.registerCommand("issueManager.codeReview.startDiff", () => 
                this.startReview({ type: "diff", paths: [] })
            ),

            // 取消审阅
            vscode.commands.registerCommand("issueManager.codeReview.cancel", () => this.cancelReview()),

            // 刷新视图
            vscode.commands.registerCommand("issueManager.codeReview.refresh", () => this.refresh()),

            // 发现操作
            vscode.commands.registerCommand("issueManager.codeReview.markFixed", (node: CodeReviewViewNode) => 
                this.updateFindingStatus(node, "fixed")
            ),
            vscode.commands.registerCommand("issueManager.codeReview.markWontFix", (node: CodeReviewViewNode) => 
                this.updateFindingStatus(node, "wont-fix")
            ),
            vscode.commands.registerCommand("issueManager.codeReview.markFalsePositive", (node: CodeReviewViewNode) => 
                this.updateFindingStatus(node, "false-positive")
            ),
            vscode.commands.registerCommand("issueManager.codeReview.reopen", (node: CodeReviewViewNode) => 
                this.updateFindingStatus(node, "open")
            ),

            // 创建问题
            vscode.commands.registerCommand("issueManager.codeReview.createIssue", (node: CodeReviewViewNode) => 
                this.createIssueFromFinding(node)
            ),

            // 跳转到代码
            vscode.commands.registerCommand("issueManager.codeReview.goToCode", (node: CodeReviewViewNode) => 
                this.goToCode(node)
            ),

            // 删除审阅
            vscode.commands.registerCommand("issueManager.codeReview.deleteReview", (node: CodeReviewViewNode) => 
                this.deleteReview(node)
            ),

            // 展开/折叠
            vscode.commands.registerCommand("issueManager.codeReview.toggleExpand", (node: CodeReviewViewNode) => 
                this.toggleExpand(node)
            ),
        ];
    }

    /**
     * 刷新视图
     */
    public refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * 获取树项
     */
    getTreeItem(element: CodeReviewViewNode): vscode.TreeItem {
        switch (element.type) {
            case "header":
                return this.createHeaderItem(element);
            case "summary":
                return this.createSummaryItem(element);
            case "review":
                return this.createReviewItem(element);
            case "finding":
                return this.createFindingItem(element);
            case "actionItem":
                return this.createActionItem(element);
            case "insight":
                return this.createInsightItem(element);
            case "agentThought":
                return this.createThoughtItem(element);
            case "loading":
                return this.createLoadingItem(element);
            case "empty":
                return this.createEmptyItem(element);
            default:
                return new vscode.TreeItem("Unknown");
        }
    }

    /**
     * 获取子节点
     */
    async getChildren(element?: CodeReviewViewNode): Promise<CodeReviewViewNode[]> {
        if (!element) {
            return this.getRootChildren();
        }

        switch (element.type) {
            case "review":
                return this.getReviewChildren(element.record);
            default:
                return [];
        }
    }

    /**
     * 获取根节点
     */
    private getRootChildren(): CodeReviewViewNode[] {
        const nodes: CodeReviewViewNode[] = [];

        // 如果正在审阅，显示进度
        if (this.isReviewing) {
            nodes.push({ type: "loading", message: this.currentProgress || "正在审阅..." });
            return nodes;
        }

        // 摘要统计
        const summary = getCodeReviewSummary();
        if (summary.totalReviews > 0) {
            nodes.push({ type: "summary", summary });
        }

        // 历史记录
        const history = readCodeReviewHistory();
        if (history.reviews.length === 0) {
            nodes.push({ 
                type: "empty", 
                message: "暂无审阅记录。点击上方 ▶️ 开始第一次代码审阅！" 
            });
        } else {
            for (const record of history.reviews.slice(0, 10)) {
                nodes.push({ type: "review", record });
            }
        }

        return nodes;
    }

    /**
     * 获取审阅详情子节点
     */
    private getReviewChildren(record: PersistedReviewRecord): CodeReviewViewNode[] {
        const nodes: CodeReviewViewNode[] = [];

        // 按严重程度分组显示发现
        const criticalFindings = record.findings.filter(f => f.severity === "critical");
        const majorFindings = record.findings.filter(f => f.severity === "major");
        const minorFindings = record.findings.filter(f => f.severity === "minor");
        const suggestions = record.findings.filter(f => f.severity === "suggestion");

        if (criticalFindings.length > 0) {
            nodes.push({ type: "header", label: `🔴 严重问题 (${criticalFindings.length})` });
            for (const finding of criticalFindings) {
                nodes.push({ type: "finding", reviewId: record.id, finding });
            }
        }

        if (majorFindings.length > 0) {
            nodes.push({ type: "header", label: `🟠 重要问题 (${majorFindings.length})` });
            for (const finding of majorFindings) {
                nodes.push({ type: "finding", reviewId: record.id, finding });
            }
        }

        if (minorFindings.length > 0) {
            nodes.push({ type: "header", label: `🟡 次要问题 (${minorFindings.length})` });
            for (const finding of minorFindings) {
                nodes.push({ type: "finding", reviewId: record.id, finding });
            }
        }

        if (suggestions.length > 0) {
            nodes.push({ type: "header", label: `💡 改进建议 (${suggestions.length})` });
            for (const finding of suggestions) {
                nodes.push({ type: "finding", reviewId: record.id, finding });
            }
        }

        // 行动计划
        if (record.actionPlan.immediate.length > 0) {
            nodes.push({ type: "header", label: "⚡ 立即行动" });
            for (const action of record.actionPlan.immediate) {
                nodes.push({ type: "actionItem", reviewId: record.id, action, priority: "immediate" });
            }
        }

        return nodes;
    }

    // ==================== TreeItem 创建方法 ====================

    private createHeaderItem(element: { type: "header"; label: string; detail?: string }): vscode.TreeItem {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        item.contextValue = "codeReview.header";
        if (element.detail) {
            item.description = element.detail;
        }
        return item;
    }

    private createSummaryItem(element: { type: "summary"; summary: ReturnType<typeof getCodeReviewSummary> }): vscode.TreeItem {
        const s = element.summary;
        const item = new vscode.TreeItem(
            `📊 总计 ${s.totalReviews} 次审阅，${s.openFindings} 个待处理问题`,
            vscode.TreeItemCollapsibleState.None
        );
        item.description = `平均得分: ${s.averageScore}`;
        item.tooltip = new vscode.MarkdownString(
            `### 审阅统计\n\n` +
            `- 总审阅次数: **${s.totalReviews}**\n` +
            `- 总发现问题: **${s.totalFindings}**\n` +
            `- 待处理: **${s.openFindings}**\n` +
            `- 已修复: **${s.fixedFindings}**\n` +
            `- 平均得分: **${s.averageScore}**\n\n` +
            `#### 严重程度分布\n` +
            `- 🔴 严重: ${s.severityDistribution.critical}\n` +
            `- 🟠 重要: ${s.severityDistribution.major}\n` +
            `- 🟡 次要: ${s.severityDistribution.minor}\n` +
            `- 💡 建议: ${s.severityDistribution.suggestion}`
        );
        item.contextValue = "codeReview.summary";
        return item;
    }

    private createReviewItem(element: { type: "review"; record: PersistedReviewRecord }): vscode.TreeItem {
        const r = element.record;
        const item = new vscode.TreeItem(
            `${r.scope.description}`,
            this.expandedReviews.has(r.id) 
                ? vscode.TreeItemCollapsibleState.Expanded 
                : vscode.TreeItemCollapsibleState.Collapsed
        );
        
        item.iconPath = getRiskIcon(r.summary.riskLevel);
        item.description = `${formatDate(r.timestamp)} · ${r.findings.length} 个发现 · ${r.summary.overallScore}分`;
        
        item.tooltip = new vscode.MarkdownString(
            `### ${r.scope.description}\n\n` +
            `**时间**: ${formatDate(r.timestamp)}\n` +
            `**得分**: ${r.summary.overallScore}/100\n` +
            `**风险等级**: ${r.summary.riskLevel}\n` +
            `**分析文件**: ${r.metrics.filesAnalyzed} 个\n` +
            `**耗时**: ${formatDuration(r.metrics.totalDuration)}\n\n` +
            `#### 优点\n${r.summary.strengths.map(s => `- ${s}`).join("\n")}\n\n` +
            `#### 待改进\n${r.summary.areasForImprovement.map(s => `- ${s}`).join("\n")}`
        );
        
        item.contextValue = "codeReview.review";
        return item;
    }

    private createFindingItem(element: { type: "finding"; reviewId: string; finding: PersistedFinding }): vscode.TreeItem {
        const f = element.finding;
        const item = new vscode.TreeItem(f.title, vscode.TreeItemCollapsibleState.None);
        
        item.iconPath = f.status === "open" ? getSeverityIcon(f.severity) : getStatusIcon(f.status);
        item.description = `${getCategoryLabel(f.category)} · ${path.basename(f.location.file)}`;
        
        const tooltip = new vscode.MarkdownString();
        tooltip.appendMarkdown(`### ${f.title}\n\n`);
        tooltip.appendMarkdown(`**严重程度**: ${getSeverityLabel(f.severity)}\n`);
        tooltip.appendMarkdown(`**类别**: ${getCategoryLabel(f.category)}\n`);
        tooltip.appendMarkdown(`**状态**: ${f.status}\n`);
        tooltip.appendMarkdown(`**文件**: \`${f.location.file}\`\n`);
        if (f.location.startLine) {
            tooltip.appendMarkdown(`**行号**: ${f.location.startLine}${f.location.endLine ? `-${f.location.endLine}` : ""}\n`);
        }
        tooltip.appendMarkdown(`\n---\n\n`);
        tooltip.appendMarkdown(`${f.description}\n\n`);
        tooltip.appendMarkdown(`**建议**: ${f.suggestion}\n`);
        
        if (f.codeExample) {
            tooltip.appendMarkdown(`\n**修改前**:\n\`\`\`\n${f.codeExample.before}\n\`\`\`\n`);
            tooltip.appendMarkdown(`\n**修改后**:\n\`\`\`\n${f.codeExample.after}\n\`\`\`\n`);
        }
        
        item.tooltip = tooltip;
        item.contextValue = f.status === "open" ? "codeReview.finding.open" : "codeReview.finding.closed";
        
        // 点击跳转到代码
        item.command = {
            command: "issueManager.codeReview.goToCode",
            title: "跳转到代码",
            arguments: [element],
        };
        
        return item;
    }

    private createActionItem(element: { type: "actionItem"; reviewId: string; action: string; priority: string }): vscode.TreeItem {
        const priorityIcons = {
            immediate: new vscode.ThemeIcon("flame", new vscode.ThemeColor("errorForeground")),
            shortTerm: new vscode.ThemeIcon("watch", new vscode.ThemeColor("editorWarning.foreground")),
            longTerm: new vscode.ThemeIcon("calendar", new vscode.ThemeColor("charts.blue")),
        };
        
        const item = new vscode.TreeItem(element.action, vscode.TreeItemCollapsibleState.None);
        item.iconPath = priorityIcons[element.priority as keyof typeof priorityIcons];
        item.contextValue = "codeReview.actionItem";
        return item;
    }

    private createInsightItem(element: { type: "insight"; reviewId: string; insight: string }): vscode.TreeItem {
        const item = new vscode.TreeItem(element.insight, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon("lightbulb");
        item.contextValue = "codeReview.insight";
        return item;
    }

    private createThoughtItem(element: { type: "agentThought"; reviewId: string; thought: AgentThought }): vscode.TreeItem {
        const t = element.thought;
        const item = new vscode.TreeItem(
            `${t.step}. ${t.action}: ${t.reasoning.substring(0, 50)}...`,
            vscode.TreeItemCollapsibleState.None
        );
        item.iconPath = new vscode.ThemeIcon("comment-discussion");
        item.tooltip = t.reasoning;
        item.contextValue = "codeReview.thought";
        return item;
    }

    private createLoadingItem(element: { type: "loading"; message: string }): vscode.TreeItem {
        const item = new vscode.TreeItem(element.message, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon("sync~spin");
        item.contextValue = "codeReview.loading";
        return item;
    }

    private createEmptyItem(element: { type: "empty"; message: string }): vscode.TreeItem {
        const item = new vscode.TreeItem(element.message, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon("info");
        item.contextValue = "codeReview.empty";
        return item;
    }

    // ==================== 操作方法 ====================

    /**
     * 开始代码审阅
     */
    private async startReview(scope?: { type: "workspace" | "folder" | "files" | "diff"; paths: string[] }): Promise<void> {
        if (this.isReviewing) {
            vscode.window.showWarningMessage("已有审阅任务在进行中");
            return;
        }

        // 确定审阅范围
        let reviewScope = scope;
        if (!reviewScope) {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                vscode.window.showErrorMessage("请先打开一个工作区");
                return;
            }

            // 让用户选择审阅范围
            const choice = await vscode.window.showQuickPick([
                { label: "$(folder) 当前工作区", description: "审阅整个工作区", value: "workspace" },
                { label: "$(file) 当前文件", description: "仅审阅当前打开的文件", value: "file" },
                { label: "$(git-compare) Git 变更", description: "审阅未提交的变更", value: "diff" },
            ], {
                placeHolder: "选择审阅范围",
            });

            if (!choice) return;

            switch (choice.value) {
                case "workspace":
                    reviewScope = { type: "workspace", paths: [workspaceFolders[0].uri.fsPath] };
                    break;
                case "file": {
                    const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
                    if (!activeFile) {
                        vscode.window.showErrorMessage("请先打开一个文件");
                        return;
                    }
                    reviewScope = { type: "files", paths: [activeFile] };
                    break;
                }
                case "diff":
                    reviewScope = { type: "diff", paths: [] };
                    break;
            }
        }

        if (!reviewScope) return;

        // 询问用户关注点
        const focus = await vscode.window.showInputBox({
            prompt: "请输入审阅关注点（可选，如：安全性、性能、代码规范）",
            placeHolder: "留空则进行全面审阅",
        });

        this.isReviewing = true;
        this.currentProgress = "正在初始化审阅...";
        this.refresh();

        try {
            const agent = new CodeReviewAgent({
                maxExplorationRounds: 5,
                focusAreas: focus ? [focus as IssueCategory] : undefined,
            });

            this.currentAgent = agent;

            // 监听进度
            agent.onProgress = (state, message) => {
                this.currentProgress = message;
                this.refresh();
            };

            agent.onFinding = (finding) => {
                vscode.window.showInformationMessage(`🔍 发现问题: ${finding.title}`);
            };

            // 执行审阅
            const report = await agent.review(reviewScope, { focus: focus || undefined });

            // 保存结果
            addCodeReviewRecord(report);

            vscode.window.showInformationMessage(
                `✅ 审阅完成！发现 ${report.findings.length} 个问题，得分 ${report.summary.overallScore}/100`
            );

        } catch (error) {
            if ((error as Error).message === "审阅已取消") {
                vscode.window.showWarningMessage("审阅已取消");
            } else {
                Logger.getInstance().error("[CodeReviewView] Review failed:", error);
                vscode.window.showErrorMessage(`审阅失败: ${(error as Error).message}`);
            }
        } finally {
            this.isReviewing = false;
            this.currentAgent = null;
            this.currentProgress = "";
            this.refresh();
        }
    }

    /**
     * 取消审阅
     */
    private cancelReview(): void {
        if (this.currentAgent) {
            this.currentAgent.cancel();
            vscode.window.showInformationMessage("正在取消审阅...");
        }
    }

    /**
     * 更新发现状态
     */
    private async updateFindingStatus(node: CodeReviewViewNode, status: FindingStatus): Promise<void> {
        if (node.type !== "finding") return;

        updateFindingStatus(node.reviewId, node.finding.id, status);
        this.refresh();

        const statusLabels: Record<FindingStatus, string> = {
            "open": "重新打开",
            "fixed": "已修复",
            "wont-fix": "不修复",
            "false-positive": "误报",
        };
        vscode.window.showInformationMessage(`已将问题标记为: ${statusLabels[status]}`);
    }

    /**
     * 从发现创建问题
     */
    private async createIssueFromFinding(node: CodeReviewViewNode): Promise<void> {
        if (node.type !== "finding") return;

        const f = node.finding;
        const markdown = `# ${f.title}

## 问题描述
${f.description}

## 位置
- 文件: \`${f.location.file}\`
${f.location.startLine ? `- 行号: ${f.location.startLine}${f.location.endLine ? `-${f.location.endLine}` : ""}` : ""}

${f.location.codeSnippet ? `### 相关代码\n\`\`\`\n${f.location.codeSnippet}\n\`\`\`` : ""}

## 建议修复方案
${f.suggestion}

${f.codeExample ? `### 示例修改

**修改前:**
\`\`\`
${f.codeExample.before}
\`\`\`

**修改后:**
\`\`\`
${f.codeExample.after}
\`\`\`
` : ""}

## 元信息
- 严重程度: ${getSeverityLabel(f.severity)}
- 类别: ${getCategoryLabel(f.category)}
- 预估工作量: ${f.effort}
- 来源: 代码审阅 ${formatDate(Date.now())}
`;

        const uri = await createIssueMarkdown({
            markdownBody: markdown,
            frontmatter: {
                title: f.title,
                tags: ["code-review", f.category, f.severity],
            },
        });

        if (uri) {
            // 关联发现到问题
            const issueId = path.basename(uri.fsPath, ".md");
            linkFindingToIssue(node.reviewId, f.id, issueId);
            
            await vscode.window.showTextDocument(uri);
            vscode.window.showInformationMessage("已创建问题文档");
            
            this.refresh();
        }
    }

    /**
     * 跳转到代码
     */
    private async goToCode(node: CodeReviewViewNode): Promise<void> {
        if (node.type !== "finding") return;

        const f = node.finding;
        try {
            const doc = await vscode.workspace.openTextDocument(f.location.file);
            const editor = await vscode.window.showTextDocument(doc);

            if (f.location.startLine) {
                const line = f.location.startLine - 1;
                const range = new vscode.Range(
                    line, 0,
                    f.location.endLine ? f.location.endLine - 1 : line,
                    0
                );
                editor.selection = new vscode.Selection(range.start, range.end);
                editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`无法打开文件: ${f.location.file}`);
        }
    }

    /**
     * 删除审阅记录
     */
    private async deleteReview(node: CodeReviewViewNode): Promise<void> {
        if (node.type !== "review") return;

        const confirm = await vscode.window.showWarningMessage(
            `确定要删除此审阅记录吗？`,
            { modal: true },
            "删除"
        );

        if (confirm === "删除") {
            deleteCodeReviewRecord(node.record.id);
            this.refresh();
            vscode.window.showInformationMessage("已删除审阅记录");
        }
    }

    /**
     * 切换展开状态
     */
    private toggleExpand(node: CodeReviewViewNode): void {
        if (node.type !== "review") return;

        if (this.expandedReviews.has(node.record.id)) {
            this.expandedReviews.delete(node.record.id);
        } else {
            this.expandedReviews.add(node.record.id);
        }
        this.refresh();
    }
}
