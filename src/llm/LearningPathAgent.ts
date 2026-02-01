/**
 * 🎯 学习路径 Agent (Learning Path Agent)
 * 
 * 一个令人惊叹的 LLM + Agent 组合功能！
 * 
 * 核心能力：
 * - 🎯 理解用户的学习目标（想学什么/想解决什么问题）
 * - 🗺️ 分析知识库中的知识结构和依赖关系
 * - 📚 自动生成个性化的学习路径
 * - ✅ 追踪学习进度
 * - 🔄 根据学习反馈动态调整路径
 * 
 * Agent 工作流程:
 * 1. 理解用户学习目标
 * 2. 扫描知识库，提取相关知识点
 * 3. 分析知识点之间的前置依赖关系
 * 4. 生成最优学习顺序
 * 5. 估算每个阶段的学习时间
 * 6. 生成学习计划和里程碑
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { Logger } from "../core/utils/Logger";
import { LLMService } from "./LLMService";
import { getAllIssueMarkdowns } from "../data/IssueMarkdowns";
import { getIssueDir } from "../config";

// ==================== 类型定义 ====================

/** 学习节点 */
export interface LearningNode {
    id: string;
    filePath: string;
    title: string;
    summary: string;              // 内容摘要
    difficulty: "beginner" | "intermediate" | "advanced";
    estimatedTime: number;        // 预计学习时间（分钟）
    prerequisites: string[];      // 前置知识节点 ID
    skills: string[];             // 学完后掌握的技能
    keyTakeaways: string[];       // 关键要点
}

/** 学习阶段 */
export interface LearningStage {
    id: string;
    name: string;
    description: string;
    nodes: LearningNode[];
    milestone: string;            // 阶段里程碑
    checkQuestions: string[];     // 检验问题
    estimatedDuration: number;    // 预计时长（分钟）
}

/** 学习路径 */
export interface LearningPath {
    id: string;
    timestamp: number;
    goal: string;                 // 学习目标
    targetAudience: string;       // 目标受众
    stages: LearningStage[];
    totalNodes: number;
    totalDuration: number;        // 总预计时长
    difficultyProgression: {
        beginner: number;
        intermediate: number;
        advanced: number;
    };
    learningOutcomes: string[];   // 学习成果
    suggestedSchedule: {
        daysPerWeek: number;
        hoursPerDay: number;
        totalWeeks: number;
    };
}

/** 学习进度 */
export interface LearningProgress {
    pathId: string;
    currentStageIndex: number;
    completedNodes: Set<string>;
    startedAt: number;
    lastActivityAt: number;
    timeSpent: number;            // 已花费时间（分钟）
    notes: { nodeId: string; note: string }[];
}

/** Agent 配置 */
export interface LearningAgentConfig {
    maxNodesPerPath: number;      // 单条路径最大节点数
    preferredDifficulty?: "beginner" | "intermediate" | "advanced";
    availableTimePerWeek?: number; // 每周可用学习时间（小时）
    includeExternalResources?: boolean;
}

/** Agent 思考步骤 */
export interface LearningAgentThought {
    step: number;
    action: "understand" | "scan" | "analyze" | "order" | "plan" | "optimize";
    reasoning: string;
    data?: unknown;
    timestamp: number;
}

/** Agent 状态 */
export interface LearningAgentState {
    phase: "understanding" | "scanning" | "analyzing" | "ordering" | "planning" | "optimizing" | "completed" | "error";
    progress: number;
    thoughts: LearningAgentThought[];
    candidateNodes: LearningNode[];
    selectedNodes: LearningNode[];
}

// ==================== Agent 实现 ====================

/**
 * 学习路径 Agent
 * 
 * 基于知识库内容，为用户生成个性化的学习路径
 */
export class LearningPathAgent {
    private state: LearningAgentState;
    private config: LearningAgentConfig;
    private logger: Logger;
    private abortController: AbortController | null = null;

    // 事件回调
    public onProgress?: (state: LearningAgentState, message: string) => void;
    public onThought?: (thought: LearningAgentThought) => void;

