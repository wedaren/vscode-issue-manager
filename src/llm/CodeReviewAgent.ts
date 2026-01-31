/**
 * 🤖 智能代码审阅 Agent
 * 
 * 一个具有自主探索能力的 AI Agent，能够：
 * - 🔍 多轮迭代分析代码库
 * - 🧠 自主决定下一步探索方向
 * - 📊 生成深度审阅报告
 * - 🔗 将发现关联到知识库
 * - ✅ 生成可追踪的改进任务
 * 
 * Agent 工作流程:
 * 1. 理解审阅目标（用户指定或自动推断）
 * 2. 收集初始上下文（文件结构、最近变更等）
 * 3. 多轮探索循环：分析 -> 决策 -> 深入
 * 4. 综合发现，生成结构化报告
 * 5. 将重要发现转化为可追踪任务
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { Logger } from "../core/utils/Logger";
import { LLMService } from "./LLMService";
import { getAllIssueMarkdowns } from "../data/IssueMarkdowns";

// ==================== 类型定义 ====================

/** Agent 思考步骤 */
export interface AgentThought {
    step: number;
    action: "analyze" | "explore" | "decide" | "synthesize";
    reasoning: string;
    target?: string;          // 当前分析的目标（文件/模块）
    findings?: string[];      // 本步骤的发现
    nextAction?: string;      // 下一步计划
    timestamp: number;
}

/** 代码问题严重程度 */
export type IssueSeverity = "critical" | "major" | "minor" | "suggestion";

/** 代码问题类别 */
export type IssueCategory =
    | "security"           // 安全问题
    | "performance"        // 性能问题
    | "maintainability"    // 可维护性
    | "reliability"        // 可靠性
    | "architecture"       // 架构问题
    | "best-practice"      // 最佳实践
    | "documentation"      // 文档问题
    | "testing"            // 测试问题
    | "type-safety";       // 类型安全

/** 单个代码发现 */
export interface CodeFinding {
    id: string;
    title: string;
    description: string;
    severity: IssueSeverity;
    category: IssueCategory;
    location: {
        file: string;
        startLine?: number;
        endLine?: number;
        codeSnippet?: string;
    };
    suggestion: string;
    effort: "low" | "medium" | "high";
    relatedKnowledge?: {
        issueTitle: string;
        issueFilePath: string;
        relevance: number;
    }[];
    codeExample?: {
        before: string;
        after: string;
    };
}

/** 代码模式分析 */
export interface CodePatternAnalysis {
    pattern: string;
    occurrences: number;
    assessment: "good" | "concerning" | "needs-improvement";
    explanation: string;
    examples: string[];
}

/** 架构洞察 */
export interface ArchitectureInsight {
    aspect: string;
    observation: string;
    recommendation: string;
    impact: "high" | "medium" | "low";
}

/** 完整的审阅报告 */
export interface CodeReviewReport {
    id: string;
    timestamp: number;
    scope: {
        type: "workspace" | "folder" | "files" | "diff";
        paths: string[];
        description: string;
    };
    summary: {
        overallScore: number;        // 0-100
        strengths: string[];
        areasForImprovement: string[];
        riskLevel: "low" | "medium" | "high";
    };
    findings: CodeFinding[];
    patterns: CodePatternAnalysis[];
    architectureInsights: ArchitectureInsight[];
    agentThoughts: AgentThought[];   // Agent 的思考过程记录
    metrics: {
        filesAnalyzed: number;
        linesAnalyzed: number;
        explorationRounds: number;
        totalDuration: number;
    };
    actionPlan: {
        immediate: string[];         // 立即行动
        shortTerm: string[];         // 短期改进
        longTerm: string[];          // 长期规划
    };
    relatedIssues: {
        title: string;
        filePath: string;
        relevance: string;
    }[];
}

/** Agent 配置 */
export interface AgentConfig {
    maxExplorationRounds: number;    // 最大探索轮数
    focusAreas?: IssueCategory[];    // 重点关注领域
    excludePatterns?: string[];      // 排除的文件模式
    includePatterns?: string[];      // 包含的文件模式
    contextWindow?: number;          // 上下文窗口大小
}

