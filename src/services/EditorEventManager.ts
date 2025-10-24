import * as vscode from 'vscode';
import { isIssueMarkdownFile } from '../utils/fileUtils';

/**
 * 编辑器事件管理器
 * 
 * 统一管理编辑器相关的事件监听，避免重复订阅同一个事件。
 * 当前支持的事件：
 * - onDidChangeActiveTextEditor: 编辑器切换事件
 * 
 * 采用观察者模式，允许多个模块订阅同一个事件。
 */
export class EditorEventManager implements vscode.Disposable {
    private static instance: EditorEventManager | null = null;
    private disposables: vscode.Disposable[] = [];
    
    /** Issue Markdown 文件激活事件的订阅者列表 */
    private issueFileActivatedHandlers: Array<(uri: vscode.Uri) => void> = [];

    private constructor(context: vscode.ExtensionContext) {
        this.setupEventListeners();
        context.subscriptions.push(this);
    }

    /**
     * 获取单例实例
     */
    public static getInstance(context?: vscode.ExtensionContext): EditorEventManager {
        if (!EditorEventManager.instance && context) {
            EditorEventManager.instance = new EditorEventManager(context);
        } else if (!EditorEventManager.instance) {
            throw new Error('EditorEventManager 必须首先使用 context 进行初始化');
        }
        return EditorEventManager.instance;
    }

    /**
     * 初始化编辑器事件管理器
     */
    public static initialize(context: vscode.ExtensionContext): EditorEventManager {
        return EditorEventManager.getInstance(context);
    }

    /**
     * 设置事件监听器
     */
    private setupEventListeners(): void {
        // 只监听一次编辑器切换事件
        const activeEditorListener = vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor && isIssueMarkdownFile(editor.document.uri)) {
                // 通知所有订阅者
                this.notifyIssueFileActivated(editor.document.uri);
            }
        });
        this.disposables.push(activeEditorListener);
    }

    /**
     * 订阅 Issue Markdown 文件激活事件
     * 
     * @param handler 当 Issue Markdown 文件被激活时的回调函数
     * @returns Disposable 对象，调用 dispose() 可以取消订阅
     */
    public onIssueFileActivated(handler: (uri: vscode.Uri) => void): vscode.Disposable {
        this.issueFileActivatedHandlers.push(handler);
        
        // 返回一个 Disposable，允许取消订阅
        return {
            dispose: () => {
                const index = this.issueFileActivatedHandlers.indexOf(handler);
                if (index > -1) {
                    this.issueFileActivatedHandlers.splice(index, 1);
                }
            }
        };
    }

    /**
     * 通知所有订阅者 Issue 文件已激活
     */
    private notifyIssueFileActivated(uri: vscode.Uri): void {
        for (const handler of this.issueFileActivatedHandlers) {
            try {
                handler(uri);
            } catch (error) {
                console.error('处理 Issue 文件激活事件时出错:', error);
            }
        }
    }

    /**
     * 销毁服务，清理资源
     */
    public dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        this.issueFileActivatedHandlers = [];
        EditorEventManager.instance = null;
    }
}
