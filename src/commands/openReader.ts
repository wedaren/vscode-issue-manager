import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import { handleWebviewMessage } from '../webviewMessageHandler';

export function registerOpenEnglishReaderCommand(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('issueManager.openEnglishReader', async () => {
        const panel = vscode.window.createWebviewPanel(
            'englishReader',
            '英文阅读器',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );

        // 读取静态 HTML 模板并用 webview URI 替换资源链接
        const htmlPath = context.asAbsolutePath('webview-src/reader/index.html');
        let html = await fs.readFile(htmlPath, 'utf8');

        const scriptUri = panel.webview.asWebviewUri(vscode.Uri.file(context.asAbsolutePath('webview-src/reader/main.js')));
        const styleUri = panel.webview.asWebviewUri(vscode.Uri.file(context.asAbsolutePath('webview-src/reader/style.css')));

        html = html.replace(/%SCRIPT_URI%/g, String(scriptUri)).replace(/%STYLE_URI%/g, String(styleUri));

        panel.webview.html = html;

        // 消息处理
        panel.webview.onDidReceiveMessage(msg => {
            try {
                void handleWebviewMessage(panel, msg, context);
            } catch (err) {
                console.error('webview message handler error:', err);
            }
        }, undefined, context.subscriptions);
    });

    context.subscriptions.push(disposable);
}
