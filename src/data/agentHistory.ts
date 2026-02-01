/**
 * 🧠 Agent 历史记录持久化模块
 * 
 * 为三个 LLM Agent 提供统一的历史记录存储：
 * - 知识图谱 Agent - 保存分析报告
 * - 学习路径 Agent - 保存学习路径和进度
 * - 创意激发 Agent - 保存创意会话和火花
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { Logger } from "../core/utils/Logger";
import { KnowledgeGraphReport, KnowledgeNode, DiscoveredConnection, KnowledgeIsland } from "../llm/KnowledgeGraphAgent";
import { LearningPath, LearningProgress } from "../llm/LearningPathAgent";
import { IdeaSession, IdeaSpark } from "../llm/IdeaSparkAgent";

// ==================== 知识图谱历史 ====================

/** 持久化的知识图谱报告 */
export interface PersistedKnowledgeGraphReport {
    id: string;
    timestamp: number;
    starred: boolean;
    notes?: string;
    // 从 KnowledgeGraphReport 提取的关键数据
    nodes: KnowledgeNode[];
    discoveredConnections: DiscoveredConnection[];
    knowledgeIslands: KnowledgeIsland[];
    summary: {
        totalNodes: number;
        existingConnections: number;
        discoveredConnections: number;
        knowledgeIslands: number;
        coverageScore: number;
        cohesionScore: number;
    };
}

/** 知识图谱历史记录 */
export interface KnowledgeGraphHistory {
    version: number;
    reports: PersistedKnowledgeGraphReport[];
}

// ==================== 学习路径历史 ====================

/** 持久化的学习路径 */
export interface PersistedLearningPath extends LearningPath {
    id: string;
    timestamp: number;
    starred: boolean;
    notes?: string;
    progress: {
        pathId: string;
        completedNodes: string[];
        currentStage: number;
        startTime: number;
        totalTimeSpent: number;
    };
}

/** 学习路径历史记录 */
export interface LearningPathHistory {
    version: number;
    paths: PersistedLearningPath[];
}

// ==================== 创意激发历史 ====================

/** 持久化的创意火花（带 isFavorite 标记） */
export interface PersistedIdeaSpark extends Omit<IdeaSpark, never> {
    isFavorite: boolean;
}

/** 持久化的创意会话 */
export interface PersistedIdeaSession {
    id: string;
    timestamp: number;
    starred: boolean;
    notes?: string;
    theme?: string;
    sparks: PersistedIdeaSpark[];
    totalConceptsExplored: number;
    duration: number;
    savedIdeas: string[];
}

/** 创意激发历史记录 */
export interface IdeaSparkHistory {
    version: number;
    sessions: PersistedIdeaSession[];
}

// ==================== 辅助函数 ====================

const logger = Logger.getInstance();

/** 获取存储目录 */
function getStorageDir(): string | null {
    const config = vscode.workspace.getConfiguration("issueManager");
    const issueDir = config.get<string>("issueDir");
    if (!issueDir) {
        return null;
    }
    
    const storageDir = path.join(issueDir, ".issueManager", "agents");
    if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
    }
    return storageDir;
}

/** 生成唯一 ID */
function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// ==================== 知识图谱历史操作 ====================

const KNOWLEDGE_GRAPH_FILE = "knowledge-graph-history.json";

/** 读取知识图谱历史 */
export function readKnowledgeGraphHistory(): KnowledgeGraphHistory {
    const storageDir = getStorageDir();
    if (!storageDir) {
        return { version: 1, reports: [] };
    }
    
    const filePath = path.join(storageDir, KNOWLEDGE_GRAPH_FILE);
    if (!fs.existsSync(filePath)) {
        return { version: 1, reports: [] };
    }
    
    try {
        const content = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(content) as KnowledgeGraphHistory;
    } catch (error) {
        logger.warn("读取知识图谱历史失败", error);
        return { version: 1, reports: [] };
    }
}

/** 保存知识图谱历史 */
function saveKnowledgeGraphHistory(history: KnowledgeGraphHistory): void {
    const storageDir = getStorageDir();
    if (!storageDir) {
        return;
    }
    
    const filePath = path.join(storageDir, KNOWLEDGE_GRAPH_FILE);
    try {
        fs.writeFileSync(filePath, JSON.stringify(history, null, 2), "utf-8");
    } catch (error) {
        logger.warn("保存知识图谱历史失败", error);
    }
}

/** 添加知识图谱报告 */
export function addKnowledgeGraphReport(report: KnowledgeGraphReport): PersistedKnowledgeGraphReport {
    const history = readKnowledgeGraphHistory();
    
    const persisted: PersistedKnowledgeGraphReport = {
        id: generateId(),
        timestamp: Date.now(),
        starred: false,
        nodes: report.nodes,
        discoveredConnections: report.discoveredConnections,
        knowledgeIslands: report.knowledgeIslands,
        summary: report.summary,
    };
    
    // 最新的放在最前面
    history.reports.unshift(persisted);
    
    // 保留最近 50 条
    if (history.reports.length > 50) {
        history.reports = history.reports.slice(0, 50);
    }
    
    saveKnowledgeGraphHistory(history);
    return persisted;
}