    constructor(config?: Partial<LearningAgentConfig>) {
        this.config = {
            maxNodesPerPath: 20,
            availableTimePerWeek: 10,
            includeExternalResources: false,
            ...config,
        };

        this.state = this.createInitialState();
        this.logger = Logger.getInstance();
    }

    private createInitialState(): LearningAgentState {
        return {
            phase: "understanding",
            progress: 0,
            thoughts: [],
            candidateNodes: [],
            selectedNodes: [],
        };
    }

    /**
     * 生成学习路径
     */
    public async generatePath(
        goal: string,
        options?: { signal?: AbortSignal; context?: string }
    ): Promise<LearningPath> {
        const startTime = Date.now();
        this.state = this.createInitialState();
        this.abortController = new AbortController();

        if (options?.signal) {
            options.signal.addEventListener("abort", () => this.abortController?.abort());
        }

        try {
            // Phase 1: 理解学习目标
            const goalAnalysis = await this.understandGoal(goal, options?.context);

            // Phase 2: 扫描知识库
            await this.scanKnowledgeBase(goalAnalysis);

            // Phase 3: 分析前置依赖
            await this.analyzeDependencies();

            // Phase 4: 确定学习顺序
            await this.determineOrder();

            // Phase 5: 生成学习计划
            const path = await this.generatePlan(goal, goalAnalysis);

            return path;
        } catch (error) {
            if (this.abortController?.signal.aborted) {
                throw new Error("生成已取消");
            }
            this.logger.error("[LearningPathAgent] Generation failed:", error);
            throw error;
        }
    }

    /**
     * 取消生成
     */
    public cancel(): void {
        this.abortController?.abort();
    }

    /**
     * Phase 1: 理解学习目标
     */
    private async understandGoal(goal: string, context?: string): Promise<{
        refinedGoal: string;
        targetSkills: string[];
        priorKnowledge: string[];
        learningStyle: string;
        targetAudience: string;
    }> {
        this.updatePhase("understanding");
        this.emitProgress("正在理解您的学习目标...");

        const prompt = `你是一个学习规划专家。请分析以下学习目标，提取关键信息。

学习目标: "${goal}"
${context ? `补充说明: ${context}` : ""}

请以 JSON 格式返回：
{
  "refinedGoal": "精炼后的学习目标（更具体、可衡量）",
  "targetSkills": ["需要掌握的技能1", "技能2", "技能3"],
  "priorKnowledge": ["可能需要的前置知识1", "前置知识2"],
  "learningStyle": "推荐的学习方式（如：理论先行/实践驱动/案例学习）",
  "targetAudience": "目标受众描述"
}`;

        try {
            const response = await LLMService._request(
                [vscode.LanguageModelChatMessage.User(prompt)],
                { signal: this.abortController?.signal }
            );

            if (response) {
                const result = this.parseJsonObject(response.text);
                
                const thought = this.recordThought(
                    "understand",
                    `理解目标: ${result.refinedGoal || goal}\n目标技能: ${(result.targetSkills as string[] || []).join(", ")}`
                );
                this.emitThought(thought);

                return {
                    refinedGoal: (result.refinedGoal as string) || goal,
                    targetSkills: (result.targetSkills as string[]) || [],
                    priorKnowledge: (result.priorKnowledge as string[]) || [],
                    learningStyle: (result.learningStyle as string) || "理论与实践结合",
                    targetAudience: (result.targetAudience as string) || "通用",
                };
            }
        } catch (error) {
            this.logger.warn("[LearningPathAgent] Goal understanding failed:", error);
        }

        return {
            refinedGoal: goal,
            targetSkills: [],
            priorKnowledge: [],
            learningStyle: "理论与实践结合",
            targetAudience: "通用",
        };
    }

