import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { selectOrCreateIssue } from '../commands/selectOrCreateIssue';
import { getIssueTitle } from '../data/issueTreeManager';
import { createLocationFromEditor, formatFileLink, parseFileLink, type FileLocation } from '../utils/fileLinkFormatter';

/**
 * 标记项
 */
export interface MarkerItem {
    /** 标记文本 */
    message: string;
    /** 统一格式的位置链接，格式如 [[file:/path#L10:4-L15:8]]（推荐使用） */
    location?: string;
    /** 文件路径（可选，已废弃，保留用于向后兼容） */
    filePath?: string;
    /** 行号（可选，从0开始，已废弃，保留用于向后兼容） */
    // 兼容单点位置
    line?: number;
    /** 列号（可选，从0开始，已废弃，保留用于向后兼容） */
    column?: number;

    // 可选范围位置（优先使用范围，如果存在则表示选中区域）（已废弃，保留用于向后兼容）
    startLine?: number;
    startColumn?: number;
    endLine?: number;
    endColumn?: number;
    /** 关联的问题ID（可选） */
    associatedIssueId?: string;
    /** 创建时间 */
    createdAt: number;
}

/**
 * 任务（包含多个标记）
 */
export interface MarkerTask {
    /** 任务标题 */
    title: string;
    /** 标记列表 */
    markers: MarkerItem[];
    /** 关联的问题ID（可选） */
    associatedIssueId?: string;
    /** 创建时间 */
    createdAt: number;
}

/**
 * 标记数据结构
 */
export interface MarkerData {
    /** 当前任务 */
    currentTask: MarkerTask;
    /** 归档任务列表 */
    archivedTasks: MarkerTask[];
}

/**
 * 标记管理器，负责标记的创建、存储、排序等核心功能
 */
export class MarkerManager {
    private data: MarkerData;
    private storageUri: vscode.Uri;
    private _onDidChangeData: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidChangeData: vscode.Event<void> = this._onDidChangeData.event;

    constructor(context: vscode.ExtensionContext) {
        this.storageUri = vscode.Uri.joinPath(context.globalStorageUri, 'markers.json');
        this.data = this.loadData();
    }

    /**
     * 从文件加载数据
     */
    private loadData(): MarkerData {
        try {
            const fileData = fs.readFileSync(this.storageUri.fsPath, 'utf8');
            return JSON.parse(fileData);
        } catch (error) {
            // 文件不存在或解析失败，返回默认数据
            return {
                currentTask: {
                    title: '当前任务',
                    markers: [],
                    createdAt: Date.now()
                },
                archivedTasks: []
            };
        }
    }