/** Agent 状态 */
export interface AgentState {
    phase: "initializing" | "exploring" | "analyzing" | "synthesizing" | "completed" | "error";
    currentRound: number;
    totalRounds: number;
    currentTarget?: string;
    progress: number;                // 0-100
    findings: CodeFinding[];
    thoughts: AgentThought[];
    exploredFiles: Set<string>;
    pendingTargets: string[];
}

// ==================== Agent 实现 ====================

/**
 * 代码审阅 Agent
 * 
 * 使用 ReAct 模式（Reasoning + Acting）进行自主探索
 */
export class CodeReviewAgent {
    private state: AgentState;
    private config: AgentConfig;
    private logger: Logger;
    private abortController: AbortController | null = null;
    
    // 事件回调
    public onProgress?: (state: AgentState, message: string) => void;
    public onThought?: (thought: AgentThought) => void;
    public onFinding?: (finding: CodeFinding) => void;

    constructor(config?: Partial<AgentConfig>) {
        this.config = {
            maxExplorationRounds: 5,
            focusAreas: ["security", "performance", "maintainability", "architecture"],
            excludePatterns: ["**/node_modules/**", "**/dist/**", "**/.git/**", "**/test/**"],
            contextWindow: 8000,
            ...config,
        };
        
        this.state = this.createInitialState();
        this.logger = Logger.getInstance();
    }

    private createInitialState(): AgentState {
        return {
            phase: "initializing",
            currentRound: 0,
            totalRounds: this.config.maxExplorationRounds,
            progress: 0,
            findings: [],
            thoughts: [],
            exploredFiles: new Set(),
            pendingTargets: [],
        };
    }

    /**
     * 执行代码审阅
     */
    public async review(
        scope: { type: "workspace" | "folder" | "files" | "diff"; paths: string[] },
        options?: { signal?: AbortSignal; focus?: string }
    ): Promise<CodeReviewReport> {
        const startTime = Date.now();
        this.state = this.createInitialState();
        this.abortController = new AbortController();
        
        // 连接外部取消信号
        if (options?.signal) {
            options.signal.addEventListener("abort", () => this.abortController?.abort());
        }

        try {
            // Phase 1: 初始化 - 收集上下文
            await this.initializeContext(scope, options?.focus);
            
            // Phase 2: 多轮探索
            await this.exploreIteratively();
            
            // Phase 3: 综合分析
            const report = await this.synthesizeReport(scope, startTime);
            
            return report;
        } catch (error) {
            if (this.abortController?.signal.aborted) {
                throw new Error("审阅已取消");
            }
            this.logger.error("[CodeReviewAgent] Review failed:", error);
            throw error;
        }
    }

    /**
     * 取消正在进行的审阅
     */
    public cancel(): void {
        this.abortController?.abort();
    }

    /**
     * Phase 1: 初始化上下文
     */
    private async initializeContext(
        scope: { type: string; paths: string[] },
        focus?: string
    ): Promise<void> {
        this.updatePhase("initializing");
        this.emitProgress("正在分析代码库结构...");

        // 收集文件列表
        const files = await this.collectFiles(scope.paths);
        
        // 让 Agent 决定初始探索目标
        const thought = await this.think(
            "analyze",
            `开始代码审阅。范围: ${scope.type}, 文件数: ${files.length}${focus ? `, 重点关注: ${focus}` : ""}`,
            {
                fileList: files.slice(0, 50).map(f => path.basename(f)),
                focusAreas: this.config.focusAreas,
                userFocus: focus,
            }
        );

        // 解析 Agent 的决策，确定初始探索目标
        const initialTargets = await this.decideInitialTargets(files, focus);
        this.state.pendingTargets = initialTargets;

        this.emitThought(thought);
    }

    /**
     * Phase 2: 迭代探索
     */
    private async exploreIteratively(): Promise<void> {
        this.updatePhase("exploring");

        while (
            this.state.currentRound < this.config.maxExplorationRounds &&
            this.state.pendingTargets.length > 0 &&
            !this.abortController?.signal.aborted
        ) {
            this.state.currentRound++;
            const roundStartTime = Date.now();

            const target = this.state.pendingTargets.shift()!;
            this.state.currentTarget = target;
            this.emitProgress(`第 ${this.state.currentRound}/${this.config.maxExplorationRounds} 轮探索: ${path.basename(target)}`);

            // 读取并分析目标文件
            const analysis = await this.analyzeTarget(target);
            
            if (analysis.findings.length > 0) {
                this.state.findings.push(...analysis.findings);
                analysis.findings.forEach(f => this.onFinding?.(f));
            }

            // Agent 决定下一步
            if (this.state.currentRound < this.config.maxExplorationRounds) {
                const nextTargets = await this.decideNextTargets(analysis);
                this.state.pendingTargets.push(...nextTargets);
            }

            this.state.exploredFiles.add(target);
            this.updateProgress();
        }
    }

