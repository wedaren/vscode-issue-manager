import * as vscode from 'vscode';
import * as path from 'path';
import { getChangeDebounceInterval } from '../../config';
import { SyncStatus, SyncStatusInfo } from './types';

/**
 * 文件监听管理器
 * 
 * 负责监听问题文件和配置文件的变化，包括：
 * - 设置文件系统监听器
 * - 处理文件变更事件
 * - 防抖处理以避免频繁触发同步
 * - 管理监听器的生命周期
 */
export class FileWatcherManager {
    private fileWatcher?: vscode.FileSystemWatcher;
    private configWatcher?: vscode.FileSystemWatcher;
    private debounceTimer?: NodeJS.Timeout;
    private disposables: vscode.Disposable[] = [];

    /**
     * 设置文件监听器
     * 
     * 创建两个监听器：
     * 1. 监听问题文件（.md文件）
     * 2. 监听配置目录（.issueManager目录下的所有文件）
     * 
     * @param issueDir 问题目录路径
     * @param isConflictMode 是否处于冲突模式
     * @param onStatusChange 状态变更回调函数
     * @param onAutoSync 自动同步触发回调函数
     */
    public setupFileWatcher(
        issueDir: string,
        isConflictMode: () => boolean,
        onStatusChange: (status: SyncStatusInfo) => void,
        onAutoSync: () => void
    ): void {
        // 清理现有监听器
        this.cleanup();

        // 监听问题文件（.md文件）
        const mdPattern = new vscode.RelativePattern(issueDir, '**/*.md');
        this.fileWatcher = vscode.workspace.createFileSystemWatcher(mdPattern);

        // 监听配置目录（.issueManager目录下的所有文件）
        const configPattern = new vscode.RelativePattern(path.join(issueDir, '.issueManager'), '**/*');
        this.configWatcher = vscode.workspace.createFileSystemWatcher(configPattern);

        const onFileChange = () => {
            this.handleFileChange(isConflictMode, onStatusChange, onAutoSync);
        };

        // 为问题文件监听器绑定事件
        this.fileWatcher.onDidChange(onFileChange);
        this.fileWatcher.onDidCreate(onFileChange);
        this.fileWatcher.onDidDelete(onFileChange);

        // 为配置文件监听器绑定事件
        this.configWatcher.onDidChange(onFileChange);
        this.configWatcher.onDidCreate(onFileChange);
        this.configWatcher.onDidDelete(onFileChange);

        this.disposables.push(this.fileWatcher);
        this.disposables.push(this.configWatcher);
    }

    /**
     * 处理文件变更事件
     * 
     * 当文件发生变化时：
     * 1. 检查是否处于冲突模式，如果是则忽略
     * 2. 清除之前的防抖定时器
     * 3. 更新状态为"有本地更改待同步"
     * 4. 设置防抖定时器，延迟触发自动同步
     * 
     * @param isConflictMode 检查是否处于冲突模式的函数
     * @param onStatusChange 状态变更回调函数
     * @param onAutoSync 自动同步触发回调函数
     */
    private handleFileChange(
        isConflictMode: () => boolean,
        onStatusChange: (status: SyncStatusInfo) => void,
        onAutoSync: () => void
    ): void {
        if (isConflictMode()) {
            return;
        }
        
        // 防抖处理
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        
        // 更新状态
        onStatusChange({ 
            status: SyncStatus.HasLocalChanges, 
            message: '有本地更改待同步' 
        });

        // 设置防抖定时器
        const debounceInterval = getChangeDebounceInterval() * 1000;
        this.debounceTimer = setTimeout(() => {
            onAutoSync();
        }, debounceInterval);
    }

    /**
     * 清理所有监听器和定时器
     * 
     * 释放文件监听器资源并清除防抖定时器。
     * 在服务停止或重新配置时调用。
     */
    public cleanup(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = undefined;
        }
        
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
            this.fileWatcher = undefined;
        }

        if (this.configWatcher) {
            this.configWatcher.dispose();
            this.configWatcher = undefined;
        }

        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }

    /**
     * 释放所有资源
     * 
     * 实现Disposable模式，确保资源被正确释放。
     */
    public dispose(): void {
        this.cleanup();
    }
}
