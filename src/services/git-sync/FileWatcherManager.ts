import * as vscode from 'vscode';
import { getChangeDebounceInterval } from '../../config';
import { SyncStatus, SyncStatusInfo } from './types';
import { UnifiedFileWatcher } from '../UnifiedFileWatcher';

/**
 * 文件监听管理器
 * 
 * 负责监听问题文件和配置文件的变化，包括：
 * - 使用统一文件监听器订阅文件变更
 * - 处理文件变更事件
 * - 防抖处理以避免频繁触发同步
 * - 管理监听器的生命周期
 */
export class FileWatcherManager {
    private debounceTimer?: NodeJS.Timeout;
    private disposables: vscode.Disposable[] = [];

    /**
     * 设置文件监听器
     * 
     * 使用统一文件监听器订阅问题文件和配置文件变更
     * 
     * @param isConflictMode 是否处于冲突模式
     * @param onStatusChange 状态变更回调函数
     * @param onAutoSync 自动同步触发回调函数
     */
    public setupFileWatcher(
        isConflictMode: () => boolean,
        onStatusChange: (status: SyncStatusInfo) => void,
        onAutoSync: () => void
    ): void {
        // 清理现有监听器
        this.cleanup();

        // 从全局获取 UnifiedFileWatcher 实例（在 ExtensionInitializer 中已初始化）
        const fileWatcher = UnifiedFileWatcher.getInstance();

        const onFileChange = () => {
            this.handleFileChange(isConflictMode, onStatusChange, onAutoSync);
        };

        // 订阅 Markdown 文件变更
        this.disposables.push(
            fileWatcher.onMarkdownChange(onFileChange)
        );

        // 订阅 .issueManager 目录下所有文件变更
        this.disposables.push(
            fileWatcher.onIssueManagerChange(onFileChange)
        );
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
