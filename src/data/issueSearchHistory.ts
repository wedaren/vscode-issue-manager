import * as vscode from "vscode";
import * as path from "path";
import { getIssueDir } from "../config";
import { Logger } from "../core/utils/Logger";

export type IssueSearchType = "ai" | "filter" | "fulltext";

export interface IssueSearchResult {
    filePath: string;
    title: string;
    briefSummary?: string;
    /**
     * 全文搜索时匹配的内容片段及位置信息
     */
    matchedSnippets?: Array<{
        /** 匹配的文本行内容 */
        text: string;
        /** 行号（从1开始） */
        lineNumber: number;
        /** 该行在匹配文本中的列位置 */
        columnStart: number;
        columnEnd: number;
    }>;
}

export interface IssueSearchRecord {
    id: string;
    keyword: string;
    type: IssueSearchType;
    createdAt: number;
    results: IssueSearchResult[];
}

export interface IssueSearchHistoryData {
    version: string;
    records: IssueSearchRecord[];
}

const SEARCH_HISTORY_FILE = "issueSearchHistory.json";
const DEFAULT_HISTORY_DATA: IssueSearchHistoryData = {
    version: "1.0.0",
    records: []
};

const getSearchHistoryPath = async (): Promise<string | null> => {
    const issueDir = getIssueDir();
    if (!issueDir) {
        return null;
    }

    const dataDir = path.join(issueDir, ".issueManager");
    try {
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(dataDir));
    } catch (error) {
        vscode.window.showErrorMessage("创建 .issueManager 目录失败。");
        Logger.getInstance().error("创建 .issueManager 目录失败", error);
        return null;
    }

    return path.join(dataDir, SEARCH_HISTORY_FILE);
};

function isIssueSearchResult(item: unknown): item is IssueSearchResult {
    if (!item || typeof item !== "object") {
        return false;
    }
    const r = item as Record<string, unknown>;
    return (
        typeof r.filePath === "string" &&
        typeof r.title === "string" &&
        (r.briefSummary === undefined || typeof r.briefSummary === "string")
    );
}

function isIssueSearchRecord(item: unknown): item is IssueSearchRecord {
    if (!item || typeof item !== "object") {
        return false;
    }
    const r = item as Record<string, unknown>;
    if (
        typeof r.id !== "string" ||
        typeof r.keyword !== "string" ||
        !(r.type === "ai" || r.type === "filter" || r.type === "fulltext") ||
        typeof r.createdAt !== "number" ||
        !Array.isArray(r.results)
    ) {
        return false;
    }
    return (r.results as unknown[]).every(isIssueSearchResult);
}

export async function readIssueSearchHistory(): Promise<IssueSearchHistoryData> {
    const historyPath = await getSearchHistoryPath();
    if (!historyPath) {
        return { ...DEFAULT_HISTORY_DATA };
    }

    try {
        const content = await vscode.workspace.fs.readFile(vscode.Uri.file(historyPath));
        const data = JSON.parse(content.toString());
        if (!Array.isArray(data.records)) {
            return { ...DEFAULT_HISTORY_DATA };
        }
        const records = data.records.filter(isIssueSearchRecord);

        return {
            version: typeof data.version === "string" ? data.version : DEFAULT_HISTORY_DATA.version,
            records
        };
    } catch (error) {
        Logger.getInstance().warn("读取 issueSearchHistory.json 失败", error);
        return { ...DEFAULT_HISTORY_DATA };
    }
}

export async function writeIssueSearchHistory(data: IssueSearchHistoryData): Promise<void> {
    const historyPath = await getSearchHistoryPath();
    if (!historyPath) {
        vscode.window.showErrorMessage("无法写入搜索历史，问题目录未配置。");
        return;
    }

    try {
        const content = Buffer.from(JSON.stringify(data, null, 2), "utf8");
        await vscode.workspace.fs.writeFile(vscode.Uri.file(historyPath), content);
    } catch (error) {
        vscode.window.showErrorMessage(`写入搜索历史失败: ${error}`);
        Logger.getInstance().error("写入搜索历史失败", error);
    }
}

export async function addIssueSearchRecord(record: IssueSearchRecord, limit = 50): Promise<void> {
    const data = await readIssueSearchHistory();
    const records = data.records.filter(item => item.id !== record.id);
    records.unshift(record);
    if (records.length > limit) {
        records.splice(limit);
    }
    await writeIssueSearchHistory({ ...data, records });
}
