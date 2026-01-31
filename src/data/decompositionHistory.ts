/**
 * 🧩 问题分解历史数据管理
 * 
 * 管理分解任务的持久化存储，支持：
 * - 分解任务记录的保存和读取
 * - 分解任务状态跟踪（待处理、进行中、已完成）
 * - 已创建的问题文件关联
 */

import * as vscode from "vscode";
import * as path from "path";
import { getIssueDir } from "../config";
import { Logger } from "../core/utils/Logger";
import { v4 as uuidv4 } from 'uuid';

/** 分解任务状态 */
export type DecompositionStatus = "pending" | "processing" | "completed" | "partial" | "cancelled";

/** 子问题优先级 */
export type SubQuestionPriority = "P0" | "P1" | "P2";

/** 已创建的问题文件信息 */
export interface CreatedIssueInfo {
    subQuestionId: number;
    title: string;
    filePath: string;
    nodeId?: string;
    createdAt: number;
}

/** 子问题记录（包含原始信息和创建状态） */
export interface SubQuestionRecord {
    id: number;
    title: string;
    description: string;
    priority: SubQuestionPriority;
    dependencies: number[];
    keywords: string[];
    suggestedContent: string;
    /** 是否已创建对应的问题文件 */
    isCreated: boolean;
    /** 创建的问题文件信息 */
    createdIssue?: CreatedIssueInfo;
}

/** 分解任务记录 */
export interface DecompositionRecord {
    /** 唯一标识 */
    id: string;
    /** 原始问题 */
    rootQuestion: string;
    /** 概述 */
    overview: string;
    /** 建议学习路径 */
    suggestedPath: string;
    /** 预估总时间 */
    estimatedTotalTime: string;
    /** 子问题列表 */
    subQuestions: SubQuestionRecord[];
    /** 任务状态 */
    status: DecompositionStatus;
    /** 创建时间 */
    createdAt: number;
    /** 更新时间 */
    updatedAt: number;
    /** 父问题文件信息（如果已创建） */
    parentIssue?: CreatedIssueInfo;
    /** 完成进度百分比 (0-100) */
    progress: number;
    /** 来源（chat、command等） */
    source: "chat" | "command" | "quickopen";
}

/** 分解历史数据 */
export interface DecompositionHistoryData {
    version: string;
    records: DecompositionRecord[];
}

const DECOMPOSITION_HISTORY_FILE = "decompositionHistory.json";
const DEFAULT_HISTORY_DATA: DecompositionHistoryData = {
    version: "1.0.0",
    records: []
};

/**
 * 获取分解历史文件路径
 */
async function getDecompositionHistoryPath(): Promise<string | null> {
    const issueDir = getIssueDir();
    if (!issueDir) {
        return null;
    }

    const dataDir = path.join(issueDir, ".issueManager");
    try {
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(dataDir));
    } catch {
        // 目录可能已存在，忽略
    }

    return path.join(dataDir, DECOMPOSITION_HISTORY_FILE);
}

/**
 * 验证子问题记录
 */
function isSubQuestionRecord(item: unknown): item is SubQuestionRecord {
    if (!item || typeof item !== "object") {
        return false;
    }
    const r = item as Record<string, unknown>;
    return (
        typeof r.id === "number" &&
        typeof r.title === "string" &&
        typeof r.description === "string" &&
        (r.priority === "P0" || r.priority === "P1" || r.priority === "P2") &&
        Array.isArray(r.dependencies) &&
        Array.isArray(r.keywords) &&
        typeof r.suggestedContent === "string" &&
        typeof r.isCreated === "boolean"
    );
}

/**
 * 验证分解任务记录
 */
function isDecompositionRecord(item: unknown): item is DecompositionRecord {
    if (!item || typeof item !== "object") {
        return false;
    }
    const r = item as Record<string, unknown>;
    const validStatuses: DecompositionStatus[] = ["pending", "processing", "completed", "partial", "cancelled"];
    const validSources = ["chat", "command", "quickopen"];
    
    return (
        typeof r.id === "string" &&
        typeof r.rootQuestion === "string" &&
        typeof r.overview === "string" &&
        typeof r.suggestedPath === "string" &&
        typeof r.estimatedTotalTime === "string" &&
        Array.isArray(r.subQuestions) &&
        r.subQuestions.every(isSubQuestionRecord) &&
        validStatuses.includes(r.status as DecompositionStatus) &&
        typeof r.createdAt === "number" &&
        typeof r.updatedAt === "number" &&
        typeof r.progress === "number" &&
        validSources.includes(r.source as string)
    );
}

/**
 * 读取分解历史数据
 */
export async function readDecompositionHistory(): Promise<DecompositionHistoryData> {
    const historyPath = await getDecompositionHistoryPath();
    if (!historyPath) {
        return { ...DEFAULT_HISTORY_DATA };
    }

    try {
        const content = await vscode.workspace.fs.readFile(vscode.Uri.file(historyPath));
        const data = JSON.parse(content.toString());
        if (!Array.isArray(data.records)) {
            return { ...DEFAULT_HISTORY_DATA };
        }
        const records = data.records.filter(isDecompositionRecord);

        return {
            version: typeof data.version === "string" ? data.version : DEFAULT_HISTORY_DATA.version,
            records
        };
    } catch (error) {
        Logger.getInstance().warn("读取 decompositionHistory.json 失败", error);
        return { ...DEFAULT_HISTORY_DATA };
    }
}

