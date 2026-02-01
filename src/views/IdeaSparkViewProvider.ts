/**
 * ✨ 创意激发视图提供者
 * 
 * 提供创意激发的可视化管理界面：
 * - 展示创意会话历史
 * - 管理创意火花
 * - 收藏精彩创意
 * - 将创意转化为问题文档
 */

import * as vscode from "vscode";
import { Logger } from "../core/utils/Logger";
import { IdeaSparkAgent, IdeaSpark } from "../llm/IdeaSparkAgent";
import {
    readIdeaSparkHistory,
    addIdeaSession,
    updateIdeaSession,
    toggleSparkFavorite,
    deleteIdeaSession,
    getIdeaSparkSummary,
    PersistedIdeaSession,
    PersistedIdeaSpark,
} from "../data/agentHistory";

// ==================== 类型定义 ====================

/** 视图节点类型 */
export type IdeaSparkViewNode =
    | { type: "summary"; summary: ReturnType<typeof getIdeaSparkSummary> }
    | { type: "session"; session: PersistedIdeaSession }
    | { type: "spark"; sessionId: string; spark: PersistedIdeaSpark; sparkIndex: number }
    | { type: "header"; label: string; icon?: string }
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

/** 获取碰撞方法标签 */
function getCollisionMethodLabel(method: string): string {
    const labels: Record<string, string> = {
        "analogy": "🔄 类比迁移",
        "combination": "🧩 组合融合",
        "contrast": "⚡ 对比启发",
        "abstraction": "🎯 抽象提升",
        "inversion": "🔃 逆向思维",
        "random": "🎲 随机碰撞",
    };
    return labels[method] || `💡 ${method}`;
}

/** 获取创意质量图标 */
function getQualityIcon(quality: number): vscode.ThemeIcon {
    if (quality >= 0.8) {
        return new vscode.ThemeIcon("flame", new vscode.ThemeColor("charts.red"));
    } else if (quality >= 0.6) {
        return new vscode.ThemeIcon("lightbulb", new vscode.ThemeColor("charts.yellow"));
    } else if (quality >= 0.4) {
        return new vscode.ThemeIcon("sparkle", new vscode.ThemeColor("charts.blue"));
    } else {
        return new vscode.ThemeIcon("light-bulb", new vscode.ThemeColor("charts.gray"));
    }
}

/** 获取创意质量标签 */
function getQualityLabel(quality: number): string {
    if (quality >= 0.8) { return "🔥 优秀"; }
    if (quality >= 0.6) { return "💡 良好"; }
    if (quality >= 0.4) { return "✨ 一般"; }
    return "💭 探索";
}

// ==================== 视图提供者 ====================