/** 更新知识图谱报告 */
export function updateKnowledgeGraphReport(
    id: string, 
    updates: Partial<Pick<PersistedKnowledgeGraphReport, "starred" | "notes">>
): void {
    const history = readKnowledgeGraphHistory();
    const report = history.reports.find(r => r.id === id);
    if (report) {
        Object.assign(report, updates);
        saveKnowledgeGraphHistory(history);
    }
}

/** 删除知识图谱报告 */
export function deleteKnowledgeGraphReport(id: string): void {
    const history = readKnowledgeGraphHistory();
    history.reports = history.reports.filter(r => r.id !== id);
    saveKnowledgeGraphHistory(history);
}

/** 获取知识图谱统计 */
export function getKnowledgeGraphSummary(): {
    totalReports: number;
    starredReports: number;
    totalConnections: number;
    totalNodes: number;
} {
    const history = readKnowledgeGraphHistory();
    return {
        totalReports: history.reports.length,
        starredReports: history.reports.filter(r => r.starred).length,
        totalConnections: history.reports.reduce((sum, r) => sum + r.discoveredConnections.length, 0),
        totalNodes: history.reports.reduce((sum, r) => sum + r.nodes.length, 0),
    };
}

// ==================== 学习路径历史操作 ====================

const LEARNING_PATH_FILE = "learning-path-history.json";

/** 读取学习路径历史 */
export function readLearningPathHistory(): LearningPathHistory {
    const storageDir = getStorageDir();
    if (!storageDir) {
        return { version: 1, paths: [] };
    }
    
    const filePath = path.join(storageDir, LEARNING_PATH_FILE);
    if (!fs.existsSync(filePath)) {
        return { version: 1, paths: [] };
    }
    
    try {
        const content = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(content) as LearningPathHistory;
    } catch (error) {
        logger.warn("读取学习路径历史失败", error);
        return { version: 1, paths: [] };
    }
}

/** 保存学习路径历史 */
function saveLearningPathHistory(history: LearningPathHistory): void {
    const storageDir = getStorageDir();
    if (!storageDir) {
        return;
    }
    
    const filePath = path.join(storageDir, LEARNING_PATH_FILE);
    try {
        fs.writeFileSync(filePath, JSON.stringify(history, null, 2), "utf-8");
    } catch (error) {
        logger.warn("保存学习路径历史失败", error);
    }
}

/** 添加学习路径 */
export function addLearningPath(learningPath: LearningPath): PersistedLearningPath {
    const history = readLearningPathHistory();
    
    const id = generateId();
    const persisted: PersistedLearningPath = {
        ...learningPath,
        id,
        timestamp: Date.now(),
        starred: false,
        progress: {
            pathId: id,
            completedNodes: [],
            currentStage: 0,
            startTime: Date.now(),
            totalTimeSpent: 0,
        },
    };
    
    // 最新的放在最前面
    history.paths.unshift(persisted);
    
    // 保留最近 30 条
    if (history.paths.length > 30) {
        history.paths = history.paths.slice(0, 30);
    }
    
    saveLearningPathHistory(history);
    return persisted;
}

/** 更新学习路径 */
export function updateLearningPath(
    id: string, 
    updates: Partial<Pick<PersistedLearningPath, "starred" | "notes" | "progress">>
): void {
    const history = readLearningPathHistory();
    const learningPath = history.paths.find(p => p.id === id);
    if (learningPath) {
        Object.assign(learningPath, updates);
        saveLearningPathHistory(history);
    }
}

/** 更新学习进度 */
export function updateLearningProgress(pathId: string, nodeId: string, completed: boolean): void {
    const history = readLearningPathHistory();
    const learningPath = history.paths.find(p => p.id === pathId);
    if (learningPath) {
        if (completed) {
            if (!learningPath.progress.completedNodes.includes(nodeId)) {
                learningPath.progress.completedNodes.push(nodeId);
            }
        } else {
            learningPath.progress.completedNodes = 
                learningPath.progress.completedNodes.filter((n: string) => n !== nodeId);
        }
        saveLearningPathHistory(history);
    }
}

/** 删除学习路径 */
export function deleteLearningPath(id: string): void {
    const history = readLearningPathHistory();
    history.paths = history.paths.filter(p => p.id !== id);
    saveLearningPathHistory(history);
}

