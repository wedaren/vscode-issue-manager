/**
 * 🧠 知识连接 Agent (Knowledge Graph Agent)
 * 
 * 一个令人惊叹的 LLM + Agent 组合功能！
 * 
 * 核心能力：
 * - 🔍 深度分析知识库中每个问题的内容和上下文
 * - 🌐 发现问题之间隐藏的语义关联（不仅仅是显式引用）
 * - 💡 自动建议问题之间应该建立的连接
 * - 🎯 识别知识孤岛并提供整合建议
 * - 📊 生成知识图谱可视化数据
 * 
 * Agent 工作流程 (ReAct Pattern):
 * 1. 扫描知识库，构建问题的语义向量表示
 * 2. 多轮迭代分析，发现潜在关联
 * 3. 使用 LLM 验证和解释每个关联的合理性
 * 4. 生成连接建议报告
 * 5. 支持一键创建问题关联
 */

import * as vscode from "vscode";
import * as path from "path";
import { Logger } from "../core/utils/Logger";
import { LLMService } from "./LLMService";
import { getAllIssueMarkdowns, IssueMarkdown } from "../data/IssueMarkdowns";
import * as fs from "fs";

// ==================== 类型定义 ====================

/** Agent 思考步骤 */
export interface GraphAgentThought {
    step: number;
    action: "scan" | "analyze" | "cluster" | "connect" | "validate" | "synthesize";
    reasoning: string;
    target?: string;
    findings?: string[];
    timestamp: number;
}

/** 知识节点 */
export interface KnowledgeNode {
    id: string;               // 文件名（不含路径）
    filePath: string;
    title: string;
    content: string;          // 内容摘要
    keywords: string[];       // 提取的关键词
    concepts: string[];       // 核心概念
    domain?: string;          // 领域分类
    createdAt?: number;
    connections: string[];    // 现有显式连接
}

/** 发现的连接 */
export interface DiscoveredConnection {
    id: string;
    sourceNode: {
        id: string;
        title: string;
        filePath: string;
    };
    targetNode: {
        id: string;
        title: string;
        filePath: string;
    };
    relationshipType: 
        | "semantic-similar"      // 语义相似
        | "concept-overlap"       // 概念重叠
        | "causal-relation"       // 因果关系
        | "prerequisite"          // 前置知识
        | "extension"             // 扩展延伸
        | "contradiction"         // 矛盾对立
        | "example-of"            // 举例说明
        | "part-of";              // 组成部分
    confidence: number;           // 0-1 置信度
    explanation: string;          // AI 解释为什么这两个应该连接
    sharedConcepts: string[];     // 共享的概念
    suggestedLinkText?: string;   // 建议的链接文本
}

/** 知识孤岛 */
export interface KnowledgeIsland {
    id: string;
    nodes: KnowledgeNode[];
    theme: string;                // 孤岛主题
    isolationReason: string;      // 为什么是孤岛
    integrationSuggestion: string; // 整合建议
}

/** 知识图谱分析报告 */
export interface KnowledgeGraphReport {
    id: string;
    timestamp: number;
    summary: {
        totalNodes: number;
        existingConnections: number;
        discoveredConnections: number;
        knowledgeIslands: number;
        coverageScore: number;      // 知识覆盖度 0-100
        cohesionScore: number;      // 知识内聚度 0-100
    };
    nodes: KnowledgeNode[];
    discoveredConnections: DiscoveredConnection[];
    knowledgeIslands: KnowledgeIsland[];
    clusters: {
        name: string;
        nodeIds: string[];
        description: string;
    }[];
    agentThoughts: GraphAgentThought[];
    recommendations: {
        type: "connect" | "merge" | "split" | "reorganize";
        priority: "high" | "medium" | "low";
        description: string;
        affectedNodes: string[];
    }[];
    metrics: {
        nodesAnalyzed: number;
        analysisRounds: number;
        totalDuration: number;
    };
}

/** Agent 配置 */
export interface GraphAgentConfig {
    maxAnalysisRounds: number;
    minConfidenceThreshold: number;   // 最小置信度阈值
    maxConnectionsPerNode: number;    // 每个节点最大建议连接数
    includeContentAnalysis: boolean;  // 是否包含内容深度分析
}