    /**
     * 保存数据到文件
     */
    private async saveData(): Promise<void> {
        try {
            // 确保目录存在
            const dir = path.dirname(this.storageUri.fsPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            
            // 写入文件
            fs.writeFileSync(this.storageUri.fsPath, JSON.stringify(this.data, null, 2), 'utf8');
            this._onDidChangeData.fire();
        } catch (error) {
            vscode.window.showErrorMessage(`保存标记数据失败: ${error}`);
        }
    }

    /**
     * 获取所有数据
     */
    getData(): MarkerData {
        return this.data;
    }

    /**
     * 获取当前任务
     */
    getCurrentTask(): MarkerTask {
        return this.data.currentTask;
    }

    /**
     * 获取归档任务列表
     */
    getArchivedTasks(): MarkerTask[] {
        return this.data.archivedTasks;
    }

    /**
     * 生成下一个序号标记文本
     */
    private getNextMarkerNumber(): string {
        const markers = this.data.currentTask.markers;
        if (markers.length === 0) {
            return '1';
        }

        // 查找最大的数字序号
        let maxNum = 0;
        for (const marker of markers) {
            const num = parseInt(marker.message);
            if (!isNaN(num) && num > maxNum) {
                maxNum = num;
            }
        }

        return (maxNum + 1).toString();
    }

    /**
     * 创建新标记
     * @param insertIndex 可选：插入的位置索引，未提供则追加到末尾
     */
    async createMarker(message?: string, editor?: vscode.TextEditor, insertIndex?: number): Promise<void> {
        // 如果没有提供 message，使用下一个序号
        if (!message) {
            message = this.getNextMarkerNumber();
        }

        // 询问用户标记文本
        const input = await vscode.window.showInputBox({
            prompt: '请输入标记文本',
            value: message,
            validateInput: (value) => {
                if (!value || value.trim() === '') {
                    return '标记文本不能为空';
                }
                return undefined;
            }
        });

        if (!input) {
            return; // 用户取消
        }

        const marker: MarkerItem = {
            message: input,
            createdAt: Date.now()
        };

        // 如果有编辑器，使用统一的链接格式记录位置信息
        if (editor) {
            const fileLocation = createLocationFromEditor(editor);
            marker.location = formatFileLink(fileLocation);
            
            // 保留旧字段以实现向后兼容
            marker.filePath = editor.document.uri.fsPath;
            if (!editor.selection.isEmpty) {
                marker.startLine = editor.selection.start.line;
                marker.startColumn = editor.selection.start.character;
                marker.endLine = editor.selection.end.line;
                marker.endColumn = editor.selection.end.character;
                marker.line = marker.startLine;
                marker.column = marker.startColumn;
            } else {
                marker.line = editor.selection.active.line;
                marker.column = editor.selection.active.character;
            }
        }

        // 插入到指定位置或追加
        const markers = this.data.currentTask.markers;
        if (insertIndex === undefined || insertIndex < 0 || insertIndex > markers.length) {
            markers.push(marker);
        } else {
            markers.splice(insertIndex, 0, marker);
        }
        await this.saveData();
        
        vscode.window.showInformationMessage(`已添加标记: ${input}`);
    }

    /**
     * 删除标记
     */
    async deleteMarker(marker: MarkerItem): Promise<void> {
        const index = this.data.currentTask.markers.indexOf(marker);
        if (index !== -1) {
            this.data.currentTask.markers.splice(index, 1);
            await this.saveData();
        }
    }

    /**
     * 批量删除标记
     */
    async batchDeleteMarkers(): Promise<void> {
        if (this.data.currentTask.markers.length === 0) {
            vscode.window.showInformationMessage('当前任务中没有标记');
            return;
        }

        const result = await vscode.window.showWarningMessage(
            `确定要删除当前任务中的所有 ${this.data.currentTask.markers.length} 个标记吗？`,
            { modal: true },
            '删除'
        );

        if (result === '删除') {
            this.data.currentTask.markers = [];
            await this.saveData();
            vscode.window.showInformationMessage('已删除所有标记');
        }
    }

    /**
     * 重命名标记
     */
    async renameMarker(marker: MarkerItem): Promise<void> {
        const input = await vscode.window.showInputBox({
            prompt: '请输入新的标记文本',
            value: marker.message,
            validateInput: (value) => {
                if (!value || value.trim() === '') {
                    return '标记文本不能为空';
                }
                return undefined;
            }
        });

        if (input) {
            marker.message = input;
            await this.saveData();
        }
    }

    /**
     * 移动标记（拖动排序）
     */
    async moveMarker(marker: MarkerItem, newIndex: number): Promise<void> {
        const markers = this.data.currentTask.markers;
        const oldIndex = markers.indexOf(marker);
        
        // 允许 newIndex 等于 markers.length（追加到末尾）
        if (oldIndex === -1 || newIndex < 0 || newIndex > markers.length) {
            return;
        }

        // 移除并插入到新位置
        markers.splice(oldIndex, 1);
        // 如果原位置在前且目标索引在删除后会向前偏移，需要调整
        const adjustedIndex = oldIndex < newIndex ? newIndex - 1 : newIndex;
        markers.splice(adjustedIndex, 0, marker);

        // 如果是数字序号，更新序号
        this.updateMarkerNumbers();
        
        await this.saveData();
    }

    /**
     * 更新标记序号（如果标记是数字）
     */
    private updateMarkerNumbers(): void {
        const markers = this.data.currentTask.markers;
        
        // 检查是否所有标记都是数字
        const allNumbers = markers.every(m => !isNaN(parseInt(m.message)));
        
        if (allNumbers) {
            markers.forEach((marker, index) => {
                marker.message = (index + 1).toString();
            });
        }
    }

    /**
     * 归档当前任务
     */
    async archiveCurrentTask(): Promise<MarkerTask | null> {
        if (this.data.currentTask.markers.length === 0) {
            vscode.window.showInformationMessage('当前任务中没有标记，无需归档');
            return null;
        }

        let title: string | undefined;  
        const issueId = this.data.currentTask.associatedIssueId;
        if (issueId) {  
            try {  
                title = await getIssueTitle(issueId);  
            } catch {  }  
        }  
        if (!title) {
            title = await vscode.window.showInputBox({
                prompt: '请输入归档任务的标题',
                validateInput: (value) => {
                    if (!value || value.trim() === '') {
                        return '标题不能为空';
                    }
                    return undefined;
                }
            });

            if (!title) {
                return null; // 用户取消
            }
        }

        // 创建归档任务
        const archivedTask: MarkerTask = {
            title,
            markers: [...this.data.currentTask.markers],
            associatedIssueId: issueId,
            createdAt: Date.now()
        };

        // 插入到归档列表开头
        this.data.archivedTasks.unshift(archivedTask);

        // 清空当前任务
        this.data.currentTask.markers = [];

        await this.saveData();
        vscode.window.showInformationMessage(`已归档任务: ${title}`);
        return archivedTask;
    }

    /**
     * 清空当前任务
     */
    async clearCurrentTask(): Promise<void> {
        if (this.data.currentTask.markers.length === 0) {
            vscode.window.showInformationMessage('当前任务已经是空的');
            return;
        }

        const result = await vscode.window.showWarningMessage(
            `确定要清空当前任务中的 ${this.data.currentTask.markers.length} 个标记吗？`,
            { modal: true },
            '清空'
        );

        if (result === '清空') {
            this.data.currentTask.markers = [];
            await this.saveData();
            vscode.window.showInformationMessage('已清空当前任务');
        }
    }

    /**
     * 删除归档任务
     */
    async deleteArchivedTask(task: MarkerTask): Promise<void> {
        const result = await vscode.window.showWarningMessage(
            `确定要删除归档任务"${task.title}"吗？`,
            { modal: true },
            '删除'
        );

        if (result === '删除') {
            const index = this.data.archivedTasks.indexOf(task);
            if (index !== -1) {
                this.data.archivedTasks.splice(index, 1);
                await this.saveData();
                vscode.window.showInformationMessage(`已删除归档任务: ${task.title}`);
            }
        }
    }

    /**
     * 从归档任务填充到当前任务
     */
    async fillFromArchivedTask(task: MarkerTask): Promise<void> {
        // 如果当前任务不为空，询问是否替换
        if (this.data.currentTask.markers.length > 0) {
            const result = await vscode.window.showWarningMessage(
                `当前任务中已有 ${this.data.currentTask.markers.length} 个标记，是否替换？`,
                { modal: true },
                '替换',
                '取消'
            );

            if (result !== '替换') {
                return;
            }
        }

        // 复制归档任务的标记到当前任务
        this.data.currentTask.markers = task.markers.map(m => ({ ...m }));
        this.data.currentTask.associatedIssueId = task.associatedIssueId;
        await this.saveData();
        
        vscode.window.showInformationMessage(`已从"${task.title}"填充 ${task.markers.length} 个标记到当前任务`);
    }

    /**
     * 跳转到标记位置
     */
    async jumpToMarker(marker: MarkerItem): Promise<void> {
        let fileLocation: FileLocation | null = null;
        
        // 优先使用新的统一格式
        if (marker.location) {
            fileLocation = parseFileLink(marker.location);
        }
        
        // 如果没有新格式或解析失败，回退到旧格式
        if (!fileLocation && marker.filePath && marker.line !== undefined) {
            fileLocation = {
                filePath: marker.filePath,
                startLine: (marker.line || 0) + 1,  // 转换为 1-based
                startColumn: marker.column !== undefined ? (marker.column + 1) : undefined,
                endLine: marker.endLine !== undefined ? (marker.endLine + 1) : undefined,
                endColumn: marker.endColumn !== undefined ? (marker.endColumn + 1) : undefined
            };
        }
        
        if (!fileLocation) {
            vscode.window.showWarningMessage('该标记没有关联的位置信息');
            return;
        }

        try {
            const document = await vscode.workspace.openTextDocument(fileLocation.filePath);
            const editor = await vscode.window.showTextDocument(document);
            
            // 如果有范围信息，则选中整个范围
            if (fileLocation.startLine !== undefined) {
                const startLine = fileLocation.startLine - 1; // 转换为 0-based
                const startCol = (fileLocation.startColumn || 1) - 1;
                
                if (fileLocation.endLine !== undefined) {
                    const endLine = fileLocation.endLine - 1;
                    const endCol = (fileLocation.endColumn || 1) - 1;
                    const start = new vscode.Position(startLine, startCol);
                    const end = new vscode.Position(endLine, endCol);
                    editor.selection = new vscode.Selection(start, end);
                    editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenter);
                } else {
                    const position = new vscode.Position(startLine, startCol);
                    editor.selection = new vscode.Selection(position, position);
                    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(`无法打开文件: ${error}`);
        }
    }

    /**
     * 关联标记或任务到问题（占位函数）
     */
    async associate(target: MarkerItem | MarkerTask): Promise<void> {
        const issueId = await selectOrCreateIssue();
        if (!issueId) {
            // 用户取消或创建失败
            return;
        }

        // 如果是单个标记
        if ((target as MarkerItem).message !== undefined) {
            const marker = target as MarkerItem;
            marker.associatedIssueId = issueId;
            await this.saveData();
            vscode.window.showInformationMessage(`标记已关联到问题: ${issueId}`);
            return;
        }

        // 如果是任务
        const task = target as MarkerTask;
        task.associatedIssueId = issueId;
        await this.saveData();
        vscode.window.showInformationMessage(`任务已关联到问题: ${issueId}`);
    }

    /**
     * 将所有打开的编辑器依次加入当前任务，并关闭这些编辑器
     */
    async importAllOpenEditors(): Promise<void> {
        // 尝试通过 tabGroups 获取所有打开的 tab URI（保留分组顺序）
        const uris: vscode.Uri[] = [];
        try {
            for (const group of vscode.window.tabGroups.all) {
                for (const tab of group.tabs) {
                    // TabInputText 有 uri 字段
                    const input = tab.input as { uri?: vscode.Uri };
                    if (input?.uri) {
                        uris.push(input.uri);
                    }
                }
            }
        } catch (e) {
            // 在旧版 API 上可能失败，回退到 visibleTextEditors
        }

        if (uris.length === 0) {
            // 回退：使用可见编辑器
            const seen = new Set<string>();
            for (const ed of vscode.window.visibleTextEditors) {
                const u = ed.document.uri;
                if (!seen.has(u.toString())) {
                    uris.push(u);
                    seen.add(u.toString());
                }
            }
        }

        if (uris.length === 0) {
            vscode.window.showInformationMessage('没有打开的编辑器可导入');
            return;
        }

        // 计算已存在的文件路径，用于去重（避免重复为同一文件创建标记）
        const existingPaths = new Set<string>(this.data.currentTask.markers.map(m => m.filePath || ''));
        let importedCount = 0;

        // 依次打开、创建标记并关闭
        for (const uri of uris) {
            try {
                const fsPath = uri.fsPath || uri.toString();
                if (existingPaths.has(fsPath)) {
                    // 已存在相同文件的标记，跳过
                    continue;
                }

                const doc = await vscode.workspace.openTextDocument(uri);
                const editor = await vscode.window.showTextDocument(doc, { preview: false });

                // 创建标记（追加到末尾）
                await this.createMarker(undefined, editor);

                // 记录已导入的路径，避免重复导入同一文件
                existingPaths.add(fsPath);
                importedCount++;

                // 关闭当前活动编辑器（刚打开的那个）
                await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            } catch (error) {
                // 继续处理下一个
                console.warn('importAllOpenEditors error for', uri.toString(), error);
            }
        }

        vscode.window.showInformationMessage(`已导入 ${importedCount} 个编辑器为标记并关闭它们`);
    }

    /**
     * 将所有打开的编辑器静默加入当前任务（使用编号作为标记文本），并关闭这些编辑器
     */
    async importAllOpenEditorsSilent(): Promise<void> {
        const uris: vscode.Uri[] = [];
        try {
            for (const group of vscode.window.tabGroups.all) {
                for (const tab of group.tabs) {
                    const input = tab.input as { uri?: vscode.Uri };
                    if (input?.uri) {
                        uris.push(input.uri);
                    }
                }
            }
        } catch (e) {
            // ignore
        }

        if (uris.length === 0) {
            const seen = new Set<string>();
            for (const ed of vscode.window.visibleTextEditors) {
                const u = ed.document.uri;
                if (!seen.has(u.toString())) {
                    uris.push(u);
                    seen.add(u.toString());
                }
            }
        }

        if (uris.length === 0) {
            vscode.window.showInformationMessage('没有打开的编辑器可导入');
            return;
        }

        // 基于当前任务已存在的 filePath 做去重，避免重复为同一文件创建标记
        const existingPaths = new Set<string>(this.data.currentTask.markers.map(m => m.filePath || ''));
        let importedCount = 0;

        for (const uri of uris) {
            try {
                const fsPath = uri.fsPath || uri.toString();
                if (existingPaths.has(fsPath)) {
                    // 已存在相同文件的标记，跳过
                    continue;
                }

                const doc = await vscode.workspace.openTextDocument(uri);
                const editor = await vscode.window.showTextDocument(doc, { preview: false });

                // 构造静默标记，使用下一个序号作为文本
                const message = this.getNextMarkerNumber();
                const marker: MarkerItem = {
                    message,
                    filePath: uri.fsPath,
                    createdAt: Date.now(),
                };

                // 如果有选区信息，从 editor 获取
                if (editor && !editor.selection.isEmpty) {
                    marker.startLine = editor.selection.start.line;
                    marker.startColumn = editor.selection.start.character;
                    marker.endLine = editor.selection.end.line;
                    marker.endColumn = editor.selection.end.character;
                    marker.line = marker.startLine;
                    marker.column = marker.startColumn;
                } else if (editor) {
                    marker.line = editor.selection.active.line;
                    marker.column = editor.selection.active.character;
                }

                // 直接插入，不弹出输入框
                this.insertMarkerDirect(marker);

                // 记录已导入路径，避免重复导入同一文件
                existingPaths.add(fsPath);
                importedCount++;

                // 关闭刚打开的编辑器
                await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            } catch (error) {
                console.warn('importAllOpenEditorsSilent error for', uri.toString(), error);
            }
        }

        await this.saveData();
        vscode.window.showInformationMessage(`已静默导入 ${importedCount} 个编辑器为标记并关闭它们`);
    }

    /**
     * 直接插入标记到当前任务并不弹出任何 UI
     */
    private insertMarkerDirect(marker: MarkerItem): void {
        const markers = this.data.currentTask.markers;
        markers.push(marker);
        // 不在此处调用 saveData，调用者可在批量操作后统一保存
    }

    /**
     * 将指定 issueId 关联到当前任务并保存
     */
    async associateIssueToCurrentTask(issueId: string): Promise<void> {
        this.data.currentTask.associatedIssueId = issueId;
        await this.saveData();
        vscode.window.showInformationMessage(`当前任务已关联到问题: ${issueId}`);
    }
}
