/**
 * 💡 创意激发 Agent (Idea Spark Agent)
 * 
 * 一个令人惊叹的 LLM + Agent 组合功能！
 * 
 * 核心理念：伟大的创新往往来自不同领域知识的碰撞
 * 
 * 核心能力：
 * - 🎲 随机或智能选择不同领域的知识点
 * - 🔀 强制跨领域组合，打破思维定式
 * - 💡 使用 LLM 进行深度联想，发现潜在的创新点
 * - 🌟 生成具体的创意想法和实施建议
 * - 📝 支持将有价值的创意保存为新问题
 * 
 * Agent 工作流程 (Bisociation Method):
 * 1. 扫描知识库，提取领域和概念
 * 2. 智能或随机选择跨领域的知识组合
 * 3. 使用 LLM 进行强制联想（类似 SCAMPER/六顶思考帽）
 * 4. 评估创意的可行性和新颖性
 * 5. 生成结构化的创意卡片
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { Logger } from "../core/utils/Logger";
import { LLMService } from "./LLMService";
import { getAllIssueMarkdowns } from "../data/IssueMarkdowns";
import { getIssueDir } from "../config";

// ==================== 类型定义 ====================

/** 知识概念 */
export interface KnowledgeConcept {
    id: string;
    sourceFile: string;
    sourceTitle: string;
    concept: string;
    domain: string;
    keywords: string[];
    abstractPrinciple?: string;   // 抽象出的原理/模式
}

/** 创意火花 */
export interface IdeaSpark {
    id: string;
    timestamp: number;
    // 输入：碰撞的概念
    inputs: {
        concept1: KnowledgeConcept;
        concept2: KnowledgeConcept;
        concept3?: KnowledgeConcept;  // 可选的第三个概念
    };
    // 碰撞类型
    collisionType: 
        | "analogy"           // 类比迁移：将A领域的模式应用到B
        | "combination"       // 组合融合：将两个概念合二为一
        | "contrast"          // 对比启发：从差异中发现新视角
        | "abstraction"       // 抽象提升：找到共同的底层原理
        | "inversion";        // 逆向思考：反转假设产生新想法
    // 输出：生成的创意
    idea: {
        title: string;
        description: string;
        noveltyScore: number;       // 新颖度 0-100
        feasibilityScore: number;   // 可行性 0-100
        impactScore: number;        // 影响力 0-100
    };
    // 详细内容
    elaboration: {
        coreInsight: string;        // 核心洞见
        howItWorks: string;         // 如何运作
        potentialApplications: string[];  // 潜在应用
        challenges: string[];       // 可能的挑战
        nextSteps: string[];        // 下一步行动
    };
    // 联想过程记录
    associationChain: string[];     // 联想链条
}

/** 创意会话 */
export interface IdeaSession {
    id: string;
    timestamp: number;
    theme?: string;                 // 可选的主题聚焦
    sparks: IdeaSpark[];
    totalConceptsExplored: number;
    duration: number;
    savedIdeas: string[];           // 保存为问题的创意ID
}

/** Agent 配置 */
export interface IdeaSparkConfig {
    sparksPerSession: number;       // 每次会话生成的创意数
    minConceptsRequired: number;    // 最少需要的概念数
    forceRandomCombination: boolean; // 是否强制随机组合
    collisionMethods: IdeaSpark["collisionType"][];
    creativityLevel: "conservative" | "moderate" | "wild"; // 创意激进程度
}

/** Agent 思考步骤 */
export interface IdeaSparkThought {
    step: number;
    action: "extract" | "select" | "collide" | "elaborate" | "evaluate";
    reasoning: string;
    data?: unknown;
    timestamp: number;
}

/** Agent 状态 */
export interface IdeaSparkState {
    phase: "extracting" | "selecting" | "colliding" | "elaborating" | "evaluating" | "completed" | "error";
    progress: number;
    concepts: KnowledgeConcept[];
    selectedCombinations: KnowledgeConcept[][];
    sparks: IdeaSpark[];
    thoughts: IdeaSparkThought[];
}