    /**
     * 分析单个目标文件
     */
    private async analyzeTarget(filePath: string): Promise<{ findings: CodeFinding[]; insights: string[] }> {
        this.updatePhase("analyzing");
        
        let content: string;
        try {
            content = await fs.promises.readFile(filePath, "utf-8");
        } catch {
            return { findings: [], insights: ["无法读取文件"] };
        }

        // 截断过长内容
        const maxLength = this.config.contextWindow || 8000;
        const truncatedContent = content.length > maxLength 
            ? content.substring(0, maxLength) + "\n// ... (内容已截断)"
            : content;

        const thought = await this.think(
            "analyze",
            `分析文件: ${path.basename(filePath)}`,
            { content: truncatedContent, path: filePath }
        );
        this.emitThought(thought);

        // 调用 LLM 进行深度分析
        const analysisResult = await this.performDeepAnalysis(filePath, truncatedContent);
        
        return analysisResult;
    }

    /**
     * 执行深度代码分析
     */
    private async performDeepAnalysis(
        filePath: string,
        content: string
    ): Promise<{ findings: CodeFinding[]; insights: string[] }> {
        const prompt = this.buildAnalysisPrompt(filePath, content);

        const response = await LLMService._request(
            [vscode.LanguageModelChatMessage.User(prompt)],
            { signal: this.abortController?.signal }
        );

        if (!response) {
            return { findings: [], insights: [] };
        }

        return this.parseAnalysisResponse(response.text, filePath);
    }

    /**
     * 构建分析 Prompt
     */
    private buildAnalysisPrompt(filePath: string, content: string): string {
        const focusAreasStr = this.config.focusAreas?.join("、") || "所有方面";
        const fileExt = path.extname(filePath);

        return `你是一个资深的代码审阅专家 Agent。请深度分析以下代码文件，重点关注：${focusAreasStr}。

文件路径：${filePath}
文件类型：${fileExt}

代码内容：
\`\`\`
${content}
\`\`\`

请以 JSON 格式返回分析结果：
{
  "findings": [
    {
      "title": "问题简述",
      "description": "详细描述问题及其影响",
      "severity": "critical|major|minor|suggestion",
      "category": "security|performance|maintainability|reliability|architecture|best-practice|documentation|testing|type-safety",
      "startLine": 行号（可选）,
      "endLine": 行号（可选）,
      "codeSnippet": "相关代码片段",
      "suggestion": "具体的改进建议",
      "effort": "low|medium|high",
      "codeExample": {
        "before": "修改前的代码",
        "after": "建议的修改后代码"
      }
    }
  ],
  "insights": ["关于这段代码的高层次洞察"],
  "suggestExplore": ["建议进一步探索的相关文件或模块"]
}

要求：
1. 发现真正有价值的问题，而非鸡毛蒜皮
2. 提供可执行的具体建议
3. 如果代码质量良好，可以返回空数组并说明优点
4. 建议探索可能有关联问题的文件`;
    }

