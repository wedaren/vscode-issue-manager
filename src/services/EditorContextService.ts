import * as vscode from 'vscode';
import { Logger } from '../core/utils/Logger';

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
     * 当活动编辑器改变时，更新相关的上下文键。
     * @param editor 激活的文本编辑器
     */
    private updateEditorIssueContext(editor: vscode.TextEditor | undefined): void {
        let hasId = false;
        let issueId = '';

        if (editor?.document?.uri) {
            try {
                const q = editor.document.uri.query || '';
                const m = q.match(/(?:^|&)issueId=([^&]+)/);
                if (m) {
                    hasId = true;
                    issueId = decodeURIComponent(m[1]);
                }
            } catch (error) {
                this.logger.error('从编辑器 URI 解析 issueId 失败', { error, uri: editor.document.uri.toString() });
            }
        }

        vscode.commands.executeCommand('setContext', 'issueManager.editorHasIssueId', hasId);
        vscode.commands.executeCommand('setContext', 'issueManager.editorActiveIssueId', issueId);
    }

    public dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        this.logger.info(`EditorContextService disposed.`);
    }
}

