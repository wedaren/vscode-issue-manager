/**
 * 🔍 代码审阅持久化存储
 * 
 * 管理代码审阅历史记录：
 * - 存储完整的审阅报告
 * - 支持查询历史审阅
 * - 追踪问题修复状态
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { getIssueDir } from "../config";
import { Logger } from "../core/utils/Logger";
import type { CodeReviewReport, CodeFinding, IssueSeverity, IssueCategory } from "../llm/CodeReviewAgent";

// ==================== 类型定义 ====================

/** 审阅记录状态 */
export type ReviewStatus = "completed" | "in-progress" | "archived";

/** 发现的修复状态 */
export type FindingStatus = "open" | "fixed" | "wont-fix" | "false-positive";

/** 持久化的发现记录 */
export interface PersistedFinding extends CodeFinding {
    status: FindingStatus;
    fixedAt?: number;
    linkedIssueId?: string;      // 关联的问题文件 ID
    notes?: string;              // 用户备注
}

/** 持久化的审阅记录 */
export interface PersistedReviewRecord {
    id: string;
    timestamp: number;
    status: ReviewStatus;
    scope: {
        type: "workspace" | "folder" | "files" | "diff";
        paths: string[];
        description: string;
    };
    summary: {
        overallScore: number;
        strengths: string[];
        areasForImprovement: string[];
        riskLevel: "low" | "medium" | "high";
    };
    findings: PersistedFinding[];
    metrics: {
        filesAnalyzed: number;
        linesAnalyzed: number;
        explorationRounds: number;
        totalDuration: number;
    };
    actionPlan: {
        immediate: string[];
        shortTerm: string[];
        longTerm: string[];
    };
    // 统计
    stats: {
        totalFindings: number;
        openFindings: number;
        fixedFindings: number;
        criticalCount: number;
        majorCount: number;
        minorCount: number;
        suggestionCount: number;
    };
}

/** 审阅历史数据 */
export interface CodeReviewHistoryData {
    version: number;
    reviews: PersistedReviewRecord[];
    lastUpdated: number;
}

// ==================== 存储实现 ====================

const HISTORY_VERSION = 1;
const HISTORY_FILENAME = "codeReviewHistory.json";

/**
 * 获取历史文件路径
 */
function getHistoryFilePath(): string | null {
    const issueDir = getIssueDir();
    if (!issueDir) return null;
    
    const configDir = path.join(issueDir, ".issueManager");
    return path.join(configDir, HISTORY_FILENAME);
}

/**
 * 确保配置目录存在
 */
function ensureConfigDir(): string | null {
    const issueDir = getIssueDir();
    if (!issueDir) return null;
    
    const configDir = path.join(issueDir, ".issueManager");
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }
    return configDir;
}

/**
 * 读取审阅历史
 */
export function readCodeReviewHistory(): CodeReviewHistoryData {
    const filePath = getHistoryFilePath();
    if (!filePath || !fs.existsSync(filePath)) {
        return {
            version: HISTORY_VERSION,
            reviews: [],
            lastUpdated: Date.now(),
        };
    }

    try {
        const content = fs.readFileSync(filePath, "utf-8");
        const data = JSON.parse(content) as CodeReviewHistoryData;
        return {
            ...data,
            version: data.version || HISTORY_VERSION,
        };
    } catch (error) {
        Logger.getInstance().error("[CodeReviewHistory] Failed to read history:", error);
        return {
            version: HISTORY_VERSION,
            reviews: [],
            lastUpdated: Date.now(),
        };
    }
}

/**
 * 保存审阅历史
 */