// ==================== Agent 实现 ====================

/**
 * 创意激发 Agent
 * 
 * 灵感来源：Arthur Koestler 的 "Bisociation" 理论
 * 通过将两个通常不相关的思维矩阵碰撞，产生创造性的洞见
 */
export class IdeaSparkAgent {
    private state: IdeaSparkState;
    private config: IdeaSparkConfig;
    private logger: Logger;
    private abortController: AbortController | null = null;

    // 事件回调
    public onProgress?: (state: IdeaSparkState, message: string) => void;
    public onThought?: (thought: IdeaSparkThought) => void;
    public onSpark?: (spark: IdeaSpark) => void;

    constructor(config?: Partial<IdeaSparkConfig>) {
        this.config = {
            sparksPerSession: 5,
            minConceptsRequired: 10,
            forceRandomCombination: true,
            collisionMethods: ["analogy", "combination", "contrast", "abstraction", "inversion"],
            creativityLevel: "moderate",
            ...config,
        };

        this.state = this.createInitialState();
        this.logger = Logger.getInstance();
    }

    private createInitialState(): IdeaSparkState {
        return {
            phase: "extracting",
            progress: 0,
            concepts: [],
            selectedCombinations: [],
            sparks: [],
            thoughts: [],
        };
    }

    /**
     * 启动创意激发会话
     */
    public async spark(options?: {
        signal?: AbortSignal;
        theme?: string;           // 可选主题聚焦
        seedConcept?: string;     // 种子概念
    }): Promise<IdeaSession> {
        const startTime = Date.now();
        this.state = this.createInitialState();
        this.abortController = new AbortController();

        if (options?.signal) {
            options.signal.addEventListener("abort", () => this.abortController?.abort());
        }

        try {
            // Phase 1: 提取知识概念
            await this.extractConcepts(options?.theme);

            // Phase 2: 选择碰撞组合
            await this.selectCombinations(options?.seedConcept);

            // Phase 3: 执行概念碰撞
            await this.performCollisions();

            // Phase 4: 生成会话报告
            const session: IdeaSession = {
                id: `is-${Date.now()}`,
                timestamp: Date.now(),
                theme: options?.theme,
                sparks: this.state.sparks,
                totalConceptsExplored: this.state.concepts.length,
                duration: Date.now() - startTime,
                savedIdeas: [],
            };

            this.updatePhase("completed");
            this.updateProgress(100);

            return session;
        } catch (error) {
            if (this.abortController?.signal.aborted) {
                throw new Error("创意会话已取消");
            }
            this.logger.error("[IdeaSparkAgent] Spark failed:", error);
            throw error;
        }
    }

    /**
     * 取消会话
     */
    public cancel(): void {
        this.abortController?.abort();
    }

    /**
     * Phase 1: 提取知识概念
     */
    private async extractConcepts(theme?: string): Promise<void> {
        this.updatePhase("extracting");
        this.emitProgress("正在从知识库提取概念...");

        const issues = await getAllIssueMarkdowns();

        if (issues.length < this.config.minConceptsRequired) {
            throw new Error(`知识库中的问题太少（${issues.length}个），需要至少 ${this.config.minConceptsRequired} 个才能产生有趣的碰撞`);
        }

        // 批量提取概念
        const batchSize = 8;
        for (let i = 0; i < issues.length; i += batchSize) {
            if (this.abortController?.signal.aborted) {break;}

            const batch = issues.slice(i, i + batchSize);
            await this.extractBatchConcepts(batch, theme);

            this.updateProgress(Math.floor((i / issues.length) * 30));
        }

        const thought = this.recordThought(
            "extract",
            `从 ${issues.length} 个知识点中提取了 ${this.state.concepts.length} 个可碰撞的概念`
        );
        this.emitThought(thought);

        this.updateProgress(30);
    }