/**
 * 写入分解历史数据
 */
export async function writeDecompositionHistory(data: DecompositionHistoryData): Promise<void> {
    const historyPath = await getDecompositionHistoryPath();
    if (!historyPath) {
        Logger.getInstance().warn("无法写入分解历史，问题目录未配置。");
        return;
    }

    try {
        const content = Buffer.from(JSON.stringify(data, null, 2), "utf8");
        await vscode.workspace.fs.writeFile(vscode.Uri.file(historyPath), content);
    } catch (error) {
        Logger.getInstance().error("写入分解历史失败", error);
    }
}

/**
 * 创建新的分解任务记录
 */
export function createDecompositionRecord(
    decomposition: {
        rootQuestion: string;
        overview: string;
        subQuestions: Array<{
            id: number;
            title: string;
            description: string;
            priority: SubQuestionPriority;
            dependencies: number[];
            keywords: string[];
            suggestedContent: string;
        }>;
        suggestedPath: string;
        estimatedTotalTime: string;
    },
    source: "chat" | "command" | "quickopen"
): DecompositionRecord {
    const now = Date.now();
    return {
        id: `decomposition-${uuidv4()}`,
        rootQuestion: decomposition.rootQuestion,
        overview: decomposition.overview,
        suggestedPath: decomposition.suggestedPath,
        estimatedTotalTime: decomposition.estimatedTotalTime,
        subQuestions: decomposition.subQuestions.map(sq => ({
            ...sq,
            isCreated: false
        })),
        status: "pending",
        createdAt: now,
        updatedAt: now,
        progress: 0,
        source
    };
}

/**
 * 添加分解记录
 */
export async function addDecompositionRecord(record: DecompositionRecord, limit = 100): Promise<void> {
    const data = await readDecompositionHistory();
    // 避免重复
    const records = data.records.filter(item => item.id !== record.id);
    records.unshift(record);
    if (records.length > limit) {
        records.splice(limit);
    }
    await writeDecompositionHistory({ ...data, records });
}

/**
 * 更新分解记录
 */
export async function updateDecompositionRecord(
    recordId: string, 
    updates: Partial<Omit<DecompositionRecord, 'id' | 'createdAt'>>
): Promise<DecompositionRecord | null> {
    const data = await readDecompositionHistory();
    const index = data.records.findIndex(r => r.id === recordId);
    if (index === -1) {
        return null;
    }

    const updated: DecompositionRecord = {
        ...data.records[index],
        ...updates,
        updatedAt: Date.now()
    };
    
    // 重新计算进度
    const createdCount = updated.subQuestions.filter(sq => sq.isCreated).length;
    updated.progress = Math.round((createdCount / updated.subQuestions.length) * 100);
    
    // 更新状态
    if (updated.progress === 100) {
        updated.status = "completed";
    } else if (updated.progress > 0) {
        updated.status = "partial";
    }

    data.records[index] = updated;
    await writeDecompositionHistory(data);
    return updated;
}

/**
 * 标记子问题为已创建
 */
export async function markSubQuestionCreated(
    recordId: string,
    subQuestionId: number,
    createdIssue: CreatedIssueInfo
): Promise<DecompositionRecord | null> {
    const data = await readDecompositionHistory();
    const recordIndex = data.records.findIndex(r => r.id === recordId);
    if (recordIndex === -1) {
        return null;
    }

    const record = data.records[recordIndex];
    const sqIndex = record.subQuestions.findIndex(sq => sq.id === subQuestionId);
    if (sqIndex === -1) {
        return null;
    }

    record.subQuestions[sqIndex].isCreated = true;
    record.subQuestions[sqIndex].createdIssue = createdIssue;

    return updateDecompositionRecord(recordId, { subQuestions: record.subQuestions });
}

/**
 * 设置父问题已创建
 */
export async function setParentIssueCreated(
    recordId: string,
    parentIssue: CreatedIssueInfo
): Promise<DecompositionRecord | null> {
    return updateDecompositionRecord(recordId, { parentIssue });
}

/**
 * 删除分解记录
 */
export async function deleteDecompositionRecord(recordId: string): Promise<boolean> {
    const data = await readDecompositionHistory();
    const originalLength = data.records.length;
    data.records = data.records.filter(r => r.id !== recordId);
    
    if (data.records.length === originalLength) {
        return false;
    }
    
    await writeDecompositionHistory(data);
    return true;
}

/**
 * 获取指定记录
 */
export async function getDecompositionRecord(recordId: string): Promise<DecompositionRecord | null> {
    const data = await readDecompositionHistory();
    return data.records.find(r => r.id === recordId) || null;
}

/**
 * 更新分解记录状态
 */
export async function updateDecompositionStatus(
    recordId: string,
    status: DecompositionStatus
): Promise<DecompositionRecord | null> {
    return updateDecompositionRecord(recordId, { status });
}
