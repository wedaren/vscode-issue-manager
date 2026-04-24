import * as vscode from 'vscode';
import * as path from 'path';
import { RoleTimerManager } from './RoleTimerManager';

const FOCUS_COMMAND = 'issueManager.llmChat.focusExecutingConversation';

/**
 * 注册 Chat 状态栏：跟踪 RoleTimerManager 中正在执行的 LLM 对话数量，
 * 原来由被删除的 ChatHistoryPanel 负责的流式运行提示，由此状态栏补回来。
 *
 * - 无执行中对话时隐藏；有执行中对话时显示 `$(loading~spin) LLM 执行中: N`
 * - 点击跳转到执行中的对话文件（多个时用 QuickPick 选一个）
 */
export function registerChatStatusBar(context: vscode.ExtensionContext): void {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 95);
    item.command = FOCUS_COMMAND;
    item.tooltip = '点击跳转到正在执行的 LLM 对话';
    context.subscriptions.push(item);

    const mgr = RoleTimerManager.getInstance();
    const render = (count: number) => {
        if (count <= 0) {
            item.hide();
            return;
        }
        item.text = `$(loading~spin) LLM 执行中: ${count}`;
        item.show();
    };
    render(mgr.executingCount);
    context.subscriptions.push(mgr.onExecutingCountChange(render));

    context.subscriptions.push(
        vscode.commands.registerCommand(FOCUS_COMMAND, async () => {
            const paths = RoleTimerManager.getInstance().executingPaths;
            if (paths.length === 0) { return; }
            const target = paths.length === 1
                ? paths[0]
                : (await vscode.window.showQuickPick(
                    paths.map(p => ({ label: path.basename(p), description: p, fsPath: p })),
                    { placeHolder: '选择要打开的执行中对话' },
                ))?.fsPath;
            if (target) {
                await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(target));
            }
        }),
    );
}