    /**
     * 批量提取概念
     */
    private async extractBatchConcepts(
        issues: { uri: vscode.Uri; title: string }[],
        theme?: string
    ): Promise<void> {
        // 读取内容
        const issuesWithContent = await Promise.all(
            issues.map(async (issue) => {
                try {
                    const content = await fs.promises.readFile(issue.uri.fsPath, "utf-8");
                    return { ...issue, content: content.substring(0, 600) };
                } catch {
                    return { ...issue, content: "" };
                }
            })
        );

        const themeHint = theme ? `\n请特别关注与"${theme}"相关的概念。` : "";

        const prompt = `你是一个创意思维专家。请从以下知识条目中提取可用于创意碰撞的核心概念。${themeHint}

要求：
1. 每个条目提取 1-2 个核心概念
2. 概念应该是具体的、可操作的
3. 同时提取概念所属的领域
4. 尝试抽象出概念背后的原理或模式（这有助于跨领域迁移）

知识条目：
${issuesWithContent.map((i, idx) => `${idx + 1}. 【${i.title}】\n${i.content.substring(0, 400)}`).join("\n\n")}

返回 JSON 数组：
[
  {
    "sourceIndex": 1,
    "concept": "核心概念",
    "domain": "所属领域",
    "keywords": ["关键词1", "关键词2"],
    "abstractPrinciple": "抽象出的原理/模式（可选）"
  }
]`;

        try {
            const response = await LLMService._request(
                [vscode.LanguageModelChatMessage.User(prompt)],
                { signal: this.abortController?.signal }
            );

            if (!response) {return;}

            const results = this.parseJsonArray(response.text);

            for (const result of results) {
                const idx = (result.sourceIndex as number) - 1;
                if (idx < 0 || idx >= issuesWithContent.length) {continue;}

                const issue = issuesWithContent[idx];
                this.state.concepts.push({
                    id: `concept-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                    sourceFile: issue.uri.fsPath,
                    sourceTitle: issue.title,
                    concept: (result.concept as string) || "",
                    domain: (result.domain as string) || "通用",
                    keywords: (result.keywords as string[]) || [],
                    abstractPrinciple: result.abstractPrinciple as string | undefined,
                });
            }
        } catch (error) {
            this.logger.warn("[IdeaSparkAgent] Concept extraction failed:", error);
        }
    }

    /**
     * Phase 2: 选择碰撞组合
     */
    private async selectCombinations(seedConcept?: string): Promise<void> {
        this.updatePhase("selecting");
        this.emitProgress("正在选择创意碰撞组合...");

        const concepts = this.state.concepts;
        const combinations: KnowledgeConcept[][] = [];

        // 按领域分组
        const domainGroups = new Map<string, KnowledgeConcept[]>();
        for (const concept of concepts) {
            const domain = concept.domain.toLowerCase();
            if (!domainGroups.has(domain)) {
                domainGroups.set(domain, []);
            }
            domainGroups.get(domain)!.push(concept);
        }

        const domains = Array.from(domainGroups.keys());

        // 生成跨领域组合
        for (let i = 0; i < this.config.sparksPerSession; i++) {
            let combo: KnowledgeConcept[];

            if (seedConcept && i === 0) {
                // 第一个组合使用种子概念
                const seed = concepts.find(c => 
                    c.concept.includes(seedConcept) || c.sourceTitle.includes(seedConcept)
                );
                if (seed) {
                    const otherDomains = domains.filter(d => d !== seed.domain.toLowerCase());
                    const randomDomain = otherDomains[Math.floor(Math.random() * otherDomains.length)];
                    const randomConcept = this.getRandomFromArray(domainGroups.get(randomDomain) || concepts);
                    combo = [seed, randomConcept];
                } else {
                    combo = this.selectRandomCrossDomainCombo(domainGroups, domains);
                }
            } else {
                combo = this.selectRandomCrossDomainCombo(domainGroups, domains);
            }

            // 有时候加入第三个概念增加复杂度
            if (this.config.creativityLevel === "wild" && Math.random() > 0.5) {
                const thirdDomain = domains.filter(d => 
                    d !== combo[0].domain.toLowerCase() && d !== combo[1].domain.toLowerCase()
                )[0] || domains[Math.floor(Math.random() * domains.length)];
                const third = this.getRandomFromArray(domainGroups.get(thirdDomain) || concepts);
                if (third && !combo.includes(third)) {
                    combo.push(third);
                }
            }

            combinations.push(combo);
        }

        this.state.selectedCombinations = combinations;

        const thought = this.recordThought(
            "select",
            `选择了 ${combinations.length} 个跨领域组合进行碰撞\n组合示例：${combinations[0]?.map(c => c.concept).join(" × ")}`
        );
        this.emitThought(thought);

        this.updateProgress(40);
    }

    private selectRandomCrossDomainCombo(
        domainGroups: Map<string, KnowledgeConcept[]>,
        domains: string[]
    ): KnowledgeConcept[] {
        if (domains.length >= 2) {
            // 随机选择两个不同领域
            const shuffled = [...domains].sort(() => Math.random() - 0.5);
            const domain1 = shuffled[0];
            const domain2 = shuffled[1];
            
            return [
                this.getRandomFromArray(domainGroups.get(domain1)!),
                this.getRandomFromArray(domainGroups.get(domain2)!),
            ];
        } else {
            // 只有一个领域，随机选两个不同的概念
            const allConcepts = Array.from(domainGroups.values()).flat();
            const first = this.getRandomFromArray(allConcepts);
            const second = this.getRandomFromArray(allConcepts.filter(c => c.id !== first.id)) || first;
            return [first, second];
        }
    }

    private getRandomFromArray<T>(arr: T[]): T {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    /**
     * Phase 3: 执行概念碰撞
     */
    private async performCollisions(): Promise<void> {
        this.updatePhase("colliding");

        for (let i = 0; i < this.state.selectedCombinations.length; i++) {
            if (this.abortController?.signal.aborted) {break;}

            const combo = this.state.selectedCombinations[i];
            const method = this.getRandomFromArray(this.config.collisionMethods);

            this.emitProgress(`正在进行第 ${i + 1}/${this.state.selectedCombinations.length} 次创意碰撞...`);

            const spark = await this.collide(combo, method);
            if (spark) {
                this.state.sparks.push(spark);
                this.onSpark?.(spark);
            }

            this.updateProgress(40 + Math.floor(((i + 1) / this.state.selectedCombinations.length) * 50));
        }

        const thought = this.recordThought(
            "collide",
            `完成 ${this.state.sparks.length} 次创意碰撞，产生了 ${this.state.sparks.filter(s => s.idea.noveltyScore >= 60).length} 个有潜力的创意`
        );
        this.emitThought(thought);
    }

    /**
     * 执行单次碰撞
     */
    private async collide(
        concepts: KnowledgeConcept[],
        method: IdeaSpark["collisionType"]
    ): Promise<IdeaSpark | null> {
        const methodDescriptions: Record<IdeaSpark["collisionType"], string> = {
            analogy: "类比迁移：将概念A领域的模式、方法或原理应用到概念B的领域",
            combination: "组合融合：将两个概念融合成一个新的混合概念",
            contrast: "对比启发：分析两个概念的差异，从中发现新的视角或解决方案",
            abstraction: "抽象提升：找到两个概念共同的底层原理，并基于此产生新想法",
            inversion: "逆向思考：反转其中一个概念的基本假设，看看会产生什么",
        };

        const creativityHints: Record<IdeaSparkConfig["creativityLevel"], string> = {
            conservative: "请生成实用、可落地的创意",
            moderate: "在实用性和创新性之间取得平衡",
            wild: "大胆想象！不要受限于常规思维，可以产生看似疯狂但有启发性的想法",
        };

        const conceptDescriptions = concepts.map((c, i) => 
            `概念${i + 1}：【${c.concept}】
   - 来源：${c.sourceTitle}
   - 领域：${c.domain}
   - 关键词：${c.keywords.join(", ")}
   ${c.abstractPrinciple ? `- 抽象原理：${c.abstractPrinciple}` : ""}`
        ).join("\n\n");

        const prompt = `你是一个顶级的创意思维大师，擅长通过跨领域知识碰撞产生突破性创意。

【碰撞方法】${method}
${methodDescriptions[method]}

【创意风格】${creativityHints[this.config.creativityLevel]}

【待碰撞的概念】
${conceptDescriptions}

请使用"${method}"方法，让这些概念发生碰撞，产生一个创新的想法。

要求：
1. 创意必须是两个（或多个）概念碰撞的结果，而非单独来自其中之一
2. 解释清楚碰撞过程中的联想链条
3. 评估创意的新颖性、可行性和潜在影响

返回 JSON：
{
  "idea": {
    "title": "创意标题（简洁有力）",
    "description": "创意描述（2-3句话概括）",
    "noveltyScore": 80,
    "feasibilityScore": 70,
    "impactScore": 75
  },
  "elaboration": {
    "coreInsight": "核心洞见（这个创意的关键突破点）",
    "howItWorks": "如何运作（具体说明）",
    "potentialApplications": ["应用场景1", "应用场景2"],
    "challenges": ["挑战1", "挑战2"],
    "nextSteps": ["下一步1", "下一步2"]
  },
  "associationChain": ["概念A的某特性", "触发联想到...", "与概念B的...结合", "产生新想法"]
}`;

        try {
            const response = await LLMService._request(
                [vscode.LanguageModelChatMessage.User(prompt)],
                { signal: this.abortController?.signal }
            );

            if (!response) {return null;}

            const result = this.parseJsonObject(response.text);

            const idea = result.idea as {
                title: string;
                description: string;
                noveltyScore: number;
                feasibilityScore: number;
                impactScore: number;
            } | undefined;

            const elaboration = result.elaboration as {
                coreInsight: string;
                howItWorks: string;
                potentialApplications: string[];
                challenges: string[];
                nextSteps: string[];
            } | undefined;

            if (!idea) {return null;}

            const spark: IdeaSpark = {
                id: `spark-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                timestamp: Date.now(),
                inputs: {
                    concept1: concepts[0],
                    concept2: concepts[1],
                    concept3: concepts[2],
                },
                collisionType: method,
                idea: {
                    title: idea.title || "未命名创意",
                    description: idea.description || "",
                    noveltyScore: idea.noveltyScore || 50,
                    feasibilityScore: idea.feasibilityScore || 50,
                    impactScore: idea.impactScore || 50,
                },
                elaboration: {
                    coreInsight: elaboration?.coreInsight || "",
                    howItWorks: elaboration?.howItWorks || "",
                    potentialApplications: elaboration?.potentialApplications || [],
                    challenges: elaboration?.challenges || [],
                    nextSteps: elaboration?.nextSteps || [],
                },
                associationChain: (result.associationChain as string[]) || [],
            };

            return spark;
        } catch (error) {
            this.logger.warn("[IdeaSparkAgent] Collision failed:", error);
            return null;
        }
    }

    // ==================== 工具方法 ====================

    private updatePhase(phase: IdeaSparkState["phase"]): void {
        this.state.phase = phase;
    }

    private updateProgress(progress: number): void {
        this.state.progress = progress;
    }

    private emitProgress(message: string): void {
        this.onProgress?.(this.state, message);
    }

    private recordThought(action: IdeaSparkThought["action"], reasoning: string): IdeaSparkThought {
        const thought: IdeaSparkThought = {
            step: this.state.thoughts.length + 1,
            action,
            reasoning,
            timestamp: Date.now(),
        };
        this.state.thoughts.push(thought);
        return thought;
    }

    private emitThought(thought: IdeaSparkThought): void {
        this.onThought?.(thought);
    }

    private parseJsonArray(text: string): Array<Record<string, unknown>> {
        try {
            const match = text.match(/\[[\s\S]*\]/);
            if (match) {
                return JSON.parse(match[0]) as Array<Record<string, unknown>>;
            }
        } catch {
            this.logger.warn("[IdeaSparkAgent] JSON array parse failed");
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
            this.logger.warn("[IdeaSparkAgent] JSON object parse failed");
        }
        return {};
    }
}

// ==================== 会话历史持久化 ====================

const HISTORY_FILENAME = "ideaSparkHistory.json";

/**
 * 保存创意会话
 */
export function saveIdeaSession(session: IdeaSession): void {
    const issueDir = getIssueDir();
    if (!issueDir) {return;}

    const filePath = path.join(issueDir, ".issueManager", HISTORY_FILENAME);
    const dir = path.dirname(filePath);

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    // 读取现有历史
    let history: IdeaSession[] = [];
    if (fs.existsSync(filePath)) {
        try {
            history = JSON.parse(fs.readFileSync(filePath, "utf-8")) as IdeaSession[];
        } catch {
            // 忽略解析错误
        }
    }

    // 添加新会话
    history.unshift(session);
    
    // 只保留最近 20 个会话
    history = history.slice(0, 20);

    fs.writeFileSync(filePath, JSON.stringify(history, null, 2), "utf-8");
}

/**
 * 读取创意历史
 */
export function loadIdeaHistory(): IdeaSession[] {
    const issueDir = getIssueDir();
    if (!issueDir) {return [];}

    const filePath = path.join(issueDir, ".issueManager", HISTORY_FILENAME);
    if (!fs.existsSync(filePath)) {return [];}

    try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8")) as IdeaSession[];
    } catch {
        return [];
    }
}

// ==================== 导出工具函数 ====================

/**
 * 快速启动创意会话
 */
export async function runIdeaSpark(options?: {
    signal?: AbortSignal;
    theme?: string;
    seedConcept?: string;
    config?: Partial<IdeaSparkConfig>;
}): Promise<IdeaSession> {
    const agent = new IdeaSparkAgent(options?.config);
    const session = await agent.spark(options);
    
    // 自动保存会话
    saveIdeaSession(session);
    
    return session;
}

/**
 * 将创意保存为问题文档
 */
export async function saveSparkAsIssue(spark: IdeaSpark): Promise<string | null> {
    const issueDir = getIssueDir();
    if (!issueDir) {return null;}

    const content = `# 💡 ${spark.idea.title}

## 创意概述
${spark.idea.description}

## 评分
- 🆕 新颖度：${spark.idea.noveltyScore}/100
- ⚙️ 可行性：${spark.idea.feasibilityScore}/100
- 🎯 影响力：${spark.idea.impactScore}/100

## 核心洞见
${spark.elaboration.coreInsight}

## 如何运作
${spark.elaboration.howItWorks}

## 潜在应用
${spark.elaboration.potentialApplications.map(a => `- ${a}`).join("\n")}

## 挑战与风险
${spark.elaboration.challenges.map(c => `- ${c}`).join("\n")}

## 下一步行动
${spark.elaboration.nextSteps.map((s, i) => `${i + 1}. ${s}`).join("\n")}

---

## 碰撞来源
- **碰撞方法**: ${spark.collisionType}
- **概念1**: ${spark.inputs.concept1.concept} (${spark.inputs.concept1.domain})
- **概念2**: ${spark.inputs.concept2.concept} (${spark.inputs.concept2.domain})
${spark.inputs.concept3 ? `- **概念3**: ${spark.inputs.concept3.concept} (${spark.inputs.concept3.domain})` : ""}

## 联想链条
${spark.associationChain.map((step, i) => `${i + 1}. ${step}`).join("\n")}

---
*由 Issue Manager 创意激发 Agent 生成于 ${new Date(spark.timestamp).toLocaleString()}*
`;

    const fileName = `${new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").substring(0, 17)}-${Math.random().toString(36).substr(2, 3)}.md`;
    const filePath = path.join(issueDir, fileName);

    try {
        await fs.promises.writeFile(filePath, content, "utf-8");
        return filePath;
    } catch (error) {
        Logger.getInstance().error("[IdeaSparkAgent] Failed to save spark as issue:", error);
        return null;
    }
}
