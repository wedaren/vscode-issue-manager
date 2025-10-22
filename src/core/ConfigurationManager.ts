import * as vscode from 'vscode';
import { getIssueDir } from '../config';
import { ensureGitignoreForRSSState } from '../utils/fileUtils';
import { debounce } from '../utils/debounce';
import { TitleCacheService } from '../services/TitleCacheService';
import { getRelativePathToIssueDir, ensureIssueManagerDir } from '../utils/fileUtils';
import { readTitleCacheJson, writeTitleCacheJson } from '../data/treeManager';
import { getTitle } from '../utils/markdown';
import { Logger } from './utils/Logger';
import { UnifiedFileWatcher } from '../services/UnifiedFileWatcher';

const DEBOUNCE_REFRESH_DELAY_MS = 500;

/**
 * 配置监听管理器
 * 
 * 负责监听和响应VS Code配置变化以及文件系统变化，
 * 确保扩展能够实时响应用户设置的更新和问题文件的变化。
 * 
 * 主要功能：
 * - 监听 issueManager.issueDir 配置变化
 * - 自动更新VS Code上下文状态
 * - 管理 .gitignore 文件的RSS状态规则
 * - 监听问题目录下Markdown文件的变化
 * - 防抖处理文件变化事件，避免频繁刷新
 * 
 * @example
 * ```typescript
 * const manager = new ConfigurationManager(context);
 * manager.initializeConfiguration();
 * ```
 */
export class ConfigurationManager {
    private readonly context: vscode.ExtensionContext;
    private readonly logger: Logger;

    /**
     * 创建配置监听管理器实例
     * 
     * @param context VS Code 扩展上下文
     */
    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.logger = Logger.getInstance();
    }

    /**
     * 初始化配置监听
     * 
     * 设置所有必要的监听器，包括配置变化监听和文件系统监听。
     * 确保扩展在启动时就能正确响应当前配置状态。
     * 
     * @throws {Error} 当关键监听器设置失败时抛出错误
     */
    public initializeConfiguration(): void {
        try {
            // 1. 首次激活时，立即更新上下文和Git配置
            this.updateContextAndGitignore();
            
            // 2. 监听配置变化
            this.setupConfigurationListener();
            
            // 3. 设置文件监听器
            this.setupFileWatcher();
            
            this.logger.info('✓ 配置监听器设置完成');
        } catch (error) {
            this.logger.error('✗ 配置监听器设置失败:', error);
            throw new Error(`配置监听器初始化失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
    }

    /**
     * 更新上下文和.gitignore
     */
    private updateContextAndGitignore(): void {
        const issueDir = getIssueDir();
        vscode.commands.executeCommand('setContext', 'issueManager.isDirConfigured', !!issueDir);
        
        // 自动合并 .gitignore 忽略规则
        if (issueDir) {
            ensureGitignoreForRSSState();
        }
    }

    /**
     * 设置配置监听器
     */
    private setupConfigurationListener(): void {
        const configListener = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('issueManager.issueDir')) {
                this.updateContextAndGitignore();
                this.setupFileWatcher(); // 重新设置文件监听器
                // 刷新所有视图以反映新目录的内容
                vscode.commands.executeCommand('issueManager.refreshAllViews');
            }
            // 标题缓存过期重建间隔变更后，重载缓存服务以应用新配置（后续过期判断将使用新值）
            if (e.affectsConfiguration('issueManager.titleCache.rebuildIntervalHours')) {
                TitleCacheService.getInstance().reload()
                    .then(() => this.logger.info('配置变更：已应用新的标题缓存过期重建间隔'))
                    .catch(err => this.logger.warn('应用新的标题缓存过期重建间隔失败', err));
            }
        });
        
        this.context.subscriptions.push(configListener);
    }

    /**
     * 设置文件监听器
     */
    private setupFileWatcher(): void {
        const issueDir = getIssueDir();
        if (!issueDir) {
            return;
        }

        const fileWatcher = UnifiedFileWatcher.getInstance(this.context);

        // 订阅 Markdown 文件变更 - 更新标题缓存
        const handleMarkdownChanged = debounce(async (event) => {
            try {
                const rel = getRelativePathToIssueDir(event.uri.fsPath);
                if (!rel) { return; }

                // 提取最新标题
                const newTitle = await getTitle(event.uri);

                // 确保 .issueManager 目录存在
                await ensureIssueManagerDir();

                // 读取并更新缓存文件
                const map = await readTitleCacheJson();
                const oldTitle = map[rel];
                if (oldTitle === newTitle) {
                    this.logger.debug?.(`标题未变化，跳过写入: ${rel}`);
                    return;
                }
                map[rel] = newTitle;
                await writeTitleCacheJson(map);
                // 不在此处 reload/refresh，交由 titleCache.json 监听统一处理
                this.logger.info(`标题已变更，已写入缓存: ${rel} -> ${newTitle}`);
            } catch (e) {
                this.logger.warn('处理 Markdown 变更并更新标题缓存失败', e);
            }
        }, DEBOUNCE_REFRESH_DELAY_MS);

        // 订阅 Markdown 文件删除 - 从缓存中移除
        const handleMarkdownDeleted = debounce(async (event) => {
            try {
                const rel = getRelativePathToIssueDir(event.uri.fsPath);
                if (!rel) { return; }

                await ensureIssueManagerDir();
                const map = await readTitleCacheJson();
                if (Object.prototype.hasOwnProperty.call(map, rel)) {
                    delete map[rel];
                    await writeTitleCacheJson(map);
                    // 不在此处 reload/refresh，交由 titleCache.json 监听统一处理
                    this.logger.info(`Markdown 删除，已从标题缓存移除: ${rel}`);
                }
            } catch (e) {
                this.logger.warn('处理 Markdown 删除并更新标题缓存失败', e);
            }
        }, DEBOUNCE_REFRESH_DELAY_MS);

        // 注册 Markdown 变更和删除监听
        this.context.subscriptions.push(
            fileWatcher.onMarkdownChange(event => {
                if (event.type === 'delete') {
                    handleMarkdownDeleted(event);
                } else {
                    handleMarkdownChanged(event);
                }
            })
        );

        // 订阅 titleCache.json 变更 - 重载缓存并刷新视图
        const debouncedReloadTitleCache = debounce(async () => {
            try {
                await TitleCacheService.getInstance().reload();
                this.logger.info('titleCache.json 变更，已重载标题缓存');
                vscode.commands.executeCommand('issueManager.refreshAllViews');
            } catch (e) {
                this.logger.warn('重载标题缓存失败，将继续使用旧缓存', e);
                // 失败时也刷新一次，确保UI状态一致
                vscode.commands.executeCommand('issueManager.refreshAllViews');
            }
        }, DEBOUNCE_REFRESH_DELAY_MS);

        this.context.subscriptions.push(
            fileWatcher.onTitleCacheChange(debouncedReloadTitleCache)
        );
    }
}