/** 获取学习路径统计 */
export function getLearningPathSummary(): {
    totalPaths: number;
    activePaths: number;
    completedPaths: number;
    totalNodes: number;
    completedNodes: number;
} {
    const history = readLearningPathHistory();
    let totalNodes = 0;
    let completedNodes = 0;
    let completedPaths = 0;
    
    for (const p of history.paths) {
        const pathNodes = p.stages.reduce((sum, s) => sum + s.nodes.length, 0);
        totalNodes += pathNodes;
        completedNodes += p.progress.completedNodes.length;
        if (p.progress.completedNodes.length >= pathNodes && pathNodes > 0) {
            completedPaths++;
        }
    }
    
    return {
        totalPaths: history.paths.length,
        activePaths: history.paths.length - completedPaths,
        completedPaths,
        totalNodes,
        completedNodes,
    };
}

// ==================== 创意激发历史操作 ====================

const IDEA_SPARK_FILE = "idea-spark-history.json";

/** 读取创意激发历史 */
export function readIdeaSparkHistory(): IdeaSparkHistory {
    const storageDir = getStorageDir();
    if (!storageDir) {
        return { version: 1, sessions: [] };
    }
    
    const filePath = path.join(storageDir, IDEA_SPARK_FILE);
    if (!fs.existsSync(filePath)) {
        return { version: 1, sessions: [] };
    }
    
    try {
        const content = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(content) as IdeaSparkHistory;
    } catch (error) {
        logger.warn("读取创意激发历史失败", error);
        return { version: 1, sessions: [] };
    }
}

/** 保存创意激发历史 */
function saveIdeaSparkHistory(history: IdeaSparkHistory): void {
    const storageDir = getStorageDir();
    if (!storageDir) {
        return;
    }
    
    const filePath = path.join(storageDir, IDEA_SPARK_FILE);
    try {
        fs.writeFileSync(filePath, JSON.stringify(history, null, 2), "utf-8");
    } catch (error) {
        logger.warn("保存创意激发历史失败", error);
    }
}

/** 添加创意会话 */
export function addIdeaSession(session: IdeaSession): PersistedIdeaSession {
    const history = readIdeaSparkHistory();
    
    // 转换 sparks 为带 isFavorite 的版本
    const persistedSparks: PersistedIdeaSpark[] = session.sparks.map(spark => ({
        ...spark,
        isFavorite: false,
    }));
    
    const persisted: PersistedIdeaSession = {
        id: generateId(),
        timestamp: Date.now(),
        starred: false,
        theme: session.theme,
        sparks: persistedSparks,
        totalConceptsExplored: session.totalConceptsExplored,
        duration: session.duration,
        savedIdeas: session.savedIdeas,
    };
    
    // 最新的放在最前面
    history.sessions.unshift(persisted);
    
    // 保留最近 100 条
    if (history.sessions.length > 100) {
        history.sessions = history.sessions.slice(0, 100);
    }
    
    saveIdeaSparkHistory(history);
    return persisted;
}

/** 更新创意会话 */
export function updateIdeaSession(
    id: string, 
    updates: Partial<Pick<PersistedIdeaSession, "starred" | "notes">>
): void {
    const history = readIdeaSparkHistory();
    const session = history.sessions.find(s => s.id === id);
    if (session) {
        Object.assign(session, updates);
        saveIdeaSparkHistory(history);
    }
}

/** 收藏/取消收藏创意火花 */
export function toggleSparkFavorite(sessionId: string, sparkIndex: number): void {
    const history = readIdeaSparkHistory();
    const session = history.sessions.find(s => s.id === sessionId);
    if (session && session.sparks[sparkIndex]) {
        session.sparks[sparkIndex].isFavorite = !session.sparks[sparkIndex].isFavorite;
        saveIdeaSparkHistory(history);
    }
}

/** 删除创意会话 */
export function deleteIdeaSession(id: string): void {
    const history = readIdeaSparkHistory();
    history.sessions = history.sessions.filter(s => s.id !== id);
    saveIdeaSparkHistory(history);
}

/** 获取创意激发统计 */
export function getIdeaSparkSummary(): {
    totalSessions: number;
    starredSessions: number;
    totalSparks: number;
    favoriteSparks: number;
    sparksByMethod: Record<string, number>;
} {
    const history = readIdeaSparkHistory();
    const sparksByMethod: Record<string, number> = {};
    let totalSparks = 0;
    let favoriteSparks = 0;
    
    for (const session of history.sessions) {
        totalSparks += session.sparks.length;
        for (const spark of session.sparks) {
            if (spark.isFavorite) {
                favoriteSparks++;
            }
            const method = spark.collisionType || "unknown";
            sparksByMethod[method] = (sparksByMethod[method] || 0) + 1;
        }
    }
    
    return {
        totalSessions: history.sessions.length,
        starredSessions: history.sessions.filter(s => s.starred).length,
        totalSparks,
        favoriteSparks,
        sparksByMethod,
    };
}