    /**
     * Phase 2: 扫描知识库
     */
    private async scanKnowledgeBase(goalAnalysis: {
        refinedGoal: string;
        targetSkills: string[];
    }): Promise<void> {
        this.updatePhase("scanning");
        this.emitProgress("正在扫描知识库中的相关内容...");

        const issues = await getAllIssueMarkdowns();

        // 批量分析相关性
        const batchSize = 10;
        const allCandidates: LearningNode[] = [];

        for (let i = 0; i < issues.length; i += batchSize) {
            if (this.abortController?.signal.aborted) {break;}

            const batch = issues.slice(i, i + batchSize);
            const candidates = await this.analyzeBatchRelevance(
                batch,
                goalAnalysis.refinedGoal,
                goalAnalysis.targetSkills
            );
            allCandidates.push(...candidates);

            this.updateProgress(10 + Math.floor((i / issues.length) * 30));
        }

        // 按相关性排序，选择 top N
        this.state.candidateNodes = allCandidates.slice(0, this.config.maxNodesPerPath);

        const thought = this.recordThought(
            "scan",
            `从 ${issues.length} 个知识点中筛选出 ${this.state.candidateNodes.length} 个相关内容`
        );
        this.emitThought(thought);

        this.updateProgress(40);
    }

    /**
     * 批量分析相关性
     */
    private async analyzeBatchRelevance(
        issues: { uri: vscode.Uri; title: string }[],
        goal: string,
        targetSkills: string[]
    ): Promise<LearningNode[]> {
        // 读取内容
        const issuesWithContent = await Promise.all(
            issues.map(async (issue) => {
                try {
                    const content = await fs.promises.readFile(issue.uri.fsPath, "utf-8");
                    return {
                        ...issue,
                        content: content.substring(0, 800),
                    };
                } catch {
                    return { ...issue, content: "" };
                }
            })
        );

        const prompt = `你是一个学习规划专家。请分析以下知识点与学习目标的相关性。

学习目标: "${goal}"
目标技能: ${targetSkills.join(", ")}

知识点列表：
${issuesWithContent.map((i, idx) => `${idx + 1}. 标题: ${i.title}
   内容摘要: ${i.content.substring(0, 300)}...`).join("\n\n")}

请对每个知识点评估：
1. 是否与学习目标相关（相关性 > 0.5 才纳入）
2. 难度级别
3. 预计学习时间
4. 学完后能掌握的技能
5. 关键要点

返回 JSON 数组（只返回相关的）：
[
  {
    "index": 1,
    "relevance": 0.8,
    "difficulty": "beginner|intermediate|advanced",
    "estimatedTime": 30,
    "skills": ["技能1", "技能2"],
    "keyTakeaways": ["要点1", "要点2"],
    "summary": "简短摘要"
  }
]`;

        try {
            const response = await LLMService._request(
                [vscode.LanguageModelChatMessage.User(prompt)],
                { signal: this.abortController?.signal }
            );

            if (!response) {return [];}

            const results = this.parseJsonArray(response.text);
            const candidates: LearningNode[] = [];

            for (const result of results) {
                if ((result.relevance as number) < 0.5) {continue;}

                const idx = (result.index as number) - 1;
                if (idx < 0 || idx >= issuesWithContent.length) {continue;}

                const issue = issuesWithContent[idx];
                candidates.push({
                    id: path.basename(issue.uri.fsPath),
                    filePath: issue.uri.fsPath,
                    title: issue.title,
                    summary: (result.summary as string) || "",
                    difficulty: (result.difficulty as LearningNode["difficulty"]) || "intermediate",
                    estimatedTime: (result.estimatedTime as number) || 30,
                    prerequisites: [],
                    skills: (result.skills as string[]) || [],
                    keyTakeaways: (result.keyTakeaways as string[]) || [],
                });
            }

            return candidates;
        } catch (error) {
            this.logger.warn("[LearningPathAgent] Relevance analysis failed:", error);
            return [];
        }
    }