export class IdeaSparkViewProvider implements vscode.TreeDataProvider<IdeaSparkViewNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<IdeaSparkViewNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private agent: IdeaSparkAgent;
    private isGenerating = false;
    private currentProgress = "";
    private expandedSessions = new Set<string>();
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.agent = new IdeaSparkAgent();
    }

    /**
     * 创建并注册视图
     */
    static register(context: vscode.ExtensionContext): IdeaSparkViewProvider {
        const provider = new IdeaSparkViewProvider(context);

        // 注册树视图
        const treeView = vscode.window.createTreeView("issueManager.views.ideaSpark", {
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
            // 生成创意
            vscode.commands.registerCommand("issueManager.ideaSpark.generate", () =>
                this.generateIdeas()
            ),

            // 刷新视图
            vscode.commands.registerCommand("issueManager.ideaSpark.refresh", () =>
                this.refresh()
            ),

            // 切换会话收藏
            vscode.commands.registerCommand("issueManager.ideaSpark.toggleSessionStar", (node: IdeaSparkViewNode) =>
                this.toggleSessionStar(node)
            ),

            // 切换创意收藏
            vscode.commands.registerCommand("issueManager.ideaSpark.toggleSparkFavorite", (node: IdeaSparkViewNode) =>
                this.toggleSparkFavorite(node)
            ),

            // 删除会话
            vscode.commands.registerCommand("issueManager.ideaSpark.deleteSession", (node: IdeaSparkViewNode) =>
                this.deleteSession(node)
            ),

            // 查看创意详情
            vscode.commands.registerCommand("issueManager.ideaSpark.viewSpark", (node: IdeaSparkViewNode) =>
                this.viewSpark(node)
            ),

            // 将创意转为问题
            vscode.commands.registerCommand("issueManager.ideaSpark.createIssueFromSpark", (node: IdeaSparkViewNode) =>
                this.createIssueFromSpark(node)
            ),

            // 导出会话
            vscode.commands.registerCommand("issueManager.ideaSpark.exportSession", (node: IdeaSparkViewNode) =>
                this.exportSession(node)
            ),

            // 查看收藏的创意
            vscode.commands.registerCommand("issueManager.ideaSpark.viewFavorites", () =>
                this.viewFavorites()
            ),
        ];
    }

    /**
     * 生成创意
     */
    private async generateIdeas(): Promise<void> {
        if (this.isGenerating) {
            vscode.window.showWarningMessage("正在生成创意...");
            return;
        }

        // 选择主题
        const theme = await vscode.window.showInputBox({
            prompt: "请输入创意主题（可选）",
            placeHolder: "例如：提高生产力、创新产品设计、解决用户痛点...",
        });

        // 选择碰撞方法
        const methods = await vscode.window.showQuickPick([
            { label: "🎲 随机碰撞", value: "random", description: "随机选择知识点进行碰撞", picked: true },
            { label: "🔄 类比推理", value: "analogical", description: "寻找不同领域的相似模式" },
            { label: "🔃 逆向思维", value: "inversion", description: "从相反角度思考问题" },
            { label: "🧩 组合创新", value: "combination", description: "将不同元素重新组合" },
            { label: "🎯 抽象提升", value: "abstraction", description: "提取核心原理并应用" },
        ], {
            canPickMany: true,
            placeHolder: "选择碰撞方法（可多选）",
        });

        if (!methods || methods.length === 0) {
            // 默认使用随机碰撞
            methods?.push({ label: "🎲 随机碰撞", value: "random", description: "", picked: true });
        }

        this.isGenerating = true;
        this.refresh();

        try {
            // 获取 LLM 模型
            const models = await vscode.lm.selectChatModels({
                vendor: "copilot",
            });

            if (models.length === 0) {
                throw new Error("没有可用的 Copilot 模型");
            }

            const model = models[0];

            // 启动创意会话（使用 Agent.spark）
            this.agent.onProgress = (state, message) => {
                this.currentProgress = `${state.phase}: ${message}`;
                this.refresh();
            };

            const session = await this.agent.spark({
                theme: theme || undefined,
                seedConcept: undefined,
            });

            // 保存会话
            const persisted = addIdeaSession(session);

            vscode.window.showInformationMessage(
                `✨ 创意生成完成！产生了 ${session.sparks.length} 个创意火花`
            );

            // 展开新会话
            this.expandedSessions.add(persisted.id);

        } catch (error) {
            Logger.getInstance().error("生成创意失败", error);
            vscode.window.showErrorMessage(`生成创意失败: ${error}`);
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
     * 切换会话收藏
     */
    private toggleSessionStar(node: IdeaSparkViewNode): void {
        if (node.type !== "session") { return; }

        updateIdeaSession(node.session.id, {
            starred: !node.session.starred,
        });
        this.refresh();
    }

    /**
     * 切换创意收藏
     */
    private toggleSparkFavorite(node: IdeaSparkViewNode): void {
        if (node.type !== "spark") { return; }

        toggleSparkFavorite(node.sessionId, node.sparkIndex);
        this.refresh();
    }

    /**
     * 删除会话
     */
    private async deleteSession(node: IdeaSparkViewNode): Promise<void> {
        if (node.type !== "session") { return; }

        const confirm = await vscode.window.showWarningMessage(
            `确定要删除这个创意会话吗？包含 ${node.session.sparks.length} 个创意`,
            { modal: true },
            "删除"
        );

        if (confirm === "删除") {
            deleteIdeaSession(node.session.id);
            this.refresh();
        }
    }

    /**
     * 查看创意详情
     */
    private async viewSpark(node: IdeaSparkViewNode): Promise<void> {
        if (node.type !== "spark") { return; }

        const spark = node.spark;
        const idea = spark.idea;
        const inputs = spark.inputs;
        const avgScore = (idea.noveltyScore + idea.feasibilityScore + idea.impactScore) / 300;

        const doc = await vscode.workspace.openTextDocument({
            content: `# ${idea.title}\n\n` +
                `## 💡 创意描述\n\n${idea.description}\n\n` +
                `## 🎯 碰撞来源\n\n` +
                `**类型**: ${getCollisionMethodLabel(spark.collisionType)}\n\n` +
                `**概念 A**: ${inputs.concept1?.sourceTitle || inputs.concept1?.concept || "未知"}\n` +
                `> ${inputs.concept1?.concept || ""}\n\n` +
                `${inputs.concept2 ? `**概念 B**: ${inputs.concept2.sourceTitle || inputs.concept2.concept}\n> ${inputs.concept2.concept || ""}\n\n` : ""}` +
                `## 📊 评估\n\n` +
                `- **新颖性**: ${idea.noveltyScore}%\n` +
                `- **可行性**: ${idea.feasibilityScore}%\n` +
                `- **影响力**: ${idea.impactScore}%\n\n` +
                `## 🌱 详细阐述\n\n` +
                `${spark.elaboration?.coreInsight || "暂无"}\n\n` +
                `## 🚀 建议行动\n\n` +
                `${(spark.elaboration?.nextSteps || []).map(s => `- [ ] ${s}`).join("\n") || "暂无"}`,
            language: "markdown",
        });
        await vscode.window.showTextDocument(doc);
    }

    /**
     * 将创意转为问题
     */
    private async createIssueFromSpark(node: IdeaSparkViewNode): Promise<void> {
        if (node.type !== "spark") { return; }

        const spark = node.spark;
        const idea = spark.idea;
        const inputs = spark.inputs;
        const content = `# ${idea.title}\n\n` +
            `## 创意来源\n\n` +
            `通过 **${getCollisionMethodLabel(spark.collisionType)}** 产生\n\n` +
            `### 碰撞概念\n` +
            `- ${inputs.concept1?.sourceTitle || inputs.concept1?.concept}\n` +
            `${inputs.concept2 ? `- ${inputs.concept2.sourceTitle || inputs.concept2.concept}\n` : ""}` +
            `\n## 创意描述\n\n${idea.description}\n\n` +
            `## 建议\n\n${(spark.elaboration?.nextSteps || []).map(a => `- [ ] ${a}`).join("\n") || "- [ ] 待定"}\n\n` +
            `---\n` +
            `*新颖性: ${idea.noveltyScore}% | 可行性: ${idea.feasibilityScore}% | 影响力: ${idea.impactScore}%*`;

        await vscode.commands.executeCommand("issueManager.recordContent", { content });
    }

    /**
     * 导出会话
     */
    private async exportSession(node: IdeaSparkViewNode): Promise<void> {
        if (node.type !== "session") { return; }

        const session = node.session;
        const content = this.generateSessionMarkdown(session);

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`idea-sparks-${formatDate(session.timestamp).replace(/[: ]/g, "-")}.md`),
            filters: { "Markdown": ["md"] },
        });

        if (uri) {
            await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));
            vscode.window.showInformationMessage(`创意会话已导出到 ${uri.fsPath}`);
        }
    }

    /**
     * 生成会话 Markdown
     */
    private generateSessionMarkdown(session: PersistedIdeaSession): string {
        let md = `# 创意激发会话\n\n`;
        md += `**时间**: ${formatDate(session.timestamp)}\n\n`;
        md += `**主题**: ${session.theme || "自由探索"}\n\n`;
        md += `**创意数量**: ${session.sparks.length}\n\n`;

        md += `---\n\n`;

        for (let i = 0; i < session.sparks.length; i++) {
            const spark = session.sparks[i];
            const idea = spark.idea;
            const inputs = spark.inputs;
            md += `## ${i + 1}. ${idea.title} ${spark.isFavorite ? "⭐" : ""}\n\n`;
            md += `${idea.description}\n\n`;
            md += `- **类型**: ${getCollisionMethodLabel(spark.collisionType)}\n`;
            md += `- **评分**: 新颖 ${idea.noveltyScore}% · 可行 ${idea.feasibilityScore}% · 影响 ${idea.impactScore}%\n`;
            md += `- **碰撞概念**: ${[inputs.concept1, inputs.concept2, inputs.concept3].filter(Boolean).map(c => c?.concept || c?.sourceTitle).join(" + ")}\n\n`;
            
            const nextSteps = spark.elaboration?.nextSteps || [];
            if (nextSteps.length > 0) {
                md += `### 行动建议\n\n`;
                md += nextSteps.map(a => `- [ ] ${a}`).join("\n") + "\n\n";
            }
        }

        return md;
    }

    /**
     * 查看收藏的创意
     */
    private async viewFavorites(): Promise<void> {
        const history = readIdeaSparkHistory();
        const favorites: { session: PersistedIdeaSession; spark: IdeaSpark; index: number }[] = [];

        for (const session of history.sessions) {
            for (let i = 0; i < session.sparks.length; i++) {
                if (session.sparks[i].isFavorite) {
                    favorites.push({ session, spark: session.sparks[i], index: i });
                }
            }
        }

        if (favorites.length === 0) {
            vscode.window.showInformationMessage("还没有收藏的创意。点击创意旁的 ⭐ 来收藏！");
            return;
        }

        let content = `# ⭐ 收藏的创意 (${favorites.length})\n\n`;
        for (const { spark, session } of favorites) {
            const idea = spark.idea;
            content += `## ${idea.title}\n\n`;
            content += `*来自 ${formatDate(session.timestamp)} 的会话*\n\n`;
            content += `${idea.description}\n\n`;
            content += `- 评分: 新颖 ${idea.noveltyScore}% · 可行 ${idea.feasibilityScore}% · 影响 ${idea.impactScore}%\n`;
            content += `- 方法: ${getCollisionMethodLabel(spark.collisionType)}\n\n`;
            content += `---\n\n`;
        }

        const doc = await vscode.workspace.openTextDocument({
            content,
            language: "markdown",
        });
        await vscode.window.showTextDocument(doc);
    }

    // ==================== TreeDataProvider 实现 ====================

    getTreeItem(element: IdeaSparkViewNode): vscode.TreeItem {
        switch (element.type) {
            case "summary":
                return this.createSummaryItem(element);
            case "session":
                return this.createSessionItem(element);
            case "spark":
                return this.createSparkItem(element);
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

    async getChildren(element?: IdeaSparkViewNode): Promise<IdeaSparkViewNode[]> {
        if (!element) {
            return this.getRootChildren();
        }

        switch (element.type) {
            case "session":
                return this.getSessionChildren(element.session);
            default:
                return [];
        }
    }

    private getRootChildren(): IdeaSparkViewNode[] {
        const nodes: IdeaSparkViewNode[] = [];

        // 加载状态
        if (this.isGenerating) {
            nodes.push({ type: "loading", message: this.currentProgress || "正在生成创意..." });
            return nodes;
        }

        // 统计摘要
        const summary = getIdeaSparkSummary();
        if (summary.totalSessions > 0) {
            nodes.push({ type: "summary", summary });
        }

        // 会话列表
        const history = readIdeaSparkHistory();
        if (history.sessions.length === 0) {
            nodes.push({
                type: "empty",
                message: "暂无创意会话。点击上方 ✨ 开始创意碰撞！",
            });
        } else {
            // 收藏的会话
            const starredSessions = history.sessions.filter(s => s.starred);
            const normalSessions = history.sessions.filter(s => !s.starred);

            if (starredSessions.length > 0) {
                nodes.push({ type: "header", label: `⭐ 收藏会话 (${starredSessions.length})` });
                for (const session of starredSessions) {
                    nodes.push({ type: "session", session });
                }
            }

            if (normalSessions.length > 0) {
                nodes.push({ type: "header", label: `💡 最近会话 (${normalSessions.length})` });
                for (const session of normalSessions.slice(0, 20)) {
                    nodes.push({ type: "session", session });
                }
            }
        }

        return nodes;
    }

    private getSessionChildren(session: PersistedIdeaSession): IdeaSparkViewNode[] {
        const nodes: IdeaSparkViewNode[] = [];

        // 按质量分组（基于 idea 的平均分）
        const scored = session.sparks.map((spark, index) => {
            const idea = spark.idea;
            const avg = (idea.noveltyScore + idea.feasibilityScore + idea.impactScore) / 3; // 0-100
            return { spark, index, avg };
        });

        const highQualitySparks = scored.filter(s => s.avg >= 60);
        const normalSparks = scored.filter(s => s.avg < 60);

        if (highQualitySparks.length > 0) {
            nodes.push({ type: "header", label: `🔥 精选创意 (${highQualitySparks.length})` });
            for (const { spark, index } of highQualitySparks) {
                nodes.push({ type: "spark", sessionId: session.id, spark, sparkIndex: index });
            }
        }

        if (normalSparks.length > 0) {
            nodes.push({ type: "header", label: `💭 其他创意 (${normalSparks.length})` });
            for (const { spark, index } of normalSparks) {
                nodes.push({ type: "spark", sessionId: session.id, spark, sparkIndex: index });
            }
        }

        return nodes;
    }

    // ==================== TreeItem 创建方法 ====================

    private createSummaryItem(element: { type: "summary"; summary: ReturnType<typeof getIdeaSparkSummary> }): vscode.TreeItem {
        const s = element.summary;
        const item = new vscode.TreeItem(
            `📊 共 ${s.totalSessions} 次碰撞，${s.totalSparks} 个创意`,
            vscode.TreeItemCollapsibleState.None
        );
        item.description = `⭐ ${s.favoriteSparks} 收藏`;
        item.tooltip = new vscode.MarkdownString(
            `### 创意统计\n\n` +
            `- 会话总数: **${s.totalSessions}**\n` +
            `- 收藏会话: **${s.starredSessions}**\n` +
            `- 创意总数: **${s.totalSparks}**\n` +
            `- 收藏创意: **${s.favoriteSparks}**\n\n` +
            `### 碰撞方法分布\n` +
            Object.entries(s.sparksByMethod)
                .map(([method, count]) => `- ${getCollisionMethodLabel(method)}: ${count}`)
                .join("\n")
        );
        item.contextValue = "ideaSpark.summary";
        return item;
    }

    private createSessionItem(element: { type: "session"; session: PersistedIdeaSession }): vscode.TreeItem {
        const s = element.session;
        const favoriteCount = s.sparks.filter(sp => sp.isFavorite).length;
        
        const item = new vscode.TreeItem(
            `${s.starred ? "⭐ " : ""}${s.theme || formatDate(s.timestamp)}`,
            this.expandedSessions.has(s.id)
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.Collapsed
        );

        item.description = `${s.sparks.length} 创意${favoriteCount > 0 ? ` · ⭐${favoriteCount}` : ""}`;
        item.iconPath = new vscode.ThemeIcon("sparkle", new vscode.ThemeColor("charts.purple"));
        item.tooltip = new vscode.MarkdownString(
            `### 创意会话\n\n` +
            `**时间**: ${formatDate(s.timestamp)}\n\n` +
            `**主题**: ${s.theme || "自由探索"}\n\n` +
            `**创意数**: ${s.sparks.length}\n\n` +
            `**收藏数**: ${favoriteCount}`
        );
        item.contextValue = s.starred ? "ideaSpark.session.starred" : "ideaSpark.session";
        return item;
    }

    private createSparkItem(element: { type: "spark"; sessionId: string; spark: PersistedIdeaSpark; sparkIndex: number }): vscode.TreeItem {
        const s = element.spark as PersistedIdeaSpark;
        const idea = s.idea;
        const inputs = s.inputs;
        const avg = (idea.noveltyScore + idea.feasibilityScore + idea.impactScore) / 300; // 0-1

        const item = new vscode.TreeItem(
            `${s.isFavorite ? "⭐ " : ""}${idea.title}`,
            vscode.TreeItemCollapsibleState.None
        );

        item.description = getCollisionMethodLabel(s.collisionType);
        item.iconPath = getQualityIcon(avg);
        item.tooltip = new vscode.MarkdownString(
            `### ${idea.title}\n\n` +
            `${idea.description.substring(0, 200)}${idea.description.length > 200 ? "..." : ""}\n\n` +
            `**评分(新/可/影响)**: ${idea.noveltyScore}% / ${idea.feasibilityScore}% / ${idea.impactScore}%\n\n` +
            `**方法**: ${getCollisionMethodLabel(s.collisionType)}\n\n` +
            `**概念**: ${[inputs.concept1, inputs.concept2, inputs.concept3].filter(Boolean).map(c => c?.concept || c?.sourceTitle).join(" + ")}\n\n` +
            `*点击查看详情*`
        );
        item.contextValue = s.isFavorite ? "ideaSpark.spark.favorite" : "ideaSpark.spark";
        item.command = {
            command: "issueManager.ideaSpark.viewSpark",
            title: "查看创意",
            arguments: [element],
        };
        return item;
    }

    private createHeaderItem(element: { type: "header"; label: string }): vscode.TreeItem {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        item.contextValue = "ideaSpark.header";
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
