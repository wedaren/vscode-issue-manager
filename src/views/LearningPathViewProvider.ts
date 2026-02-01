/**
 * 📚 学习路径视图提供者
 * 
 * 提供学习路径的可视化管理界面：
 * - 展示生成的学习路径
 * - 追踪学习进度
 * - 管理学习阶段和节点
 * - 快速导航到学习资料
 */

import * as vscode from "vscode";
import { Logger } from "../core/utils/Logger";
import { LearningPathAgent, LearningStage, LearningNode as LearningNodeType } from "../llm/LearningPathAgent";
import {
    readLearningPathHistory,
    addLearningPath,
    updateLearningPath,
    updateLearningProgress,
    deleteLearningPath,
    getLearningPathSummary,
    PersistedLearningPath,
} from "../data/agentHistory";


// ==================== 类型定义 ====================

/** 视图节点类型 */
export type LearningPathViewNode =
    | { type: "summary"; summary: ReturnType<typeof getLearningPathSummary> }
    | { type: "path"; path: PersistedLearningPath }
    | { type: "stage"; pathId: string; stage: LearningStage; stageIndex: number }
    | { type: "node"; pathId: string; stageIndex: number; node: LearningNodeType; completed: boolean }
    | { type: "header"; label: string }
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

/** 获取进度百分比 */
function getProgressPercent(path: PersistedLearningPath): number {
    const total = path.totalNodes || path.stages.reduce((sum, s) => sum + s.nodes.length, 0);
    if (total === 0) { return 0; }
    return Math.round((path.progress.completedNodes.length / total) * 100);
}

/** 获取进度图标 */
function getProgressIcon(percent: number): vscode.ThemeIcon {
    if (percent >= 100) {
        return new vscode.ThemeIcon("check-all", new vscode.ThemeColor("charts.green"));
    } else if (percent >= 75) {
        return new vscode.ThemeIcon("pie-chart", new vscode.ThemeColor("charts.blue"));
    } else if (percent >= 50) {
        return new vscode.ThemeIcon("pie-chart", new vscode.ThemeColor("charts.yellow"));
    } else if (percent > 0) {
        return new vscode.ThemeIcon("pie-chart", new vscode.ThemeColor("charts.orange"));
    } else {
        return new vscode.ThemeIcon("circle-outline", new vscode.ThemeColor("charts.gray"));
    }
}

/** 获取阶段图标 */
function getStageIcon(stageIndex: number, totalStages: number): string {
    const icons = ["🌱", "🌿", "🌳", "🌲", "🏔️"];
    const index = Math.floor((stageIndex / totalStages) * icons.length);
    return icons[Math.min(index, icons.length - 1)];
}

// ==================== 视图提供者 ====================

