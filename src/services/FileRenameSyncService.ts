import * as vscode from 'vscode';
import * as path from 'path';
import { getIssueDir } from '../config';
import { IssueFrontmatterService } from '../services/IssueFrontmatterService';

/**
 * 文件重命名同步服务
 * 监听文件重命名事件，自动更新所有引用
 */
export class FileRenameSyncService implements vscode.Disposable {
    private static instance: FileRenameSyncService;
    private disposables: vscode.Disposable[] = [];

    private constructor(private context: vscode.ExtensionContext) {
        this.setupListeners();
    }

    public static getInstance(context: vscode.ExtensionContext): FileRenameSyncService {
        if (!FileRenameSyncService.instance) {
            FileRenameSyncService.instance = new FileRenameSyncService(context);
        }
        return FileRenameSyncService.instance;
    }

    /**
     * 设置文件重命名监听器
     */
    private setupListeners(): void {
        // 监听文件重命名事件
        const renameListener = vscode.workspace.onDidRenameFiles(async (event) => {
            await this.handleRenameFiles(event);
        });

        this.disposables.push(renameListener);
        this.context.subscriptions.push(renameListener);
    }

    /**
     * 处理文件重命名事件
     */
    private async handleRenameFiles(event: vscode.FileRenameEvent): Promise<void> {
        const issueDir = getIssueDir();
        if (!issueDir) {
            return;
        }

        const service = IssueFrontmatterService.getInstance();

        for (const file of event.files) {
            const oldPath = file.oldUri.fsPath;
            const newPath = file.newUri.fsPath;

            // 只处理 Markdown 文件
            if (!oldPath.endsWith('.md') || !newPath.endsWith('.md')) {
                continue;
            }

            // 检查文件是否在 issueDir 内
            if (!oldPath.startsWith(issueDir) || !newPath.startsWith(issueDir)) {
                continue;
            }

            // 计算相对路径
            const oldRelativePath = this.toRelativePath(oldPath, issueDir);
            const newRelativePath = this.toRelativePath(newPath, issueDir);

            if (oldRelativePath && newRelativePath) {
                console.log(`检测到文件重命名: ${oldRelativePath} -> ${newRelativePath}`);
                
                // 更新所有引用了旧路径的文件
                const success = await service.updatePathReferences(oldRelativePath, newRelativePath);
                
                if (success) {
                    console.log(`成功更新了所有引用 ${oldRelativePath} 的文件`);
                } else {
                    console.warn(`更新引用 ${oldRelativePath} 的文件时出现问题`);
                }
            }
        }

        // 刷新视图
        vscode.commands.executeCommand('issueManager.refreshAllViews');
    }

    /**
     * 将绝对路径转换为相对于 issueDir 的 POSIX 风格路径
     */
    private toRelativePath(absolutePath: string, issueDir: string): string | null {
        try {
            // 获取相对路径
            let relativePath = path.relative(issueDir, absolutePath);
            
            // 转换为 POSIX 风格（使用 / 而不是 \）
            relativePath = relativePath.replace(/\\/g, '/');
            
            return relativePath;
        } catch (error) {
            console.error('转换相对路径失败:', error);
            return null;
        }
    }

    /**
     * 清理资源
     */
    public dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];
    }
}
