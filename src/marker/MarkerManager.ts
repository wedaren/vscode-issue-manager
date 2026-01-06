import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { quickCreateIssue } from '../commands/quickCreateIssue';

/**
 * 标记项
 */
export interface MarkerItem {
    /** 标记文本 */
    message: string;
    /** 文件路径（可选） */
    filePath?: string;
    /** 行号（可选，从0开始） */
    // 兼容单点位置
    line?: number;
    /** 列号（可选，从0开始） */
    column?: number;

    // 可选范围位置（优先使用范围，如果存在则表示选中区域）
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
                    title: '当前标记任务合集',
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

        // 如果有编辑器，记录位置信息
        if (editor) {
            marker.filePath = editor.document.uri.fsPath;
            // 如果用户有选中范围，则保存范围信息
            if (!editor.selection.isEmpty) {
                marker.startLine = editor.selection.start.line;
                marker.startColumn = editor.selection.start.character;
                marker.endLine = editor.selection.end.line;
                marker.endColumn = editor.selection.end.character;

                // 兼容旧字段，使用起始位置填充 line/column
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
    async archiveCurrentTask(): Promise<void> {
        if (this.data.currentTask.markers.length === 0) {
            vscode.window.showInformationMessage('当前任务中没有标记，无需归档');
            return;
        }

        const title = await vscode.window.showInputBox({
            prompt: '请输入归档任务的标题',
            validateInput: (value) => {
                if (!value || value.trim() === '') {
                    return '标题不能为空';
                }
                return undefined;
            }
        });

        if (!title) {
            return; // 用户取消
        }

        // 创建归档任务
        const archivedTask: MarkerTask = {
            title,
            markers: [...this.data.currentTask.markers],
            createdAt: Date.now()
        };

        // 插入到归档列表开头
        this.data.archivedTasks.unshift(archivedTask);

        // 清空当前任务
        this.data.currentTask.markers = [];

        await this.saveData();
        vscode.window.showInformationMessage(`已归档任务: ${title}`);
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
        await this.saveData();
        
        vscode.window.showInformationMessage(`已从"${task.title}"填充 ${task.markers.length} 个标记到当前任务`);
    }

    /**
     * 跳转到标记位置
     */
    async jumpToMarker(marker: MarkerItem): Promise<void> {
        if (!marker.filePath || marker.line === undefined) {
            vscode.window.showWarningMessage('该标记没有关联的位置信息');
            return;
        }

        try {
            const document = await vscode.workspace.openTextDocument(marker.filePath);
            const editor = await vscode.window.showTextDocument(document);
            // 如果有范围信息，则选中整个范围
            if (marker.startLine !== undefined && marker.endLine !== undefined) {
                const start = new vscode.Position(marker.startLine, marker.startColumn || 0);
                const end = new vscode.Position(marker.endLine, marker.endColumn || 0);
                editor.selection = new vscode.Selection(start, end);
                editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenter);
            } else {
                const position = new vscode.Position(marker.line, marker.column || 0);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`无法打开文件: ${error}`);
        }
    }

    /**
     * 关联标记或任务到问题（占位函数）
     */
    async associate(target: MarkerItem | MarkerTask): Promise<void> {
        const issueId = await quickCreateIssue();
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
}