function saveCodeReviewHistory(data: CodeReviewHistoryData): void {
    ensureConfigDir();
    const filePath = getHistoryFilePath();
    if (!filePath) return;

    try {
        data.lastUpdated = Date.now();
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (error) {
        Logger.getInstance().error("[CodeReviewHistory] Failed to save history:", error);
    }
}

/**
 * 从完整报告创建持久化记录
 */
export function createPersistedRecord(report: CodeReviewReport): PersistedReviewRecord {
    const findings: PersistedFinding[] = report.findings.map(f => ({
        ...f,
        status: "open" as FindingStatus,
    }));

    const stats = calculateStats(findings);

    return {
        id: report.id,
        timestamp: report.timestamp,
        status: "completed",
        scope: report.scope,
        summary: report.summary,
        findings,
        metrics: report.metrics,
        actionPlan: report.actionPlan,
        stats,
    };
}

/**
 * 计算统计信息
 */
function calculateStats(findings: PersistedFinding[]): PersistedReviewRecord["stats"] {
    return {
        totalFindings: findings.length,
        openFindings: findings.filter(f => f.status === "open").length,
        fixedFindings: findings.filter(f => f.status === "fixed").length,
        criticalCount: findings.filter(f => f.severity === "critical").length,
        majorCount: findings.filter(f => f.severity === "major").length,
        minorCount: findings.filter(f => f.severity === "minor").length,
        suggestionCount: findings.filter(f => f.severity === "suggestion").length,
    };
}

/**
 * 添加审阅记录
 */
export function addCodeReviewRecord(report: CodeReviewReport): PersistedReviewRecord {
    const history = readCodeReviewHistory();
    const record = createPersistedRecord(report);
    
    history.reviews.unshift(record); // 最新的在前面
    
    // 限制历史记录数量（保留最近 50 条）
    if (history.reviews.length > 50) {
        history.reviews = history.reviews.slice(0, 50);
    }
    
    saveCodeReviewHistory(history);
    return record;
}

/**
 * 更新发现状态
 */
export function updateFindingStatus(
    reviewId: string,
    findingId: string,
    status: FindingStatus,
    notes?: string
): boolean {
    const history = readCodeReviewHistory();
    const review = history.reviews.find(r => r.id === reviewId);
    
    if (!review) return false;
    
    const finding = review.findings.find(f => f.id === findingId);
    if (!finding) return false;
    
    finding.status = status;
    if (status === "fixed") {
        finding.fixedAt = Date.now();
    }
    if (notes !== undefined) {
        finding.notes = notes;
    }
    
    // 重新计算统计
    review.stats = calculateStats(review.findings);
    
    saveCodeReviewHistory(history);
    return true;
}

/**
 * 关联发现到问题
 */
export function linkFindingToIssue(
    reviewId: string,
    findingId: string,
    issueId: string
): boolean {
    const history = readCodeReviewHistory();
    const review = history.reviews.find(r => r.id === reviewId);
    
    if (!review) return false;
    
    const finding = review.findings.find(f => f.id === findingId);
    if (!finding) return false;
    
    finding.linkedIssueId = issueId;
    saveCodeReviewHistory(history);
    return true;
}

/**
 * 获取特定审阅记录
 */
export function getCodeReviewRecord(reviewId: string): PersistedReviewRecord | undefined {
    const history = readCodeReviewHistory();
    return history.reviews.find(r => r.id === reviewId);
}

/**
 * 获取最近的审阅记录
 */
export function getRecentCodeReviews(limit = 10): PersistedReviewRecord[] {
    const history = readCodeReviewHistory();
    return history.reviews.slice(0, limit);
}

/**
 * 获取所有未解决的发现
 */
export function getAllOpenFindings(): Array<{
    reviewId: string;
    reviewTimestamp: number;
    finding: PersistedFinding;
}> {
    const history = readCodeReviewHistory();
    const openFindings: Array<{
        reviewId: string;
        reviewTimestamp: number;
        finding: PersistedFinding;
    }> = [];

    for (const review of history.reviews) {
        for (const finding of review.findings) {
            if (finding.status === "open") {
                openFindings.push({
                    reviewId: review.id,
                    reviewTimestamp: review.timestamp,
                    finding,
                });
            }
        }
    }

    return openFindings;
}

/**
 * 按严重程度获取未解决发现
 */
export function getOpenFindingsBySeverity(severity: IssueSeverity): Array<{
    reviewId: string;
    finding: PersistedFinding;
}> {
    return getAllOpenFindings()
        .filter(item => item.finding.severity === severity)
        .map(item => ({ reviewId: item.reviewId, finding: item.finding }));
}

/**
 * 按类别获取未解决发现
 */
export function getOpenFindingsByCategory(category: IssueCategory): Array<{
    reviewId: string;
    finding: PersistedFinding;
}> {
    return getAllOpenFindings()
        .filter(item => item.finding.category === category)
        .map(item => ({ reviewId: item.reviewId, finding: item.finding }));
}

/**
 * 删除审阅记录
 */
export function deleteCodeReviewRecord(reviewId: string): boolean {
    const history = readCodeReviewHistory();
    const index = history.reviews.findIndex(r => r.id === reviewId);
    
    if (index === -1) return false;
    
    history.reviews.splice(index, 1);
    saveCodeReviewHistory(history);
    return true;
}

/**
 * 归档审阅记录
 */
export function archiveCodeReviewRecord(reviewId: string): boolean {
    const history = readCodeReviewHistory();
    const review = history.reviews.find(r => r.id === reviewId);
    
    if (!review) return false;
    
    review.status = "archived";
    saveCodeReviewHistory(history);
    return true;
}

/**
 * 获取审阅统计摘要
 */
export function getCodeReviewSummary(): {
    totalReviews: number;
    totalFindings: number;
    openFindings: number;
    fixedFindings: number;
    averageScore: number;
    severityDistribution: Record<IssueSeverity, number>;
    categoryDistribution: Record<IssueCategory, number>;
} {
    const history = readCodeReviewHistory();
    
    let totalFindings = 0;
    let openFindings = 0;
    let fixedFindings = 0;
    let totalScore = 0;
    
    const severityDistribution: Record<IssueSeverity, number> = {
        critical: 0,
        major: 0,
        minor: 0,
        suggestion: 0,
    };
    
    const categoryDistribution: Record<IssueCategory, number> = {
        security: 0,
        performance: 0,
        maintainability: 0,
        reliability: 0,
        architecture: 0,
        "best-practice": 0,
        documentation: 0,
        testing: 0,
        "type-safety": 0,
    };
    
    for (const review of history.reviews) {
        totalScore += review.summary.overallScore;
        
        for (const finding of review.findings) {
            totalFindings++;
            
            if (finding.status === "open") openFindings++;
            if (finding.status === "fixed") fixedFindings++;
            
            severityDistribution[finding.severity]++;
            categoryDistribution[finding.category]++;
        }
    }
    
    return {
        totalReviews: history.reviews.length,
        totalFindings,
        openFindings,
        fixedFindings,
        averageScore: history.reviews.length > 0 
            ? Math.round(totalScore / history.reviews.length) 
            : 0,
        severityDistribution,
        categoryDistribution,
    };
}