    /**
     * Phase 3: 分析前置依赖
     */
    private async analyzeDependencies(): Promise<void> {
        this.updatePhase("analyzing");
        this.emitProgress("正在分析知识点之间的依赖关系...");

        if (this.state.candidateNodes.length === 0) {
            return;
        }

        const nodeList = this.state.candidateNodes.map(n => 
            `- ${n.id}: "${n.title}" (${n.difficulty}) - 技能: ${n.skills.join(", ")}`
        ).join("\n");

        const prompt = `你是一个学习规划专家。请分析以下知识点之间的前置依赖关系。

知识点列表：
${nodeList}

请分析：学习哪个知识点之前，应该先学习哪些其他知识点？

返回 JSON 格式：
{
  "dependencies": [
    {
      "nodeId": "知识点ID",
      "prerequisites": ["前置知识点ID1", "前置知识点ID2"]
    }
  ]
}

注意：
1. 只返回确实存在依赖关系的
2. 避免循环依赖
3. 基础的知识点不需要前置条件`;

        try {
            const response = await LLMService._request(
                [vscode.LanguageModelChatMessage.User(prompt)],
                { signal: this.abortController?.signal }
            );

            if (response) {
                const result = this.parseJsonObject(response.text);
                const dependencies = (result.dependencies as Array<{ nodeId: string; prerequisites: string[] }>) || [];

                for (const dep of dependencies) {
                    const node = this.state.candidateNodes.find(n => n.id === dep.nodeId);
                    if (node) {
                        node.prerequisites = dep.prerequisites.filter(
                            p => this.state.candidateNodes.some(n => n.id === p)
                        );
                    }
                }

                const thought = this.recordThought(
                    "analyze",
                    `分析了 ${dependencies.length} 个知识点的前置依赖关系`
                );
                this.emitThought(thought);
            }
        } catch (error) {
            this.logger.warn("[LearningPathAgent] Dependency analysis failed:", error);
        }

        this.updateProgress(60);
    }

    /**
     * Phase 4: 确定学习顺序（拓扑排序）
     */
    private async determineOrder(): Promise<void> {
        this.updatePhase("ordering");
        this.emitProgress("正在确定最优学习顺序...");

        // 使用拓扑排序确定学习顺序
        const sorted = this.topologicalSort(this.state.candidateNodes);
        this.state.selectedNodes = sorted;

        const thought = this.recordThought(
            "order",
            `按照依赖关系排序完成，学习顺序已确定`
        );
        this.emitThought(thought);

        this.updateProgress(75);
    }

    /**
     * 拓扑排序
     */
    private topologicalSort(nodes: LearningNode[]): LearningNode[] {
        const nodeMap = new Map(nodes.map(n => [n.id, n]));
        const inDegree = new Map<string, number>();
        const adjList = new Map<string, string[]>();

        // 初始化
        for (const node of nodes) {
            inDegree.set(node.id, 0);
            adjList.set(node.id, []);
        }

        // 构建图
        for (const node of nodes) {
            for (const prereq of node.prerequisites) {
                if (nodeMap.has(prereq)) {
                    adjList.get(prereq)?.push(node.id);
                    inDegree.set(node.id, (inDegree.get(node.id) || 0) + 1);
                }
            }
        }

        // Kahn 算法
        const queue: string[] = [];
        for (const [id, degree] of inDegree) {
            if (degree === 0) {queue.push(id);}
        }

        const result: LearningNode[] = [];
        while (queue.length > 0) {
            // 按难度排序，优先处理简单的
            queue.sort((a, b) => {
                const nodeA = nodeMap.get(a)!;
                const nodeB = nodeMap.get(b)!;
                const diffOrder = { beginner: 0, intermediate: 1, advanced: 2 };
                return diffOrder[nodeA.difficulty] - diffOrder[nodeB.difficulty];
            });

            const current = queue.shift()!;
            result.push(nodeMap.get(current)!);

            for (const next of adjList.get(current) || []) {
                const newDegree = (inDegree.get(next) || 0) - 1;
                inDegree.set(next, newDegree);
                if (newDegree === 0) {
                    queue.push(next);
                }
            }
        }

        // 处理可能的循环依赖（剩余节点）
        for (const node of nodes) {
            if (!result.includes(node)) {
                result.push(node);
            }
        }

        return result;
    }

