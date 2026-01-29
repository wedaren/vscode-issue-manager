import * as vscode from "vscode";
import * as path from "path";
import { getIssueDir } from "../config";
import { Logger } from "../core/utils/Logger";

export type IssueSearchType = "ai" | "filter";

export interface IssueSearchResult {
    filePath: string;
    title: string;
    briefSummary?: string;
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
        const records = data.records.filter((item: any) => {
            return (
                item &&
                typeof item === "object" &&
                typeof item.id === "string" &&
                typeof item.keyword === "string" &&
                (item.type === "ai" || item.type === "filter") &&
                typeof item.createdAt === "number" &&
                Array.isArray(item.results)
            );
        }) as IssueSearchRecord[];

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
