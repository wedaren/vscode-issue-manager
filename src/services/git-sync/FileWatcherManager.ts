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
     * @param isConflictMode 检查是否处于冲突模式的函数
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

        // 创建监听器
        this.createMarkdownFileWatcher(issueDir);
        this.createConfigFileWatcher(issueDir);

        // 绑定事件处理
        const onFileChange = () => {
            this.handleFileChange(isConflictMode, onStatusChange, onAutoSync);
        };

        this.bindFileWatcherEvents(this.fileWatcher!, onFileChange);
        this.bindFileWatcherEvents(this.configWatcher!, onFileChange);
    }

    /**
     * 创建 Markdown 文件监听器
     */
    private createMarkdownFileWatcher(issueDir: string): void {
        const mdPattern = new vscode.RelativePattern(issueDir, '**/*.md');
        this.fileWatcher = vscode.workspace.createFileSystemWatcher(mdPattern);
        this.disposables.push(this.fileWatcher);
    }

    /**
     * 创建配置文件监听器
     */
    private createConfigFileWatcher(issueDir: string): void {
        const configPattern = new vscode.RelativePattern(
            path.join(issueDir, '.issueManager'), 
            '**/*'
        );
        this.configWatcher = vscode.workspace.createFileSystemWatcher(configPattern);
        this.disposables.push(this.configWatcher);
    }

    /**
     * 绑定文件监听器事件
     */
    private bindFileWatcherEvents(
        watcher: vscode.FileSystemWatcher,
        onFileChange: () => void
    ): void {
        watcher.onDidChange(onFileChange);
        watcher.onDidCreate(onFileChange);
        watcher.onDidDelete(onFileChange);
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
        // 如果处于冲突模式，不处理文件变更
        if (isConflictMode()) {
            return;
        }
        
        // 清除之前的防抖定时器
        this.clearDebounceTimer();
        
        // 更新状态
        onStatusChange({ 
            status: SyncStatus.HasLocalChanges, 
            message: '有本地更改待同步' 
        });

        // 设置新的防抖定时器
        this.scheduleAutoSync(onAutoSync);
    }

    /**
     * 清除防抖定时器
     */
    private clearDebounceTimer(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = undefined;
        }
    }

    /**
     * 安排自动同步
     * 
     * @param onAutoSync 自动同步回调函数
     */
    private scheduleAutoSync(onAutoSync: () => void): void {
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
        this.clearDebounceTimer();
        this.disposeAllWatchers();
        this.clearWatcherReferences();
    }

    /**
     * 释放所有监听器
     */
    private disposeAllWatchers(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }

    /**
     * 清除监听器引用
     */
    private clearWatcherReferences(): void {
        this.fileWatcher = undefined;
        this.configWatcher = undefined;
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