    /**
     * Phase 5: 生成学习计划
     */
    private async generatePlan(goal: string, goalAnalysis: {
        refinedGoal: string;
        targetAudience: string;
    }): Promise<LearningPath> {
        this.updatePhase("planning");
        this.emitProgress("正在生成学习计划...");

        // 将节点分组为阶段
        const stages = this.groupIntoStages(this.state.selectedNodes);

        // 请求 LLM 生成阶段描述和检验问题
        await this.enrichStages(stages, goal);

        // 计算统计
        const totalDuration = stages.reduce((sum, s) => sum + s.estimatedDuration, 0);
        const difficultyStats = this.calculateDifficultyStats(this.state.selectedNodes);

        // 计算建议的学习时间表
        const weeklyHours = this.config.availableTimePerWeek || 10;
        const totalWeeks = Math.ceil(totalDuration / 60 / weeklyHours);

        const path: LearningPath = {
            id: `lp-${Date.now()}`,
            timestamp: Date.now(),
            goal: goalAnalysis.refinedGoal,
            targetAudience: goalAnalysis.targetAudience,
            stages,
            totalNodes: this.state.selectedNodes.length,
            totalDuration,
            difficultyProgression: difficultyStats,
            learningOutcomes: this.extractLearningOutcomes(this.state.selectedNodes),
            suggestedSchedule: {
                daysPerWeek: 5,
                hoursPerDay: weeklyHours / 5,
                totalWeeks,
            },
        };

        this.updatePhase("completed");
        this.updateProgress(100);

        const thought = this.recordThought(
            "plan",
            `学习路径生成完成！共 ${stages.length} 个阶段，${path.totalNodes} 个知识点，预计 ${totalWeeks} 周完成`
        );
        this.emitThought(thought);

        return path;
    }

    /**
     * 将节点分组为学习阶段
     */
    private groupIntoStages(nodes: LearningNode[]): LearningStage[] {
        const stages: LearningStage[] = [];
        let currentStage: LearningNode[] = [];
        let currentDifficulty = "beginner";
        let stageIndex = 0;

        for (const node of nodes) {
            // 如果难度变化，或者当前阶段节点太多，开始新阶段
            if (
                (node.difficulty !== currentDifficulty && currentStage.length > 0) ||
                currentStage.length >= 5
            ) {
                stages.push(this.createStage(currentStage, stageIndex++));
                currentStage = [];
            }

            currentStage.push(node);
            currentDifficulty = node.difficulty;
        }

        // 处理最后一个阶段
        if (currentStage.length > 0) {
            stages.push(this.createStage(currentStage, stageIndex));
        }

        return stages;
    }

    private createStage(nodes: LearningNode[], index: number): LearningStage {
        const stageNames = ["入门基础", "核心概念", "进阶技巧", "深度探索", "实战应用", "高阶挑战"];
        
        return {
            id: `stage-${index}`,
            name: stageNames[index] || `阶段 ${index + 1}`,
            description: "",
            nodes,
            milestone: "",
            checkQuestions: [],
            estimatedDuration: nodes.reduce((sum, n) => sum + n.estimatedTime, 0),
        };
    }

    /**
     * 用 LLM 丰富阶段信息
     */
    private async enrichStages(stages: LearningStage[], goal: string): Promise<void> {
        const prompt = `你是一个学习规划专家。请为以下学习阶段生成描述和检验问题。

学习目标: "${goal}"

学习阶段：
${stages.map((s, i) => `${i + 1}. ${s.name} (${s.nodes.length}个知识点)
   知识点: ${s.nodes.map(n => n.title).join(", ")}`).join("\n\n")}

请为每个阶段生成：
1. 简短描述（说明这个阶段要学什么）
2. 里程碑（完成这个阶段的标志）
3. 2-3个检验问题（测试是否真正掌握了）

返回 JSON 数组：
[
  {
    "stageIndex": 0,
    "description": "阶段描述",
    "milestone": "里程碑",
    "checkQuestions": ["问题1", "问题2"]
  }
]`;

        try {
            const response = await LLMService._request(
                [vscode.LanguageModelChatMessage.User(prompt)],
                { signal: this.abortController?.signal }
            );

            if (response) {
                const results = this.parseJsonArray(response.text);
                
                for (const result of results) {
                    const idx = result.stageIndex as number;
                    if (idx >= 0 && idx < stages.length) {
                        stages[idx].description = (result.description as string) || "";
                        stages[idx].milestone = (result.milestone as string) || "";
                        stages[idx].checkQuestions = (result.checkQuestions as string[]) || [];
                    }
                }
            }
        } catch (error) {
            this.logger.warn("[LearningPathAgent] Stage enrichment failed:", error);
        }
    }

