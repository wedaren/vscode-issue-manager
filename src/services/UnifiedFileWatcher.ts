import * as vscode from 'vscode';
import * as path from 'path';
import { getIssueDir } from '../config';
import { Logger } from '../core/utils/Logger';

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
     */
    private async handleMdChange(uri: vscode.Uri, type: FileChangeType): Promise<void> {
        const issueDir = getIssueDir();
        if (!issueDir) {
            return;
        }

        const relativePath = path.relative(issueDir, uri.fsPath);
        const fileName = path.basename(uri.fsPath);
        
        const event: FileChangeEvent = {
            uri,
            type,
            fileName,
            relativePath
        };

        this.logger.debug?.(`Markdown 文件变更: ${fileName} (${type})`);

        // 分发事件给所有订阅者
        for (const callback of this.mdChangeCallbacks) {  
            Promise.resolve(callback(event)).catch(error => {  
                this.logger.warn(`Markdown 文件监听回调执行失败 (${fileName}):`, error);  
            });  
        }  
    }

    /**
     * 处理 .issueManager 目录下文件变更
     */
    private async handleIssueManagerChange(uri: vscode.Uri, type: FileChangeType): Promise<void> {
        const issueDir = getIssueDir();
        if (!issueDir) {
            return;
        }

        const relativePath = path.relative(path.join(issueDir, '.issueManager'), uri.fsPath);
        const fileName = path.basename(uri.fsPath);
        
        const event: FileChangeEvent = {
            uri,
            type,
            fileName,
            relativePath
        };

        this.logger.debug?.(`.issueManager 文件变更: ${fileName} (${type})`);

        if (fileName === 'para.json') {
            for (const callback of this.paraCacheCallbacks) {
                try {
                    await callback(event);
                } catch (error) {
                    this.logger.warn('para.json 监听回调执行失败:', error);
                }
            }
        }

        // 同时触发通用 .issueManager 目录回调
        for (const callback of this.issueManagerCallbacks) {
            try {
                await callback(event);
            } catch (error) {
                this.logger.warn(`.issueManager 文件监听回调执行失败 (${fileName}):`, error);
            }
        }
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
    }

    /**
     * 释放所有资源
     */
    public dispose(): void {
        this.cleanup();
        this.mdChangeCallbacks.clear();
        this.paraCacheCallbacks.clear();
        this.issueManagerCallbacks.clear();
        UnifiedFileWatcher.instance = null;
        this.logger.info('统一文件监听器已释放');
    }
}