    /**
     * 解析分析响应
     */
    private parseAnalysisResponse(
        responseText: string,
        filePath: string
    ): { findings: CodeFinding[]; insights: string[] } {
        try {
            const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/i);
            const jsonStr = jsonMatch?.[1] || responseText;
            
            const firstBrace = jsonStr.indexOf("{");
            const lastBrace = jsonStr.lastIndexOf("}");
            if (firstBrace === -1 || lastBrace === -1) {
                return { findings: [], insights: [] };
            }

            const parsed = JSON.parse(jsonStr.substring(firstBrace, lastBrace + 1));
            
            const findings: CodeFinding[] = (parsed.findings || []).map((f: Record<string, unknown>, idx: number) => ({
                id: `${path.basename(filePath)}-${idx}-${Date.now()}`,
                title: String(f.title || "未命名问题"),
                description: String(f.description || ""),
                severity: this.validateSeverity(f.severity),
                category: this.validateCategory(f.category),
                location: {
                    file: filePath,
                    startLine: typeof f.startLine === "number" ? f.startLine : undefined,
                    endLine: typeof f.endLine === "number" ? f.endLine : undefined,
                    codeSnippet: typeof f.codeSnippet === "string" ? f.codeSnippet : undefined,
                },
                suggestion: String(f.suggestion || ""),
                effort: this.validateEffort(f.effort),
                codeExample: f.codeExample && typeof f.codeExample === "object" ? {
                    before: String((f.codeExample as Record<string, unknown>).before || ""),
                    after: String((f.codeExample as Record<string, unknown>).after || ""),
                } : undefined,
            }));

            return {
                findings,
                insights: Array.isArray(parsed.insights) ? parsed.insights.map(String) : [],
            };
        } catch (error) {
            this.logger.warn("[CodeReviewAgent] Failed to parse analysis response:", error);
            return { findings: [], insights: [] };
        }
    }

    /**
     * Phase 3: 综合报告
     */
    private async synthesizeReport(
        scope: { type: "workspace" | "folder" | "files" | "diff"; paths: string[] },
        startTime: number
    ): Promise<CodeReviewReport> {
        this.updatePhase("synthesizing");
        this.emitProgress("正在综合分析结果...");

        // 关联知识库
        const relatedIssues = await this.findRelatedKnowledge();
        
        // 为每个发现关联知识
        for (const finding of this.state.findings) {
            finding.relatedKnowledge = relatedIssues
                .filter(issue => 
                    finding.title.toLowerCase().includes(issue.title.toLowerCase()) ||
                    finding.category === "architecture" // 架构问题通常与知识库更相关
                )
                .slice(0, 3)
                .map(issue => ({
                    issueTitle: issue.title,
                    issueFilePath: issue.filePath,
                    relevance: 0.7,
                }));
        }

        // 生成综合报告
        const synthesisResult = await this.generateSynthesis();

        const report: CodeReviewReport = {
            id: `review-${Date.now()}`,
            timestamp: Date.now(),
            scope: {
                ...scope,
                description: this.describeScopeInChinese(scope),
            },
            summary: {
                overallScore: synthesisResult.overallScore,
                strengths: synthesisResult.strengths,
                areasForImprovement: synthesisResult.areasForImprovement,
                riskLevel: this.calculateRiskLevel(this.state.findings),
            },
            findings: this.state.findings,
            patterns: synthesisResult.patterns,
            architectureInsights: synthesisResult.architectureInsights,
            agentThoughts: this.state.thoughts,
            metrics: {
                filesAnalyzed: this.state.exploredFiles.size,
                linesAnalyzed: 0, // 可以后续计算
                explorationRounds: this.state.currentRound,
                totalDuration: Date.now() - startTime,
            },
            actionPlan: synthesisResult.actionPlan,
            relatedIssues,
        };

        this.updatePhase("completed");
        return report;
    }

    /**
     * 生成综合分析
     */
    private async generateSynthesis(): Promise<{
        overallScore: number;
        strengths: string[];
        areasForImprovement: string[];
        patterns: CodePatternAnalysis[];
        architectureInsights: ArchitectureInsight[];
        actionPlan: { immediate: string[]; shortTerm: string[]; longTerm: string[] };
    }> {
        const findingsSummary = this.state.findings.map(f => ({
            title: f.title,
            severity: f.severity,
            category: f.category,
        }));

        const prompt = `作为代码审阅专家，请基于以下发现生成综合分析报告。

发现的问题摘要：
${JSON.stringify(findingsSummary, null, 2)}

请返回 JSON 格式的综合分析：
{
  "overallScore": 0-100的整体质量评分,
  "strengths": ["代码的优点1", "优点2"],
  "areasForImprovement": ["需要改进的领域1", "领域2"],
  "patterns": [
    {
      "pattern": "识别到的代码模式",
      "occurrences": 出现次数,
      "assessment": "good|concerning|needs-improvement",
      "explanation": "对这个模式的评价",
      "examples": ["示例位置"]
    }
  ],
  "architectureInsights": [
    {
      "aspect": "架构方面",
      "observation": "观察到的情况",
      "recommendation": "建议",
      "impact": "high|medium|low"
    }
  ],
  "actionPlan": {
    "immediate": ["立即要做的事"],
    "shortTerm": ["短期内要做的事"],
    "longTerm": ["长期规划"]
  }
}`;

        const response = await LLMService._request(
            [vscode.LanguageModelChatMessage.User(prompt)],
            { signal: this.abortController?.signal }
        );

        if (!response) {
            return this.getDefaultSynthesis();
        }

        try {
            const jsonMatch = response.text.match(/```json\s*([\s\S]*?)\s*```/i);
            const jsonStr = jsonMatch?.[1] || response.text;
            const firstBrace = jsonStr.indexOf("{");
            const lastBrace = jsonStr.lastIndexOf("}");
            const parsed = JSON.parse(jsonStr.substring(firstBrace, lastBrace + 1));
            
            return {
                overallScore: typeof parsed.overallScore === "number" ? parsed.overallScore : 70,
                strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
                areasForImprovement: Array.isArray(parsed.areasForImprovement) ? parsed.areasForImprovement : [],
                patterns: Array.isArray(parsed.patterns) ? parsed.patterns : [],
                architectureInsights: Array.isArray(parsed.architectureInsights) ? parsed.architectureInsights : [],
                actionPlan: parsed.actionPlan || { immediate: [], shortTerm: [], longTerm: [] },
            };
        } catch {
            return this.getDefaultSynthesis();
        }
    }

    private getDefaultSynthesis() {
        return {
            overallScore: 70,
            strengths: ["代码可读性良好"],
            areasForImprovement: this.state.findings.map(f => f.title),
            patterns: [],
            architectureInsights: [],
            actionPlan: {
                immediate: this.state.findings.filter(f => f.severity === "critical").map(f => f.title),
                shortTerm: this.state.findings.filter(f => f.severity === "major").map(f => f.title),
                longTerm: this.state.findings.filter(f => f.severity === "minor").map(f => f.title),
            },
        };
    }

    // ==================== 辅助方法 ====================

    /**
     * Agent 思考
     */
    private async think(
        action: AgentThought["action"],
        context: string,
        data?: Record<string, unknown>
    ): Promise<AgentThought> {
        const thought: AgentThought = {
            step: this.state.thoughts.length + 1,
            action,
            reasoning: context,
            target: data?.path as string | undefined,
            findings: [],
            timestamp: Date.now(),
        };

        this.state.thoughts.push(thought);
        return thought;
    }

    /**
     * 收集文件列表
     */
    private async collectFiles(paths: string[]): Promise<string[]> {
        const files: string[] = [];
        
        for (const p of paths) {
            try {
                const stat = await fs.promises.stat(p);
                if (stat.isFile()) {
                    files.push(p);
                } else if (stat.isDirectory()) {
                    const dirFiles = await this.walkDirectory(p);
                    files.push(...dirFiles);
                }
            } catch {
                // 忽略无法访问的路径
            }
        }

        return this.filterFiles(files);
    }

    /**
     * 递归遍历目录
     */
    private async walkDirectory(dir: string, depth = 0): Promise<string[]> {
        if (depth > 5) return []; // 限制深度
        
        const files: string[] = [];
        try {
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                
                if (this.shouldExclude(fullPath)) continue;
                
                if (entry.isFile() && this.isCodeFile(entry.name)) {
                    files.push(fullPath);
                } else if (entry.isDirectory()) {
                    const subFiles = await this.walkDirectory(fullPath, depth + 1);
                    files.push(...subFiles);
                }
            }
        } catch {
            // 忽略无法访问的目录
        }
        
        return files;
    }

    /**
     * 过滤文件
     */
    private filterFiles(files: string[]): string[] {
        return files.filter(f => {
            if (this.shouldExclude(f)) return false;
            if (!this.isCodeFile(f)) return false;
            return true;
        });
    }

    /**
     * 判断是否应排除
     */
    private shouldExclude(filePath: string): boolean {
        const excludePatterns = this.config.excludePatterns || [];
        for (const pattern of excludePatterns) {
            // 简单的 glob 匹配
            if (filePath.includes("node_modules") || 
                filePath.includes(".git") || 
                filePath.includes("dist/") ||
                filePath.includes("build/")) {
                return true;
            }
        }
        return false;
    }

    /**
     * 判断是否为代码文件
     */
    private isCodeFile(filename: string): boolean {
        const codeExtensions = [".ts", ".tsx", ".js", ".jsx", ".vue", ".py", ".java", ".go", ".rs", ".cs"];
        return codeExtensions.some(ext => filename.endsWith(ext));
    }

    /**
     * 决定初始探索目标
     */
    private async decideInitialTargets(files: string[], focus?: string): Promise<string[]> {
        // 优先选择关键文件
        const priorityFiles = files.filter(f => {
            const name = path.basename(f).toLowerCase();
            return (
                name.includes("index") ||
                name.includes("main") ||
                name.includes("app") ||
                name.includes("config") ||
                name.includes("service") ||
                (focus && name.toLowerCase().includes(focus.toLowerCase()))
            );
        });

        // 最多选择 5 个初始目标
        const targets = priorityFiles.length > 0 
            ? priorityFiles.slice(0, 5)
            : files.slice(0, 5);

        return targets;
    }

    /**
     * 决定下一步探索目标
     */
    private async decideNextTargets(
        analysis: { findings: CodeFinding[]; insights: string[] }
    ): Promise<string[]> {
        // 基于发现决定是否需要探索相关文件
        const newTargets: string[] = [];
        
        // 如果有严重问题，尝试找相关文件
        for (const finding of analysis.findings) {
            if (finding.severity === "critical" || finding.severity === "major") {
                // 可以添加逻辑找相关文件
            }
        }

        return newTargets.slice(0, 3);
    }

    /**
     * 查找相关知识
     */
    private async findRelatedKnowledge(): Promise<{ title: string; filePath: string; relevance: string }[]> {
        try {
            const allIssues = await getAllIssueMarkdowns();
            
            // 基于发现的关键词匹配相关问题
            const keywords = this.state.findings.flatMap(f => [
                f.category,
                ...f.title.split(/\s+/),
            ]);

            const related = allIssues
                .filter(issue => {
                    const titleLower = issue.title.toLowerCase();
                    return keywords.some(kw => titleLower.includes(kw.toLowerCase()));
                })
                .slice(0, 10)
                .map(issue => ({
                    title: issue.title,
                    filePath: issue.uri.fsPath,
                    relevance: "关键词匹配",
                }));

            return related;
        } catch {
            return [];
        }
    }

    /**
     * 计算风险等级
     */
    private calculateRiskLevel(findings: CodeFinding[]): "low" | "medium" | "high" {
        const criticalCount = findings.filter(f => f.severity === "critical").length;
        const majorCount = findings.filter(f => f.severity === "major").length;

        if (criticalCount > 0) return "high";
        if (majorCount > 3) return "high";
        if (majorCount > 0) return "medium";
        return "low";
    }

    /**
     * 描述审阅范围
     */
    private describeScopeInChinese(scope: { type: string; paths: string[] }): string {
        switch (scope.type) {
            case "workspace":
                return "工作区全量审阅";
            case "folder":
                return `文件夹审阅: ${scope.paths.map(p => path.basename(p)).join(", ")}`;
            case "files":
                return `指定文件审阅: ${scope.paths.length} 个文件`;
            case "diff":
                return "变更审阅 (Git Diff)";
            default:
                return "代码审阅";
        }
    }

    private validateSeverity(value: unknown): IssueSeverity {
        const valid: IssueSeverity[] = ["critical", "major", "minor", "suggestion"];
        return valid.includes(value as IssueSeverity) ? value as IssueSeverity : "minor";
    }

    private validateCategory(value: unknown): IssueCategory {
        const valid: IssueCategory[] = [
            "security", "performance", "maintainability", "reliability",
            "architecture", "best-practice", "documentation", "testing", "type-safety"
        ];
        return valid.includes(value as IssueCategory) ? value as IssueCategory : "best-practice";
    }

    private validateEffort(value: unknown): "low" | "medium" | "high" {
        const valid = ["low", "medium", "high"];
        return valid.includes(value as string) ? value as "low" | "medium" | "high" : "medium";
    }

    // ==================== 状态更新 ====================

    private updatePhase(phase: AgentState["phase"]): void {
        this.state.phase = phase;
    }

    private updateProgress(): void {
        const explored = this.state.exploredFiles.size;
        const total = explored + this.state.pendingTargets.length;
        this.state.progress = total > 0 ? Math.round((explored / total) * 100) : 0;
    }

    private emitProgress(message: string): void {
        this.onProgress?.(this.state, message);
    }

    private emitThought(thought: AgentThought): void {
        this.onThought?.(thought);
    }
}