    private calculateDifficultyStats(nodes: LearningNode[]): {
        beginner: number;
        intermediate: number;
        advanced: number;
    } {
        const stats = { beginner: 0, intermediate: 0, advanced: 0 };
        for (const node of nodes) {
            stats[node.difficulty]++;
        }
        return stats;
    }

    private extractLearningOutcomes(nodes: LearningNode[]): string[] {
        const allSkills = new Set<string>();
        for (const node of nodes) {
            node.skills.forEach(s => allSkills.add(s));
        }
        return Array.from(allSkills).slice(0, 10);
    }

    // ==================== 工具方法 ====================

    private updatePhase(phase: LearningAgentState["phase"]): void {
        this.state.phase = phase;
    }

    private updateProgress(progress: number): void {
        this.state.progress = progress;
    }

    private emitProgress(message: string): void {
        this.onProgress?.(this.state, message);
    }

    private recordThought(action: LearningAgentThought["action"], reasoning: string): LearningAgentThought {
        const thought: LearningAgentThought = {
            step: this.state.thoughts.length + 1,
            action,
            reasoning,
            timestamp: Date.now(),
        };
        this.state.thoughts.push(thought);
        return thought;
    }

    private emitThought(thought: LearningAgentThought): void {
        this.onThought?.(thought);
    }

    private parseJsonArray(text: string): Array<Record<string, unknown>> {
        try {
            const match = text.match(/\[[\s\S]*\]/);
            if (match) {
                return JSON.parse(match[0]) as Array<Record<string, unknown>>;
            }
        } catch {
            this.logger.warn("[LearningPathAgent] JSON array parse failed");
        }
        return [];
    }

    private parseJsonObject(text: string): Record<string, unknown> {
        try {
            const match = text.match(/\{[\s\S]*\}/);
            if (match) {
                return JSON.parse(match[0]) as Record<string, unknown>;
            }
        } catch {
            this.logger.warn("[LearningPathAgent] JSON object parse failed");
        }
        return {};
    }
}

// ==================== 进度持久化 ====================

const PROGRESS_FILENAME = "learningProgress.json";

/**
 * 保存学习进度
 */
export function saveLearningProgress(progress: LearningProgress): void {
    const issueDir = getIssueDir();
    if (!issueDir) {return;}

    const filePath = path.join(issueDir, ".issueManager", PROGRESS_FILENAME);
    const dir = path.dirname(filePath);

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    // 读取现有进度
    let allProgress: Record<string, LearningProgress> = {};
    if (fs.existsSync(filePath)) {
        try {
            allProgress = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, LearningProgress>;
        } catch {
            // 忽略解析错误
        }
    }

    // 更新进度
    allProgress[progress.pathId] = {
        ...progress,
        completedNodes: Array.from(progress.completedNodes) as unknown as Set<string>,
    };

    fs.writeFileSync(filePath, JSON.stringify(allProgress, null, 2), "utf-8");
}

/**
 * 读取学习进度
 */
export function loadLearningProgress(pathId: string): LearningProgress | null {
    const issueDir = getIssueDir();
    if (!issueDir) {return null;}

    const filePath = path.join(issueDir, ".issueManager", PROGRESS_FILENAME);
    if (!fs.existsSync(filePath)) {return null;}

    try {
        const allProgress = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, LearningProgress>;
        const progress = allProgress[pathId];
        if (progress) {
            return {
                ...progress,
                completedNodes: new Set(progress.completedNodes as unknown as string[]),
            };
        }
    } catch {
        // 忽略解析错误
    }

    return null;
}

// ==================== 导出工具函数 ====================

/**
 * 快速生成学习路径
 */
export async function generateLearningPath(
    goal: string,
    options?: Partial<LearningAgentConfig> & { signal?: AbortSignal; context?: string }
): Promise<LearningPath> {
    const agent = new LearningPathAgent(options);
    return agent.generatePath(goal, options);
}