export class LearningPathViewProvider implements vscode.TreeDataProvider<LearningPathViewNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<LearningPathViewNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private agent: LearningPathAgent;
    private isGenerating = false;
    private currentProgress = "";
    private expandedPaths = new Set<string>();
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.agent = new LearningPathAgent();
    }

    /**
     * 创建并注册视图
     */
    static register(context: vscode.ExtensionContext): LearningPathViewProvider {
        const provider = new LearningPathViewProvider(context);

        // 注册树视图
        const treeView = vscode.window.createTreeView("issueManager.views.learningPath", {
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
            // 生成学习路径
            vscode.commands.registerCommand("issueManager.learningPath.generate", () =>
                this.generatePath()
            ),

            // 刷新视图
            vscode.commands.registerCommand("issueManager.learningPath.refresh", () =>
                this.refresh()
            ),

            // 切换收藏
            vscode.commands.registerCommand("issueManager.learningPath.toggleStar", (node: LearningPathViewNode) =>
                this.toggleStar(node)
            ),

            // 删除路径
            vscode.commands.registerCommand("issueManager.learningPath.deletePath", (node: LearningPathViewNode) =>
                this.deletePath(node)
            ),

            // 切换节点完成状态
            vscode.commands.registerCommand("issueManager.learningPath.toggleNodeComplete", (node: LearningPathViewNode) =>
                this.toggleNodeComplete(node)
            ),

            // 跳转到学习资料
            vscode.commands.registerCommand("issueManager.learningPath.goToResource", (node: LearningPathViewNode) =>
                this.goToResource(node)
            ),

            // 查看阶段详情
            vscode.commands.registerCommand("issueManager.learningPath.viewStage", (node: LearningPathViewNode) =>
                this.viewStage(node)
            ),

            // 导出学习路径
            vscode.commands.registerCommand("issueManager.learningPath.exportPath", (node: LearningPathViewNode) =>
                this.exportPath(node)
            ),

            // 重置进度
            vscode.commands.registerCommand("issueManager.learningPath.resetProgress", (node: LearningPathViewNode) =>
                this.resetProgress(node)
            ),
        ];
    }

    /**
     * 生成学习路径
     */
    private async generatePath(): Promise<void> {
        if (this.isGenerating) {
            vscode.window.showWarningMessage("正在生成学习路径...");
            return;
        }

        // 获取学习目标
        const goal = await vscode.window.showInputBox({
            prompt: "请输入你的学习目标",
            placeHolder: "例如：掌握 TypeScript 高级特性、理解 React Hooks 原理",
            validateInput: (value) => {
                if (!value || value.trim().length < 5) {
                    return "请输入至少 5 个字符的学习目标";
                }
                return null;
            },
        });

        if (!goal) { return; }

        // 获取当前水平（简化为字符串）
        const currentLevel = await vscode.window.showQuickPick([
            { label: "🌱 初学者", value: "beginner", description: "刚开始学习这个领域" },
            { label: "🌳 中级", value: "intermediate", description: "有实践经验" },
            { label: "🌲 高级", value: "advanced", description: "有深入理解" },
        ], { placeHolder: "选择你当前的水平" });

        if (!currentLevel) { return; }

        // 获取时间预算（天数）
        const timeBudget = await vscode.window.showQuickPick([
            { label: "⏰ 1 周", value: "7" },
            { label: "📅 1 个月", value: "30" },
            { label: "📆 3 个月", value: "90" },
            { label: "🗓️ 无限制", value: "0" },
        ], { placeHolder: "选择你的时间预算" });

        if (!timeBudget) { return; }
        this.isGenerating = true;
        this.refresh();

        try {
            // 生成学习路径（使用 Agent 的 generatePath）
            const abortController = new AbortController();
            this.agent.onProgress = (state, message) => {
                this.currentProgress = `${state.phase}: ${message}`;
                this.refresh();
            };

            const learningPath = await this.agent.generatePath(goal, {
                signal: abortController.signal,
                context: JSON.stringify({ currentLevel: currentLevel.value, timeBudgetDays: Number(timeBudget.value) }),
            });

            // 保存学习路径
            const persisted = addLearningPath(learningPath);

            vscode.window.showInformationMessage(
                `✨ 学习路径生成完成！共 ${learningPath.stages.length} 个阶段，${learningPath.totalNodes} 个学习节点`
            );

            // 展开新路径
            this.expandedPaths.add(persisted.id);

        } catch (error) {
            Logger.getInstance().error("生成学习路径失败", error);
            vscode.window.showErrorMessage(`生成学习路径失败: ${error}`);
        } finally {
            this.isGenerating = false;
            this.currentProgress = "";
            this.refresh();
        }
    }

    /**
     * 收集文档
     */
    private async collectDocuments(): Promise<any[]> {
        const config = vscode.workspace.getConfiguration("issueManager");
        const issueDir = config.get<string>("issueDir");
        if (!issueDir) { return []; }

        const pattern = new vscode.RelativePattern(issueDir, "**/*.md");
        const files = await vscode.workspace.findFiles(pattern, "**/node_modules/**", 100);

        return files.map(uri => ({
            id: uri.fsPath,
            title: uri.fsPath.split("/").pop()?.replace(".md", "") || "",
            filePath: uri.fsPath,
            content: "",
        }));
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
    private toggleStar(node: LearningPathViewNode): void {
        if (node.type !== "path") { return; }

        updateLearningPath(node.path.id, {
            starred: !node.path.starred,
        });
        this.refresh();
    }

    /**
     * 删除路径
     */
    private async deletePath(node: LearningPathViewNode): Promise<void> {
        if (node.type !== "path") { return; }

        const confirm = await vscode.window.showWarningMessage(
            `确定要删除学习路径「${node.path.goal}」吗？`,
            { modal: true },
            "删除"
        );

        if (confirm === "删除") {
            deleteLearningPath(node.path.id);
            this.refresh();
        }
    }

    /**
     * 切换节点完成状态
     */
    private toggleNodeComplete(node: LearningPathViewNode): void {
        if (node.type !== "node") { return; }

        updateLearningProgress(node.pathId, node.node.id, !node.completed);
        this.refresh();
    }

    /**
     * 跳转到学习资料
     */
    private async goToResource(node: LearningPathViewNode): Promise<void> {
        if (node.type !== "node") { return; }

        const learningNode = node.node;
        // 优先尝试打开原始文件
        if (learningNode.filePath) {
            try {
                const uri = vscode.Uri.file(learningNode.filePath);
                const doc = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(doc);
                return;
            } catch (error) {
                // 继续使用内嵌展示
            }
        }

        // 内嵌展示学习节点摘要
        const hours = Math.round((learningNode.estimatedTime || 0) / 60);
        const difficultyMap: Record<string, number> = { beginner: 1, intermediate: 2, advanced: 3 };
        const stars = "⭐".repeat(difficultyMap[learningNode.difficulty] || 1);

        const doc = await vscode.workspace.openTextDocument({
            content: `# ${learningNode.title}\n\n` +
                `## 概要\n${learningNode.summary || "暂无简介"}\n\n` +
                `## 预计时间\n${hours} 小时\n\n` +
                `## 难度\n${stars}\n\n`,
            language: "markdown",
        });
        await vscode.window.showTextDocument(doc);
    }

    /**
     * 查看阶段详情
     */
    private async viewStage(node: LearningPathViewNode): Promise<void> {
        if (node.type !== "stage") { return; }

        const stage = node.stage;
        const doc = await vscode.workspace.openTextDocument({
            content: `# ${stage.name}\n\n` +
                `## 阶段描述\n${stage.description}\n\n` +
                `## 检验问题\n${stage.checkQuestions.map(q => `- ${q}`).join("\n")}\n\n` +
                `## 学习节点 (${stage.nodes.length} 个)\n\n` +
                stage.nodes.map((n, i) => {
                    const hours = Math.round((n.estimatedTime || 0) / 60);
                    const difficultyMap: Record<string, number> = { beginner: 1, intermediate: 2, advanced: 3 };
                    const stars = "⭐".repeat(difficultyMap[n.difficulty] || 1);
                    return (
                        `### ${i + 1}. ${n.title}\n\n` +
                        `${n.summary}\n\n` +
                        `- 预计时间: ${hours} 小时\n` +
                        `- 难度: ${stars}\n`
                    );
                }).join("\n"),
            language: "markdown",
        });
        await vscode.window.showTextDocument(doc);
    }

    /**
     * 导出学习路径
     */
    private async exportPath(node: LearningPathViewNode): Promise<void> {
        if (node.type !== "path") { return; }

        const path = node.path;
        const content = this.generatePathMarkdown(path);

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`learning-path-${path.goal.substring(0, 20).replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "-")}.md`),
            filters: { "Markdown": ["md"] },
        });

        if (uri) {
            await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));
            vscode.window.showInformationMessage(`学习路径已导出到 ${uri.fsPath}`);
        }
    }

    /**
     * 生成路径 Markdown
     */
    private generatePathMarkdown(path: PersistedLearningPath): string {
        const progress = getProgressPercent(path);
        let md = `# 学习路径: ${path.goal}\n\n`;
        md += `**创建时间**: ${formatDate(path.timestamp)}\n\n`;
        md += `**当前进度**: ${progress}%\n\n`;
        md += `**预计总时长**: ${Math.round((path.totalDuration || 0) / 60)} 小时\n\n`;

        for (let i = 0; i < path.stages.length; i++) {
            const stage = path.stages[i];
            const stageIcon = getStageIcon(i, path.stages.length);
            md += `## ${stageIcon} 阶段 ${i + 1}: ${stage.name}\n\n`;
            md += `${stage.description}\n\n`;
            md += `### 检验问题\n${stage.checkQuestions.map(g => `- ${g}`).join("\n")}\n\n`;
            md += `### 学习节点\n\n`;
            
            for (const node of stage.nodes) {
                const isCompleted = path.progress.completedNodes.includes(node.id);
                const hours = Math.round((node.estimatedTime || 0) / 60);
                md += `- [${isCompleted ? "x" : " "}] **${node.title}** (${hours}h)\n`;
                md += `  - ${node.summary}\n`;
            }
            md += "\n";
        }

        return md;
    }

    /**
     * 重置进度
     */
    private async resetProgress(node: LearningPathViewNode): Promise<void> {
        if (node.type !== "path") { return; }

        const confirm = await vscode.window.showWarningMessage(
            `确定要重置学习路径「${node.path.goal}」的进度吗？`,
            { modal: true },
            "重置"
        );

        if (confirm === "重置") {
            updateLearningPath(node.path.id, {
                progress: {
                    pathId: node.path.id,
                    completedNodes: [],
                    currentStage: 0,
                    startTime: Date.now(),
                    totalTimeSpent: 0,
                },
            });
            this.refresh();
        }
    }

    // ==================== TreeDataProvider 实现 ====================

    getTreeItem(element: LearningPathViewNode): vscode.TreeItem {
        switch (element.type) {
            case "summary":
                return this.createSummaryItem(element);
            case "path":
                return this.createPathItem(element);
            case "stage":
                return this.createStageItem(element);
            case "node":
                return this.createNodeItem(element);
            case "header":
                return this.createHeaderItem(element);
            case "loading":
                return this.createLoadingItem(element);
            case "empty":
                return this.createEmptyItem(element);
            default:
                return new vscode.TreeItem("Unknown");
        }
    }

    async getChildren(element?: LearningPathViewNode): Promise<LearningPathViewNode[]> {
        if (!element) {
            return this.getRootChildren();
        }

        switch (element.type) {
            case "path":
                return this.getPathChildren(element.path);
            case "stage":
                return this.getStageChildren(element);
            default:
                return [];
        }
    }

    private getRootChildren(): LearningPathViewNode[] {
        const nodes: LearningPathViewNode[] = [];

        // 加载状态
        if (this.isGenerating) {
            nodes.push({ type: "loading", message: this.currentProgress || "正在生成学习路径..." });
            return nodes;
        }

        // 统计摘要
        const summary = getLearningPathSummary();
        if (summary.totalPaths > 0) {
            nodes.push({ type: "summary", summary });
        }

        // 学习路径列表
        const history = readLearningPathHistory();
        if (history.paths.length === 0) {
            nodes.push({
                type: "empty",
                message: "暂无学习路径。点击上方 ▶️ 生成个性化学习路径！",
            });
        } else {
            // 进行中的路径
            const activePaths = history.paths.filter(p => {
                const totalNodes = p.stages.reduce((sum, s) => sum + s.nodes.length, 0);
                return p.progress.completedNodes.length < totalNodes;
            });
            
            // 已完成的路径
            const completedPaths = history.paths.filter(p => {
                const totalNodes = p.stages.reduce((sum, s) => sum + s.nodes.length, 0);
                return totalNodes > 0 && p.progress.completedNodes.length >= totalNodes;
            });

            if (activePaths.length > 0) {
                nodes.push({ type: "header", label: `📖 进行中 (${activePaths.length})` });
                for (const path of activePaths) {
                    nodes.push({ type: "path", path });
                }
            }

            if (completedPaths.length > 0) {
                nodes.push({ type: "header", label: `✅ 已完成 (${completedPaths.length})` });
                for (const path of completedPaths) {
                    nodes.push({ type: "path", path });
                }
            }
        }

        return nodes;
    }

    private getPathChildren(path: PersistedLearningPath): LearningPathViewNode[] {
        return path.stages.map((stage, index) => ({
            type: "stage" as const,
            pathId: path.id,
            stage,
            stageIndex: index,
        }));
    }

    private getStageChildren(element: { type: "stage"; pathId: string; stage: LearningStage; stageIndex: number }): LearningPathViewNode[] {
        const history = readLearningPathHistory();
        const path = history.paths.find(p => p.id === element.pathId);
        if (!path) { return []; }

        return element.stage.nodes.map(node => ({
            type: "node" as const,
            pathId: element.pathId,
            stageIndex: element.stageIndex,
            node,
            completed: path.progress.completedNodes.includes(node.id),
        }));
    }

    // ==================== TreeItem 创建方法 ====================

    private createSummaryItem(element: { type: "summary"; summary: ReturnType<typeof getLearningPathSummary> }): vscode.TreeItem {
        const s = element.summary;
        const item = new vscode.TreeItem(
            `📊 共 ${s.totalPaths} 条路径`,
            vscode.TreeItemCollapsibleState.None
        );
        item.description = `${s.completedNodes}/${s.totalNodes} 节点完成`;
        item.tooltip = new vscode.MarkdownString(
            `### 学习统计\n\n` +
            `- 路径总数: **${s.totalPaths}**\n` +
            `- 进行中: **${s.activePaths}**\n` +
            `- 已完成: **${s.completedPaths}**\n` +
            `- 节点进度: **${s.completedNodes}/${s.totalNodes}**`
        );
        item.contextValue = "learningPath.summary";
        return item;
    }

    private createPathItem(element: { type: "path"; path: PersistedLearningPath }): vscode.TreeItem {
        const p = element.path;
        const progress = getProgressPercent(p);
        
        const item = new vscode.TreeItem(
            `${p.starred ? "⭐ " : ""}${p.goal}`,
            this.expandedPaths.has(p.id)
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.Collapsed
        );

        item.description = `${progress}% · ${p.stages.length} 阶段`;
        item.iconPath = getProgressIcon(progress);
        item.tooltip = new vscode.MarkdownString(
            `### ${p.goal}\n\n` +
            `**进度**: ${progress}%\n\n` +
            `**阶段**: ${p.stages.length}\n\n` +
            `**预计时长**: ${Math.round((p.totalDuration || 0) / 60)} 小时\n\n` +
            `**创建时间**: ${formatDate(p.timestamp)}`
        );
        item.contextValue = p.starred ? "learningPath.path.starred" : "learningPath.path";
        return item;
    }

    private createStageItem(element: { type: "stage"; pathId: string; stage: LearningStage; stageIndex: number }): vscode.TreeItem {
        const history = readLearningPathHistory();
        const path = history.paths.find(p => p.id === element.pathId);
        
        const completedCount = path 
            ? element.stage.nodes.filter(n => path.progress.completedNodes.includes(n.id)).length
            : 0;
        const totalCount = element.stage.nodes.length;
        const stageIcon = getStageIcon(element.stageIndex, path?.stages.length || 1);
        
        const item = new vscode.TreeItem(
            `${stageIcon} ${element.stage.name}`,
            vscode.TreeItemCollapsibleState.Collapsed
        );
        
        item.description = `${completedCount}/${totalCount}`;
        item.tooltip = new vscode.MarkdownString(
            `### ${element.stage.name}\n\n` +
            `${element.stage.description}\n\n` +
            `**检验问题**:\n${element.stage.checkQuestions.map(g => `- ${g}`).join("\n")}\n\n` +
            `**进度**: ${completedCount}/${totalCount}`
        );
        item.contextValue = "learningPath.stage";
        item.command = {
            command: "issueManager.learningPath.viewStage",
            title: "查看阶段",
            arguments: [element],
        };
        return item;
    }

    private createNodeItem(element: { type: "node"; pathId: string; stageIndex: number; node: LearningNodeType; completed: boolean }): vscode.TreeItem {
        const n = element.node;
        
        const item = new vscode.TreeItem(
            `${element.completed ? "✅" : "⬜"} ${n.title}`,
            vscode.TreeItemCollapsibleState.None
        );
        
        const hours = Math.round((n.estimatedTime || 0) / 60);
        const difficultyMap: Record<string, number> = { beginner: 1, intermediate: 2, advanced: 3 };
        const stars = "⭐".repeat(difficultyMap[n.difficulty] || 1);
        item.description = `${hours}h · ${stars}`;
        item.iconPath = element.completed 
            ? new vscode.ThemeIcon("pass-filled", new vscode.ThemeColor("charts.green"))
            : new vscode.ThemeIcon("circle-outline");
        item.tooltip = new vscode.MarkdownString(
            `### ${n.title}\n\n` +
            `${n.summary}\n\n` +
            `**预计时间**: ${hours} 小时\n\n` +
            `**难度**: ${stars}\n\n` +
            `**状态**: ${element.completed ? "✅ 已完成" : "⬜ 未完成"}\n\n` +
            `*点击切换完成状态*`
        );
        item.contextValue = element.completed ? "learningPath.node.completed" : "learningPath.node";
        item.command = {
            command: "issueManager.learningPath.toggleNodeComplete",
            title: "切换完成状态",
            arguments: [element],
        };
        return item;
    }

    private createHeaderItem(element: { type: "header"; label: string }): vscode.TreeItem {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        item.contextValue = "learningPath.header";
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
