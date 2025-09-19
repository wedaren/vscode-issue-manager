import * as vscode from 'vscode';
import { getIssueDir } from '../config';
import { debounce } from '../utils/debounce';

/**
 * 事件监听器注册器
 * 负责注册各种事件监听器和文件系统监听器
 */
export class EventListenerRegistrar {
    /**
     * 注册所有事件监听器
     */
    static register(context: vscode.ExtensionContext): void {
        // 监听 issueDir 下的 Markdown 文件变化，刷新相关视图
        this.setupFileWatcher(context);
    }

    /**
     * 设置文件系统监听器
     */
    private static setupFileWatcher(context: vscode.ExtensionContext): void {
        let watcher: vscode.FileSystemWatcher | undefined;

        const setupWatcher = () => {
            if (watcher) {
                watcher.dispose();
                // 从 subscriptions 中移除旧的引用
                const index = context.subscriptions.indexOf(watcher);
                if (index !== -1) {
                    context.subscriptions.splice(index, 1);
                }
            }
            const issueDir = getIssueDir();
            if (issueDir) {
                watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(issueDir, '**/*.md'));

                const debouncedRefresh = debounce(() => {
                    console.log('Markdown file changed, refreshing views...');
                    vscode.commands.executeCommand('issueManager.refreshAllViews');
                }, 500);

                watcher.onDidChange(debouncedRefresh);
                watcher.onDidCreate(debouncedRefresh);
                watcher.onDidDelete(debouncedRefresh);

                context.subscriptions.push(watcher);
            }
        };

        // 首次激活时设置监听器
        setupWatcher();

        // 当配置更改时，重新设置监听器
        context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('issueManager.issueDir')) {
                setupWatcher();
                // 刷新所有视图以反映新目录的内容
                vscode.commands.executeCommand('issueManager.refreshAllViews');
            }
        }));
    }
}