/** Agent 状态 */
export interface GraphAgentState {
    phase: "initializing" | "scanning" | "analyzing" | "clustering" | "connecting" | "synthesizing" | "completed" | "error";
    currentRound: number;
    totalRounds: number;
    progress: number;
    nodes: Map<string, KnowledgeNode>;
    discoveredConnections: DiscoveredConnection[];
    thoughts: GraphAgentThought[];
    analyzedPairs: Set<string>;       // 已分析的节点对
}

// ==================== Agent 实现 ====================

/**
 * 知识图谱 Agent
 * 
 * 使用 LLM 进行深度语义分析，发现知识间的隐藏连接
 */
export class KnowledgeGraphAgent {
    private state: GraphAgentState;
    private config: GraphAgentConfig;
    private logger: Logger;
    private abortController: AbortController | null = null;

    // 事件回调
    public onProgress?: (state: GraphAgentState, message: string) => void;
    public onThought?: (thought: GraphAgentThought) => void;
    public onConnection?: (connection: DiscoveredConnection) => void;

    constructor(config?: Partial<GraphAgentConfig>) {
        this.config = {
            maxAnalysisRounds: 3,
            minConfidenceThreshold: 0.6,
            maxConnectionsPerNode: 5,
            includeContentAnalysis: true,
            ...config,
        };

        this.state = this.createInitialState();
        this.logger = Logger.getInstance();
    }

    private createInitialState(): GraphAgentState {
        return {
            phase: "initializing",
            currentRound: 0,
            totalRounds: this.config.maxAnalysisRounds,
            progress: 0,
            nodes: new Map(),
            discoveredConnections: [],
            thoughts: [],
            analyzedPairs: new Set(),
        };
    }

    /**
     * 执行知识图谱分析
     */
    public async analyze(options?: { signal?: AbortSignal }): Promise<KnowledgeGraphReport> {
        const startTime = Date.now();
        this.state = this.createInitialState();
        this.abortController = new AbortController();

        if (options?.signal) {
            options.signal.addEventListener("abort", () => this.abortController?.abort());
        }

        try {
            // Phase 1: 扫描知识库
            await this.scanKnowledgeBase();

            // Phase 2: 提取语义信息
            await this.extractSemantics();

            // Phase 3: 聚类分析
            await this.performClustering();

            // Phase 4: 发现连接
            await this.discoverConnections();

            // Phase 5: 生成报告
            const report = await this.generateReport(startTime);

            return report;
        } catch (error) {
            if (this.abortController?.signal.aborted) {
                throw new Error("分析已取消");
            }
            this.logger.error("[KnowledgeGraphAgent] Analysis failed:", error);
            throw error;
        }
    }

    /**
     * 取消分析
     */
    public cancel(): void {
        this.abortController?.abort();
    }

