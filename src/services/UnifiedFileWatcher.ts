import * as vscode from 'vscode';
import * as path from 'path';
import { getIssueDir } from '../config';
import { Logger } from '../core/utils/Logger';
import { isInBatchRefresh, onBatchEnd } from '../utils/refreshBatch';

/**
 * 文件变更事件类型
 */
export enum FileChangeType {
    Change = 'change',
    Create = 'create',
    Delete = 'delete'
}

/**
 * 文件变更事件
 */
export interface FileChangeEvent {
    uri: vscode.Uri;
    type: FileChangeType;
    fileName: string;
    relativePath: string;
}

/**
 * 文件监听回调函数
 */
export type FileWatcherCallback = (event: FileChangeEvent) => void | Promise<void>;

/**
 * 统一文件监听管理器
 * 
 * 单例模式，全局只创建一组 FileSystemWatcher，
 * 各个服务通过注册回调的方式订阅文件变更事件。
 * 
 * 特性：
 * - 避免重复创建监听器，节省系统资源
 * - 支持按文件类型和路径模式分发事件
 * - 自动处理 issueDir 配置变更
 * - 统一的错误处理和日志记录
 * - 防止回调函数重复注册
 * - **事件合并（L1 防抖）**：200ms 窗口内的多次文件变更合并为一批分发，
 *   同一文件只保留最后一次事件，避免下游重复处理
 * - **批量暂停**：在 `withBatchRefresh()` 期间只缓冲不分发，
 *   batch 结束后统一 flush（详见 refreshBatch.ts）
 * 
 * @example
 * ```typescript
 * const watcher = UnifiedFileWatcher.getInstance(context);
 * 
 * // 订阅 Markdown 文件变更
 * const disposable = watcher.onMarkdownChange(async (event) => {
 *   console.log(`文件 ${event.fileName} 发生了 ${event.type} 事件`);
 * });
 * 
 * // 不需要时取消订阅
 * disposable.dispose();
 * ```
 */
export class UnifiedFileWatcher implements vscode.Disposable {
    private static instance: UnifiedFileWatcher | null = null;
    
    private mdWatcher?: vscode.FileSystemWatcher;
    private issueManagerWatcher?: vscode.FileSystemWatcher;
    private disposables: vscode.Disposable[] = [];
    private logger: Logger;
    private context?: vscode.ExtensionContext; // 可选的 context,支持延迟初始化
    
    // 回调函数注册表 - 使用 Set 防止重复注册
    private mdChangeCallbacks: Set<FileWatcherCallback> = new Set();
    private paraCacheCallbacks: Set<FileWatcherCallback> = new Set();
    private issueManagerCallbacks: Set<FileWatcherCallback> = new Set();

    // 事件合并：缓冲短时间内的多次文件变更，合并后一次性分发
    private mdEventBuffer: FileChangeEvent[] = [];
    private mdCoalesceTimer?: NodeJS.Timeout;
    private issueManagerEventBuffer: FileChangeEvent[] = [];
    private issueManagerCoalesceTimer?: NodeJS.Timeout;
    private batchEndDisposable?: vscode.Disposable;
    private static readonly COALESCE_MS = 200;

    private constructor() {
        this.logger = Logger.getInstance();
    }

    /**
     * 获取单例实例
     * 
     * @param context 可选的 VS Code 扩展上下文,首次调用时必须提供
     */
    public static getInstance(context?: vscode.ExtensionContext): UnifiedFileWatcher {
        if (!UnifiedFileWatcher.instance) {
            UnifiedFileWatcher.instance = new UnifiedFileWatcher();
            if (context) {
                UnifiedFileWatcher.instance.initialize(context);
            }
        } else if (context && !UnifiedFileWatcher.instance.context) {
            // 如果实例已存在但未初始化,使用提供的 context 初始化
            UnifiedFileWatcher.instance.initialize(context);
        }
        return UnifiedFileWatcher.instance;
    }

