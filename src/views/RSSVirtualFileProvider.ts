import * as vscode from 'vscode';
import { RSSService } from '../services/RSSService';

/**
 * RSS虚拟文件系统提供器
 * 用于在VS Code中以虚拟文件形式预览RSS文章的Markdown内容
 */
export class RSSVirtualFileProvider implements vscode.TextDocumentContentProvider, vscode.Disposable  {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;

    private rssService: RSSService;

    constructor() {
        this.rssService = RSSService.getInstance();
    }

    /**
     * 提供虚拟文件的内容
     */
    provideTextDocumentContent(uri: vscode.Uri): string | null {
        try {
            // 从URI查询参数中提取文章ID
            const query = new URLSearchParams(uri.query);
            const itemId = query.get('itemId');
            
            if (!itemId) {
                return '# 错误\n\n无法找到文章ID';
            }

            // 从RSS服务获取文章的Markdown内容
            const markdown = this.rssService.getItemMarkdown(decodeURIComponent(itemId));
            
            if (!markdown) {
                return '# 错误\n\n无法找到指定的RSS文章';
            }

            return markdown;
        } catch (error) {
            console.error('提供RSS虚拟文件内容失败:', error);
            return '# 错误\n\n加载文章内容时发生错误';
        }
    }

    /**
     * 刷新虚拟文件内容
     */
    refresh(uri: vscode.Uri): void {
        this._onDidChange.fire(uri);
    }

    /**
     * 释放资源
     */
    dispose(): void {
        this._onDidChange.dispose();
    }
}

/**
 * 注册RSS虚拟文件系统提供器
 */
export function registerRSSVirtualFileProvider(context: vscode.ExtensionContext): RSSVirtualFileProvider {
    const provider = new RSSVirtualFileProvider();
    
    // 注册虚拟文件系统提供器
    const registration = vscode.workspace.registerTextDocumentContentProvider('rss-preview', provider);
    context.subscriptions.push(registration);
    context.subscriptions.push(provider);
    
    return provider;
}