    /**
     * Phase 1: 扫描知识库
     */
    private async scanKnowledgeBase(): Promise<void> {
        this.updatePhase("scanning");
        this.emitProgress("正在扫描知识库...");

        const issues = await getAllIssueMarkdowns();

        const thought = this.recordThought(
            "scan",
            `发现 ${issues.length} 个知识节点，准备分析它们之间的潜在关联`
        );
        this.emitThought(thought);

        // 构建初始节点
        for (const issue of issues) {
            const node: KnowledgeNode = {
                id: path.basename(issue.uri.fsPath),
                filePath: issue.uri.fsPath,
                title: issue.title,
                content: "",
                keywords: [],
                concepts: [],
                connections: [],
            };

            // 读取内容摘要
            if (this.config.includeContentAnalysis) {
                try {
                    const fullContent = await fs.promises.readFile(issue.uri.fsPath, "utf-8");
                    // 提取内容摘要（前1000字符）
                    node.content = fullContent.substring(0, 1000);
                    
                    // 提取现有的显式链接
                    const linkMatches = fullContent.match(/\[\[([^\]]+)\]\]|\[([^\]]+)\]\(([^)]+\.md)\)/g) || [];
                    node.connections = linkMatches.map(m => m.replace(/[\[\]()]/g, ""));
                } catch {
                    // 忽略读取失败
                }
            }

            this.state.nodes.set(node.id, node);
        }

        this.updateProgress(20);
    }

    /**
     * Phase 2: 提取语义信息
     */
    private async extractSemantics(): Promise<void> {
        this.updatePhase("analyzing");
        this.emitProgress("正在提取知识语义...");

        const nodes = Array.from(this.state.nodes.values());
        const batchSize = 5;

        for (let i = 0; i < nodes.length; i += batchSize) {
            if (this.abortController?.signal.aborted) {break;}

            const batch = nodes.slice(i, i + batchSize);
            await this.extractBatchSemantics(batch);

            this.updateProgress(20 + Math.floor((i / nodes.length) * 30));
        }

        const thought = this.recordThought(
            "analyze",
            `完成 ${nodes.length} 个节点的语义提取`
        );
        this.emitThought(thought);
    }

    /**
     * 批量提取语义
     */
    private async extractBatchSemantics(nodes: KnowledgeNode[]): Promise<void> {
        const prompt = `你是一个知识分析专家。请分析以下知识条目，提取关键信息。

对于每个条目，请提取：
1. keywords: 3-5个核心关键词
2. concepts: 2-3个主要概念
3. domain: 所属领域（技术/管理/设计/产品/其他）

请以 JSON 数组格式返回，每个元素对应一个条目：
[
  {
    "id": "条目ID",
    "keywords": ["关键词1", "关键词2"],
    "concepts": ["概念1", "概念2"],
    "domain": "领域"
  }
]

知识条目：
${nodes.map(n => `---
ID: ${n.id}
标题: ${n.title}
内容摘要: ${n.content.substring(0, 500)}
---`).join("\n\n")}`;

        try {
            const response = await LLMService._request(
                [vscode.LanguageModelChatMessage.User(prompt)],
                { signal: this.abortController?.signal }
            );

            if (!response) {return;}

            const results = this.parseJsonArray(response.text);
            
            for (const result of results) {
                const node = this.state.nodes.get(result.id as string);
                if (node) {
                    node.keywords = (result.keywords as string[]) || [];
                    node.concepts = (result.concepts as string[]) || [];
                    node.domain = result.domain as string | undefined;
                }
            }
        } catch (error) {
            this.logger.warn("[KnowledgeGraphAgent] Semantic extraction failed:", error);
        }
    }

    /**
     * Phase 3: 聚类分析
     */
    private async performClustering(): Promise<void> {
        this.updatePhase("clustering");
        this.emitProgress("正在进行知识聚类...");

        const nodes = Array.from(this.state.nodes.values());
        
        const prompt = `你是一个知识组织专家。请对以下知识节点进行聚类分析。

要求：
1. 根据主题和领域将节点分成 3-7 个聚类
2. 为每个聚类命名并描述其主题
3. 识别孤立的节点（与其他节点关联度低的）

请以 JSON 格式返回：
{
  "clusters": [
    {
      "name": "聚类名称",
      "nodeIds": ["节点ID1", "节点ID2"],
      "description": "聚类描述"
    }
  ],
  "isolatedNodes": [
    {
      "nodeId": "节点ID",
      "reason": "孤立原因",
      "suggestion": "整合建议"
    }
  ]
}

知识节点列表：
${nodes.map(n => `- ${n.id}: ${n.title} [${n.domain}] 概念: ${n.concepts.join(", ")}`).join("\n")}`;

        try {
            const response = await LLMService._request(
                [vscode.LanguageModelChatMessage.User(prompt)],
                { signal: this.abortController?.signal }
            );

            if (response) {
                // 解析聚类结果，存储在状态中供后续使用
                const result = this.parseJsonObject(response.text);
                (this.state as unknown as { clusters: unknown }).clusters = result.clusters || [];
                (this.state as unknown as { isolatedNodes: unknown }).isolatedNodes = result.isolatedNodes || [];
            }
        } catch (error) {
            this.logger.warn("[KnowledgeGraphAgent] Clustering failed:", error);
        }

        const thought = this.recordThought(
            "cluster",
            "完成知识聚类分析"
        );
        this.emitThought(thought);

        this.updateProgress(60);
    }

    /**
     * Phase 4: 发现连接
     */
    private async discoverConnections(): Promise<void> {
        this.updatePhase("connecting");
        this.emitProgress("正在发现隐藏连接...");

        const nodes = Array.from(this.state.nodes.values());
        
        // 选择有潜力的节点对进行分析
        const candidatePairs = this.selectCandidatePairs(nodes);

        const thought = this.recordThought(
            "connect",
            `发现 ${candidatePairs.length} 对有潜力的连接候选`
        );
        this.emitThought(thought);

        // 批量分析连接
        const batchSize = 10;
        for (let i = 0; i < candidatePairs.length && i < 50; i += batchSize) {
            if (this.abortController?.signal.aborted) {break;}

            const batch = candidatePairs.slice(i, i + batchSize);
            await this.analyzePairBatch(batch);

            this.updateProgress(60 + Math.floor((i / Math.min(candidatePairs.length, 50)) * 30));
        }
    }

    /**
     * 选择候选节点对
     */
    private selectCandidatePairs(nodes: KnowledgeNode[]): [KnowledgeNode, KnowledgeNode][] {
        const pairs: [KnowledgeNode, KnowledgeNode][] = [];

        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const nodeA = nodes[i];
                const nodeB = nodes[j];

                // 计算初步相似度
                const conceptOverlap = this.calculateConceptOverlap(nodeA, nodeB);
                const sameDomain = nodeA.domain === nodeB.domain;
                const keywordOverlap = this.calculateKeywordOverlap(nodeA, nodeB);

                // 如果有一定重叠或同领域，加入候选
                if (conceptOverlap > 0 || sameDomain || keywordOverlap > 0.2) {
                    pairs.push([nodeA, nodeB]);
                }
            }
        }

        // 按潜力排序
        pairs.sort((a, b) => {
            const scoreA = this.calculatePairPotential(a[0], a[1]);
            const scoreB = this.calculatePairPotential(b[0], b[1]);
            return scoreB - scoreA;
        });

        return pairs;
    }

    private calculateConceptOverlap(a: KnowledgeNode, b: KnowledgeNode): number {
        const setA = new Set(a.concepts.map(c => c.toLowerCase()));
        const setB = new Set(b.concepts.map(c => c.toLowerCase()));
        let overlap = 0;
        setA.forEach(c => { if (setB.has(c)) {overlap++;} });
        return overlap;
    }

    private calculateKeywordOverlap(a: KnowledgeNode, b: KnowledgeNode): number {
        const setA = new Set(a.keywords.map(k => k.toLowerCase()));
        const setB = new Set(b.keywords.map(k => k.toLowerCase()));
        if (setA.size === 0 || setB.size === 0) {return 0;}
        let overlap = 0;
        setA.forEach(k => { if (setB.has(k)) {overlap++;} });
        return overlap / Math.min(setA.size, setB.size);
    }

    private calculatePairPotential(a: KnowledgeNode, b: KnowledgeNode): number {
        const conceptScore = this.calculateConceptOverlap(a, b) * 0.4;
        const keywordScore = this.calculateKeywordOverlap(a, b) * 0.3;
        const domainScore = a.domain === b.domain ? 0.3 : 0;
        return conceptScore + keywordScore + domainScore;
    }

    /**
     * 批量分析节点对
     */
    private async analyzePairBatch(pairs: [KnowledgeNode, KnowledgeNode][]): Promise<void> {
        const pairDescriptions = pairs.map(([a, b], i) => 
            `${i + 1}. [A] ${a.id}: "${a.title}" - 概念: ${a.concepts.join(", ")}
   [B] ${b.id}: "${b.title}" - 概念: ${b.concepts.join(", ")}`
        ).join("\n\n");

        const prompt = `你是一个知识关联分析专家。请分析以下知识节点对，判断它们之间是否存在有意义的关联。

关联类型说明：
- semantic-similar: 语义相似，讨论类似话题
- concept-overlap: 概念重叠，共享核心概念
- causal-relation: 因果关系，A导致B或B是A的结果
- prerequisite: 前置知识，理解A需要先理解B
- extension: 扩展延伸，B是A的深入或扩展
- contradiction: 矛盾对立，A和B观点冲突
- example-of: 举例说明，B是A的具体案例
- part-of: 组成部分，B是A的一部分

请对每对节点给出：
1. 是否应该建立连接（confidence > 0.6 表示应该）
2. 连接类型
3. 置信度 (0-1)
4. 解释为什么应该（或不应该）连接

返回 JSON 数组：
[
  {
    "pairIndex": 1,
    "sourceId": "节点A的ID",
    "targetId": "节点B的ID",
    "shouldConnect": true,
    "relationshipType": "类型",
    "confidence": 0.8,
    "explanation": "解释",
    "sharedConcepts": ["共享概念"],
    "suggestedLinkText": "建议的链接文本"
  }
]

待分析的节点对：
${pairDescriptions}`;

        try {
            const response = await LLMService._request(
                [vscode.LanguageModelChatMessage.User(prompt)],
                { signal: this.abortController?.signal }
            );

            if (!response) {return;}

            const results = this.parseJsonArray(response.text);

            for (const result of results) {
                if (result.shouldConnect && (result.confidence as number) >= this.config.minConfidenceThreshold) {
                    const pair = pairs[(result.pairIndex as number) - 1];
                    if (!pair) {continue;}

                    const [nodeA, nodeB] = pair;
                    const pairKey = [nodeA.id, nodeB.id].sort().join("-");

                    if (this.state.analyzedPairs.has(pairKey)) {continue;}
                    this.state.analyzedPairs.add(pairKey);

                    const connection: DiscoveredConnection = {
                        id: `conn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        sourceNode: {
                            id: nodeA.id,
                            title: nodeA.title,
                            filePath: nodeA.filePath,
                        },
                        targetNode: {
                            id: nodeB.id,
                            title: nodeB.title,
                            filePath: nodeB.filePath,
                        },
                        relationshipType: (result.relationshipType as DiscoveredConnection["relationshipType"]) || "semantic-similar",
                        confidence: result.confidence as number,
                        explanation: result.explanation as string,
                        sharedConcepts: (result.sharedConcepts as string[]) || [],
                        suggestedLinkText: result.suggestedLinkText as string | undefined,
                    };

                    this.state.discoveredConnections.push(connection);
                    this.onConnection?.(connection);
                }
            }
        } catch (error) {
            this.logger.warn("[KnowledgeGraphAgent] Pair analysis failed:", error);
        }
    }

    /**
     * 生成报告
     */
    private async generateReport(startTime: number): Promise<KnowledgeGraphReport> {
        this.updatePhase("synthesizing");
        this.emitProgress("正在生成分析报告...");

        const nodes = Array.from(this.state.nodes.values());
        const existingConnections = nodes.reduce((sum, n) => sum + n.connections.length, 0);

        // 识别知识孤岛
        const islands = this.identifyKnowledgeIslands(nodes);

        // 计算评分
        const coverageScore = Math.min(100, Math.floor(
            (nodes.length > 0 ? this.state.discoveredConnections.length / nodes.length : 0) * 50 + 50
        ));
        const cohesionScore = Math.min(100, Math.floor(
            ((existingConnections + this.state.discoveredConnections.length) / Math.max(1, nodes.length * 2)) * 100
        ));

        // 生成建议
        const recommendations = this.generateRecommendations(nodes, islands);

        const report: KnowledgeGraphReport = {
            id: `kgr-${Date.now()}`,
            timestamp: Date.now(),
            summary: {
                totalNodes: nodes.length,
                existingConnections,
                discoveredConnections: this.state.discoveredConnections.length,
                knowledgeIslands: islands.length,
                coverageScore,
                cohesionScore,
            },
            nodes,
            discoveredConnections: this.state.discoveredConnections,
            knowledgeIslands: islands,
            clusters: ((this.state as unknown as { clusters?: { name: string; nodeIds: string[]; description: string }[] }).clusters) || [],
            agentThoughts: this.state.thoughts,
            recommendations,
            metrics: {
                nodesAnalyzed: nodes.length,
                analysisRounds: this.state.currentRound,
                totalDuration: Date.now() - startTime,
            },
        };

        this.updatePhase("completed");
        this.updateProgress(100);

        return report;
    }

    private identifyKnowledgeIslands(nodes: KnowledgeNode[]): KnowledgeIsland[] {
        const islands: KnowledgeIsland[] = [];
        const connectedNodeIds = new Set<string>();

        // 收集所有有连接的节点
        for (const conn of this.state.discoveredConnections) {
            connectedNodeIds.add(conn.sourceNode.id);
            connectedNodeIds.add(conn.targetNode.id);
        }
        for (const node of nodes) {
            if (node.connections.length > 0) {
                connectedNodeIds.add(node.id);
            }
        }

        // 找出孤立节点
        const isolatedNodes = nodes.filter(n => !connectedNodeIds.has(n.id));

        if (isolatedNodes.length > 0) {
            islands.push({
                id: `island-isolated`,
                nodes: isolatedNodes,
                theme: "未分类知识",
                isolationReason: "这些知识点与其他内容没有建立关联",
                integrationSuggestion: "考虑为这些知识点添加与主知识库的连接，或创建索引文档",
            });
        }

        return islands;
    }

    private generateRecommendations(
        nodes: KnowledgeNode[], 
        islands: KnowledgeIsland[]
    ): KnowledgeGraphReport["recommendations"] {
        const recommendations: KnowledgeGraphReport["recommendations"] = [];

        // 高置信度连接建议
        const highConfConnections = this.state.discoveredConnections.filter(c => c.confidence >= 0.8);
        if (highConfConnections.length > 0) {
            recommendations.push({
                type: "connect",
                priority: "high",
                description: `发现 ${highConfConnections.length} 个高置信度的知识关联，强烈建议建立连接`,
                affectedNodes: highConfConnections.flatMap(c => [c.sourceNode.id, c.targetNode.id]),
            });
        }

        // 孤岛整合建议
        if (islands.length > 0) {
            recommendations.push({
                type: "reorganize",
                priority: "medium",
                description: `发现 ${islands.reduce((s, i) => s + i.nodes.length, 0)} 个孤立知识点，建议整合到主知识库`,
                affectedNodes: islands.flatMap(i => i.nodes.map(n => n.id)),
            });
        }

        return recommendations;
    }

    // ==================== 工具方法 ====================

    private updatePhase(phase: GraphAgentState["phase"]): void {
        this.state.phase = phase;
    }

    private updateProgress(progress: number): void {
        this.state.progress = progress;
    }

    private emitProgress(message: string): void {
        this.onProgress?.(this.state, message);
    }

    private recordThought(action: GraphAgentThought["action"], reasoning: string): GraphAgentThought {
        const thought: GraphAgentThought = {
            step: this.state.thoughts.length + 1,
            action,
            reasoning,
            timestamp: Date.now(),
        };
        this.state.thoughts.push(thought);
        return thought;
    }

    private emitThought(thought: GraphAgentThought): void {
        this.onThought?.(thought);
    }

    private parseJsonArray(text: string): Array<Record<string, unknown>> {
        try {
            const match = text.match(/\[[\s\S]*\]/);
            if (match) {
                return JSON.parse(match[0]) as Array<Record<string, unknown>>;
            }
        } catch {
            this.logger.warn("[KnowledgeGraphAgent] JSON array parse failed");
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
            this.logger.warn("[KnowledgeGraphAgent] JSON object parse failed");
        }
        return {};
    }
}

// ==================== 导出工具函数 ====================

/**
 * 快速执行知识图谱分析
 */
export async function runKnowledgeGraphAnalysis(
    options?: Partial<GraphAgentConfig> & { signal?: AbortSignal }
): Promise<KnowledgeGraphReport> {
    const agent = new KnowledgeGraphAgent(options);
    return agent.analyze(options);
}