    /**
     * 初始化监听器
     */
    private initialize(context: vscode.ExtensionContext): void {
        this.context = context;
        this.setupWatchers();
        this.setupBatchListener();

        // 监听配置变化，重新设置监听器
        this.context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('issueManager.issueDir')) {
                    this.logger.info('issueDir 配置已变更，重新设置文件监听器');
                    this.setupWatchers();
                }
            })
        );
    }

    /**
     * 注册批量操作结束监听，在 batch 结束时刷新缓冲的事件
     */
    private setupBatchListener(): void {
        this.batchEndDisposable = onBatchEnd(() => {
            this.flushAllBufferedEvents();
        });
    }

    /**
     * 设置文件监听器
     */
    private setupWatchers(): void {
        // 清理旧的监听器
        this.cleanup();

        const issueDir = getIssueDir();
        if (!issueDir) {
            this.logger.debug?.('issueDir 未配置，跳过文件监听器设置');
            return;
        }

        try {
            // 1. 监听所有 Markdown 文件
            const mdPattern = new vscode.RelativePattern(issueDir, '**/*.md');
            this.mdWatcher = vscode.workspace.createFileSystemWatcher(mdPattern);
            
            this.mdWatcher.onDidChange(uri => this.handleMdChange(uri, FileChangeType.Change));
            this.mdWatcher.onDidCreate(uri => this.handleMdChange(uri, FileChangeType.Create));
            this.mdWatcher.onDidDelete(uri => this.handleMdChange(uri, FileChangeType.Delete));
            
            this.disposables.push(this.mdWatcher);

            // 2. 监听 .issueManager 目录下的所有文件
            const issueManagerPattern = new vscode.RelativePattern(
                path.join(issueDir, '.issueManager'), 
                '**/*'
            );
            this.issueManagerWatcher = vscode.workspace.createFileSystemWatcher(issueManagerPattern);
            
            this.issueManagerWatcher.onDidChange(uri => this.handleIssueManagerChange(uri, FileChangeType.Change));
            this.issueManagerWatcher.onDidCreate(uri => this.handleIssueManagerChange(uri, FileChangeType.Create));
            this.issueManagerWatcher.onDidDelete(uri => this.handleIssueManagerChange(uri, FileChangeType.Delete));
            
            this.disposables.push(this.issueManagerWatcher);

            this.logger.info('✓ 统一文件监听器已设置');
        } catch (error) {
            this.logger.error('✗ 文件监听器设置失败:', error);
        }
    }

    /**
     * 处理 Markdown 文件变更
     *
     * 使用事件合并策略：将短时间内的多次变更缓冲后一次性分发。
     * 在批量操作（batch）期间，事件会被缓冲直到 batch 结束。
     */
    private handleMdChange(uri: vscode.Uri, type: FileChangeType): void {
        const issueDir = getIssueDir();
        if (!issueDir) {
            return;
        }

        const relativePath = path.relative(issueDir, uri.fsPath);
        const fileName = path.basename(uri.fsPath);

        const event: FileChangeEvent = { uri, type, fileName, relativePath };

        this.logger.debug?.(`Markdown 文件变更: ${fileName} (${type})`);

        this.mdEventBuffer.push(event);

        // 批量操作期间只缓冲，不调度 flush
        if (isInBatchRefresh()) {
            return;
        }

        // 正常模式：合并短时间内的多次事件
        if (this.mdCoalesceTimer) {
            clearTimeout(this.mdCoalesceTimer);
        }
        this.mdCoalesceTimer = setTimeout(() => {
            this.mdCoalesceTimer = undefined;
            this.flushMdEvents();
        }, UnifiedFileWatcher.COALESCE_MS);
    }

    /**
     * 刷新缓冲的 Markdown 事件，去重后分发给订阅者
     */
    private flushMdEvents(): void {
        if (this.mdEventBuffer.length === 0) { return; }
        const events = this.deduplicateEvents(this.mdEventBuffer);
        this.mdEventBuffer = [];
        this.dispatchMdEvents(events);
    }

    /**
     * 分发 Markdown 事件给所有订阅者（fire-and-forget）
     */
    private dispatchMdEvents(events: FileChangeEvent[]): void {
        for (const callback of this.mdChangeCallbacks) {
            for (const event of events) {
                Promise.resolve(callback(event)).catch(error => {
                    this.logger.warn(`Markdown 文件监听回调执行失败 (${event.fileName}):`, error);
                });
            }
        }
    }

    /**
     * 处理 .issueManager 目录下文件变更
     *
     * 使用与 Markdown 事件相同的合并策略。
     */
    private handleIssueManagerChange(uri: vscode.Uri, type: FileChangeType): void {
        const issueDir = getIssueDir();
        if (!issueDir) {
            return;
        }

        const relativePath = path.relative(path.join(issueDir, '.issueManager'), uri.fsPath);
        const fileName = path.basename(uri.fsPath);

        const event: FileChangeEvent = { uri, type, fileName, relativePath };

        this.logger.debug?.(`.issueManager 文件变更: ${fileName} (${type})`);

        this.issueManagerEventBuffer.push(event);

        if (isInBatchRefresh()) {
            return;
        }

        if (this.issueManagerCoalesceTimer) {
            clearTimeout(this.issueManagerCoalesceTimer);
        }
        this.issueManagerCoalesceTimer = setTimeout(() => {
            this.issueManagerCoalesceTimer = undefined;
            void this.flushIssueManagerEvents();
        }, UnifiedFileWatcher.COALESCE_MS);
    }

    /**
     * 刷新缓冲的 .issueManager 事件，去重后分发给订阅者
     */
    private async flushIssueManagerEvents(): Promise<void> {
        if (this.issueManagerEventBuffer.length === 0) { return; }
        const events = this.deduplicateEvents(this.issueManagerEventBuffer);
        this.issueManagerEventBuffer = [];
        await this.dispatchIssueManagerEvents(events);
    }

    /**
     * 分发 .issueManager 事件给订阅者（顺序执行）
     */
    private async dispatchIssueManagerEvents(events: FileChangeEvent[]): Promise<void> {
        for (const event of events) {
            if (event.fileName === 'para.json') {
                for (const callback of this.paraCacheCallbacks) {
                    try {
                        await callback(event);
                    } catch (error) {
                        this.logger.warn('para.json 监听回调执行失败:', error);
                    }
                }
            }
            for (const callback of this.issueManagerCallbacks) {
                try {
                    await callback(event);
                } catch (error) {
                    this.logger.warn(`.issueManager 文件监听回调执行失败 (${event.fileName}):`, error);
                }
            }
        }
    }

    /**
     * 对事件按文件名去重，保留每个文件的最后一个事件
     */
    private deduplicateEvents(events: FileChangeEvent[]): FileChangeEvent[] {
        const map = new Map<string, FileChangeEvent>();
        for (const event of events) {
            map.set(event.fileName, event);
        }
        return Array.from(map.values());
    }

    /**
     * 刷新所有缓冲的事件（在 batch 结束时调用）
     */
    private flushAllBufferedEvents(): void {
        if (this.mdCoalesceTimer) {
            clearTimeout(this.mdCoalesceTimer);
            this.mdCoalesceTimer = undefined;
        }
        this.flushMdEvents();

        if (this.issueManagerCoalesceTimer) {
            clearTimeout(this.issueManagerCoalesceTimer);
            this.issueManagerCoalesceTimer = undefined;
        }
        void this.flushIssueManagerEvents();
    }

    /**
     * 注册 Markdown 文件变更监听
     * 
     * @param callback 回调函数
     * @returns Disposable 对象，调用 dispose() 取消订阅
     */
    public onMarkdownChange(callback: FileWatcherCallback): vscode.Disposable {
        this.mdChangeCallbacks.add(callback);
        return {
            dispose: () => {
                this.mdChangeCallbacks.delete(callback);
            }
        };
    }

    /**
     * 注册 para.json 变更监听
     * 
     * @param callback 回调函数
     * @returns Disposable 对象，调用 dispose() 取消订阅
     */
    public onParaCacheChange(callback: FileWatcherCallback): vscode.Disposable {
        this.paraCacheCallbacks.add(callback);
        return {
            dispose: () => {
                this.paraCacheCallbacks.delete(callback);
            }
        };
    }

    /**
     * 注册 .issueManager 目录下所有文件变更监听
     * 
     * @param callback 回调函数
     * @returns Disposable 对象，调用 dispose() 取消订阅
     */
    public onIssueManagerChange(callback: FileWatcherCallback): vscode.Disposable {
        this.issueManagerCallbacks.add(callback);
        return {
            dispose: () => {
                this.issueManagerCallbacks.delete(callback);
            }
        };
    }

    /**
     * 清理监听器
     */
    private cleanup(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        this.mdWatcher = undefined;
        this.issueManagerWatcher = undefined;
        // 清理合并计时器和缓冲区
        if (this.mdCoalesceTimer) {
            clearTimeout(this.mdCoalesceTimer);
            this.mdCoalesceTimer = undefined;
        }
        if (this.issueManagerCoalesceTimer) {
            clearTimeout(this.issueManagerCoalesceTimer);
            this.issueManagerCoalesceTimer = undefined;
        }
        this.mdEventBuffer = [];
        this.issueManagerEventBuffer = [];
    }

    /**
     * 释放所有资源
     */
    public dispose(): void {
        this.cleanup();
        this.mdChangeCallbacks.clear();
        this.paraCacheCallbacks.clear();
        this.issueManagerCallbacks.clear();
        this.batchEndDisposable?.dispose();
        this.batchEndDisposable = undefined;
        UnifiedFileWatcher.instance = null;
        this.logger.info('统一文件监听器已释放');
    }
}
