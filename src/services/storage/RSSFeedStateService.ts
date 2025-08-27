import { ensureIssueManagerDir, getRSSFeedStatesFilePath, checkFileExists, readJSONFile, writeJSONFile, ensureGitignoreForRSSState } from '../../utils/fileUtils';
import * as vscode from 'vscode';

export interface RSSFeedState {
    id: string;
    lastUpdated?: string;
}


/**
 * RSSFeedStateService
 * 专门管理订阅源的动态状态（如 lastUpdated），与静态配置分离。
 */
export class RSSFeedStateService {
    /**
     * 加载所有订阅源状态
     */
    public static async loadStates(): Promise<Map<string, RSSFeedState>> {
        const statesFile = getRSSFeedStatesFilePath();
        const statesMap = new Map<string, RSSFeedState>();
        if (!statesFile) {  
            return statesMap;  
        }  
        if (await checkFileExists(statesFile)) {
            const arr = await readJSONFile<RSSFeedState[]>(statesFile);
            if (Array.isArray(arr)) {
                arr.forEach(s => statesMap.set(s.id, s));
            }
        }
        return statesMap;
    }

    /**
     * 保存所有订阅源状态
     */
    public static async saveStates(states: Map<string, RSSFeedState>): Promise<boolean> {
        const statesFile = getRSSFeedStatesFilePath();  
        if (!statesFile) {  
            return false;  
        }  

        const issueManagerDir = await ensureIssueManagerDir();  
        if (!issueManagerDir) {  
            return false;  
        }  

        let isFirstCreate = false;  
        try {  
            await vscode.workspace.fs.stat(statesFile);  
        } catch {  
            isFirstCreate = true;  
        }  

        const arr = Array.from(states.values());  
        const success = await writeJSONFile(statesFile, arr);  

        if (success && isFirstCreate) {  
            await ensureGitignoreForRSSState();  
        }  

        return success;  
    }

    /**
     * 获取指定订阅源的 lastUpdated
     */
    public static async getLastUpdated(feedId: string): Promise<string | undefined> {
        const states = await this.loadStates();
        return states.get(feedId)?.lastUpdated;
    }

    /**
     * 设置指定订阅源的 lastUpdated
     */
    public static async setLastUpdated(feedId: string, lastUpdated: string): Promise<boolean> {
        const states = await this.loadStates();
        states.set(feedId, { id: feedId, lastUpdated });
        return await this.saveStates(states);
    }
}
