import * as vscode from "vscode";
import * as path from "path";
import { getIssueDir } from "../config";
import { Logger } from "../core/utils/Logger";

/**
 * 深度调研模式
 * - auto: 自动选择最佳模式
 * - local: 基于本地笔记进行调研
 * - llmOnly: 纯 LLM 模式，不参考本地笔记
 */
export type DeepResearchMode = "auto" | "local" | "llmOnly";

/**
 * 深度调研任务状态
 */
export type DeepResearchTaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

/**
 * 深度调研结果
 */
export interface DeepResearchResult {
    /** 调研主题 */
    topic: string;
    /** 调研内容/报告 */
    content: string;
    /** 调研模式 */
    mode: DeepResearchMode;
    /** 引用的本地笔记（local 模式） */
    references?: Array<{
        title: string;
        filePath: string;
    }>;
    /** 生成时间 */
    generatedAt: number;
}

/**
 * 深度调研任务
 */
export interface DeepResearchTask {
    /** 任务 ID */
    id: string;
    /** 调研主题 */
    topic: string;
    /** 调研模式 */
    mode: DeepResearchMode;
    /** 任务状态 */
    status: DeepResearchTaskStatus;
    /** 创建时间 */
    createdAt: number;
    /** 更新时间 */
    updatedAt: number;
    /** 结果（完成后） */
    result?: DeepResearchResult;
    /** 错误信息（失败时） */
    error?: string;
    /** 取消令牌 */
    abortController?: AbortController;
}

/**
 * 深度调研文档
 */
export interface DeepResearchDocument {
    /** 文档 ID */
    id: string;
    /** 调研主题 */
    topic: string;
    /** 文档文件路径 */
    filePath: string;
    /** 创建时间 */
    createdAt: number;
    /** 最后修改时间 */
    lastModified: number;
    /** 调研模式 */
    mode: DeepResearchMode;
}

/**
 * 深度调研历史数据
 */
export interface DeepResearchHistoryData {
    version: string;
    documents: DeepResearchDocument[];
}

const DEEP_RESEARCH_HISTORY_FILE = "deepResearchHistory.json";
const DEFAULT_HISTORY_DATA: DeepResearchHistoryData = {
    version: "1.0.0",
    documents: []
};

/**
 * 获取深度调研历史文件路径
 */
const getDeepResearchHistoryPath = async (): Promise<string | null> => {
    const issueDir = getIssueDir();
    if (!issueDir) {
        return null;
    }

    const dataDir = path.join(issueDir, ".issueManager");
    try {
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(dataDir));
    } catch (error) {
        Logger.getInstance().error("创建 .issueManager 目录失败", error);
        return null;
    }

    return path.join(dataDir, DEEP_RESEARCH_HISTORY_FILE);
};

/**
 * 类型守卫：检查是否为有效的深度调研文档
 */
function isDeepResearchDocument(item: unknown): item is DeepResearchDocument {
    if (!item || typeof item !== "object") {
        return false;
    }
    const doc = item as Record<string, unknown>;
    return (
        typeof doc.id === "string" &&
        typeof doc.topic === "string" &&
        typeof doc.filePath === "string" &&
        typeof doc.createdAt === "number" &&
        typeof doc.lastModified === "number" &&
        (doc.mode === "auto" || doc.mode === "local" || doc.mode === "llmOnly")
    );
}

/**
 * 读取深度调研历史
 */
export async function readDeepResearchHistory(): Promise<DeepResearchHistoryData> {
    const historyPath = await getDeepResearchHistoryPath();
    if (!historyPath) {
        return { ...DEFAULT_HISTORY_DATA };
    }

    try {
        const content = await vscode.workspace.fs.readFile(vscode.Uri.file(historyPath));
        const data = JSON.parse(content.toString());
        if (!Array.isArray(data.documents)) {
            return { ...DEFAULT_HISTORY_DATA };
        }
        const documents = data.documents.filter(isDeepResearchDocument);

        return {
            version: typeof data.version === "string" ? data.version : DEFAULT_HISTORY_DATA.version,
            documents
        };
    } catch (error) {
        Logger.getInstance().warn("读取深度调研历史失败", error);
        return { ...DEFAULT_HISTORY_DATA };
    }
}

/**
 * 写入深度调研历史
 */
export async function writeDeepResearchHistory(data: DeepResearchHistoryData): Promise<void> {
    const historyPath = await getDeepResearchHistoryPath();
    if (!historyPath) {
        vscode.window.showErrorMessage("无法写入深度调研历史，问题目录未配置。");
        return;
    }

    try {
        const content = Buffer.from(JSON.stringify(data, null, 2), "utf8");
        await vscode.workspace.fs.writeFile(vscode.Uri.file(historyPath), content);
    } catch (error) {
        vscode.window.showErrorMessage(`写入深度调研历史失败: ${error}`);
        Logger.getInstance().error("写入深度调研历史失败", error);
    }
}

/**
 * 添加深度调研文档记录
 */
export async function addDeepResearchDocument(document: DeepResearchDocument): Promise<void> {
    const data = await readDeepResearchHistory();
    const documents = data.documents.filter(item => item.id !== document.id);
    documents.unshift(document);
    await writeDeepResearchHistory({ ...data, documents });
}

/**
 * 删除深度调研文档记录
 */
export async function removeDeepResearchDocument(documentId: string): Promise<void> {
    const data = await readDeepResearchHistory();
    const documents = data.documents.filter(item => item.id !== documentId);
    await writeDeepResearchHistory({ ...data, documents });
}

/**
 * 更新深度调研文档记录
 */
export async function updateDeepResearchDocument(documentId: string, updates: Partial<DeepResearchDocument>): Promise<void> {
    const data = await readDeepResearchHistory();
    const documents = data.documents.map(item => 
        item.id === documentId ? { ...item, ...updates } : item
    );
    await writeDeepResearchHistory({ ...data, documents });
}
