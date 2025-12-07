import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from '../core/utils/Logger';
import { getIssueIdFromUri } from '../utils/uriUtils';
import { getIssueDir } from '../config';
import { readTree, type IssueTreeNode } from '../data/treeManager';

/**
 * 管理与编辑器相关的上下文，特别是从 URI query 中提取的 issueId。
 * 
 * 尽管 `setContext` 是一个全局操作，但 VS Code 的事件模型确保了 `onDidChangeActiveTextEditor`
 * 总是在用户当前交互的窗口中触发。当用户切换窗口时，新窗口变为活动状态，
 * 此服务会捕获到该窗口内的 `onDidChangeActiveTextEditor` 事件（如果编辑器发生变化），
 * 并立即更新全局上下文以反映新活动编辑器的状态。
 * 
 * 这种机制确保了即使用户打开多个窗口，上下文相关的 UI（如菜单项）也总是
 * 针对当前正在操作的窗口是正确的。
 */
export class EditorContextService implements vscode.Disposable {
    private static instance: EditorContextService;
    private disposables: vscode.Disposable[] = [];
    private logger: Logger;
    
    /** 缓存树中存在的所有 issueId，避免每次都读取树文件 */
    private validIssueIds: Set<string> = new Set();
    private cacheInvalidated: boolean = true;

    private constructor(context: vscode.ExtensionContext) {
        this.logger = Logger.getInstance();

        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(this.updateEditorIssueContext, this)
        );

        // 立即为当前激活的编辑器更新一次上下文
        if (vscode.window.activeTextEditor) {
            this.updateEditorIssueContext(vscode.window.activeTextEditor);
        } else {
            // 确保在没有活动编辑器时，上下文被重置
            this.updateEditorIssueContext(undefined);
        }
    }

    /**
     * 获取 EditorContextService 的单例。
     * @param context 扩展上下文
     */
    public static initialize(context: vscode.ExtensionContext): EditorContextService {
        if (!EditorContextService.instance) {
            EditorContextService.instance = new EditorContextService(context);
            context.subscriptions.push(EditorContextService.instance);
        }
        return EditorContextService.instance;
    }

    /**
     * 获取已初始化的单例实例
     * @returns EditorContextService 实例，如果未初始化则返回 undefined
     */
    public static getInstance(): EditorContextService | undefined {
        return EditorContextService.instance;
    }

    /**
     * 当活动编辑器改变时，更新相关的上下文键。
     * @param editor 激活的文本编辑器
     */
    private async updateEditorIssueContext(editor: vscode.TextEditor | undefined): Promise<void> {
        let validIssueId: string | undefined = undefined;
        const rawIssueId = getIssueIdFromUri(editor?.document?.uri);
        
        // 如果从 URI 中提取到了 issueId，需要验证它是否真的存在于树结构中
        if (rawIssueId) {
            // 使用缓存验证，避免频繁读取树文件
            if (await this.isValidIssueId(rawIssueId)) {
                validIssueId = rawIssueId;
            } else {
                this.logger.warn(`URI 中包含 issueId "${rawIssueId}"，但在树结构中未找到该节点`);
            }
        }
        
        const isInIssueDir = this.isFileInIssueDir(editor?.document?.uri);
        
        vscode.commands.executeCommand('setContext', 'issueManager.editorHasIssueId', !!validIssueId);
        vscode.commands.executeCommand('setContext', 'issueManager.editorActiveIssueId', validIssueId);
        vscode.commands.executeCommand('setContext', 'issueManager.editorInIssueDir', isInIssueDir);
    }

    /**
     * 使用缓存验证 issueId 是否有效
     * @param issueId 要验证的问题 ID
     * @returns 是否有效
     */
    private async isValidIssueId(issueId: string): Promise<boolean> {
        // 如果缓存失效，重新加载
        if (this.cacheInvalidated) {
            await this.rebuildCache();
        }
        
        return this.validIssueIds.has(issueId);
    }

    /**
     * 重新构建有效 issueId 的缓存
     */
    private async rebuildCache(): Promise<void> {
        try {
            const tree = await readTree();
            this.validIssueIds.clear();
            
            // 递归收集所有节点的 ID
            const collectIds = (nodes: IssueTreeNode[]) => {
                for (const node of nodes) {
                    if (node.id) {
                        this.validIssueIds.add(node.id);
                    }
                    if (node.children && node.children.length > 0) {
                        collectIds(node.children);
                    }
                }
            };
            
            collectIds(tree.rootNodes);
            this.cacheInvalidated = false;
            
            // 计算缓存占用的内存（估算）
            const cacheSize = this.validIssueIds.size;
            const estimatedMemoryKB = Math.round(cacheSize * 0.1); // 每个 ID 约 100 字节
            this.logger.info(`已重建 issueId 缓存，共 ${cacheSize} 个节点，每个 ID 约 100 字节，估计占用 ${estimatedMemoryKB}KB 内存`);
        } catch (error) {
            this.logger.error('重建 issueId 缓存失败:', error);
            // 发生错误时保持缓存失效状态，下次会重试
        }
    }

    /**
     * 检查文件是否在配置的问题目录下
     * @param uri 文件的 URI
     * @returns 是否在问题目录下
     */
    private isFileInIssueDir(uri: vscode.Uri | undefined): boolean {
        if (!uri || uri.scheme !== 'file') {
            return false;
        }

        const issueDir = getIssueDir();
        if (!issueDir) {
            return false;
        }

        const filePath = uri.fsPath;
        const relativePath = path.relative(issueDir, filePath);

        // 如果 filePath 在 issueDir 内部，relativePath 将是一个相对路径（例如 'foo/bar.md' 或 ''）。
        // 如果在外部，它将以 '..' 开头，或者在 Windows 上跨驱动器时是绝对路径。
        return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
    }

    /**
     * 强制重新检查当前编辑器的上下文
     * 用于在问题状态改变（如解除关联）后更新上下文
     * @param invalidateCache 是否使缓存失效，默认为 true
     */
    public async recheckCurrentEditor(invalidateCache: boolean = true): Promise<void> {
        if (invalidateCache) {
            this.invalidateCache();
        }
        await this.updateEditorIssueContext(vscode.window.activeTextEditor);
        this.logger.info('已重新检查当前编辑器上下文');
    }

    /**
     * 使缓存失效，下次验证时会重新从树文件加载
     * 应在树结构发生变化时调用（如添加/删除/移动节点）
     */
    public invalidateCache(): void {
        this.cacheInvalidated = true;
        this.logger.debug('issueId 缓存已标记为失效');
    }

    public dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        this.logger.info(`EditorContextService disposed.`);
    }
}

