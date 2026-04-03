/**
 * 聊天输入面板（底部面板 Webview）
 *
 * 提供一个位于底部面板区域的聊天输入框，用于向 LLM 发送消息。
 * 发送后自动更新编辑器区域的 ChatHistoryPanel。
 */
import * as vscode from 'vscode';
import { LLMChatService } from './LLMChatService';
import { ChatHistoryPanel } from './ChatHistoryPanel';
import { Logger } from '../core/utils/Logger';

const logger = Logger.getInstance();

export class ChatInputPanel implements vscode.WebviewViewProvider {
    public static readonly viewType = 'issueManager.views.chatInput';

    private _view?: vscode.WebviewView;
    private _chatService: LLMChatService;
    private _isProcessing = false;

    constructor(private readonly context: vscode.ExtensionContext) {
        this._chatService = LLMChatService.getInstance();
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _ctx: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri],
        };

        webviewView.webview.html = this.getHtmlContent(webviewView.webview);

        // 监听来自 webview 的消息
        webviewView.webview.onDidReceiveMessage(async (message) => {
            if (message.type === 'sendMessage') {
                const text = (message.text || '').trim();
                if (!text || this._isProcessing) { return; }
                await this.handleSendMessage(text);
            }
        }, undefined, this.context.subscriptions);
    }

    /** 发送消息到 LLM 并更新 ChatHistoryPanel */
    private async handleSendMessage(text: string): Promise<void> {
        const chatService = this._chatService;
        if (!chatService.activeConversationUri || (!chatService.activeRole && !chatService.activeGroup)) {
            vscode.window.showWarningMessage('请先在 LLM 聊天视图中点击一个角色或群组开始对话');
            return;
        }

        this._isProcessing = true;
        this.postMessage({ type: 'setProcessing', processing: true });

        const abortController = new AbortController();

        try {
            if (chatService.isGroupChat) {
                await this.handleGroupSend(text, abortController);
            } else {
                await this.handleSingleSend(text, abortController);
            }
        } catch (e) {
            if (!abortController.signal.aborted) {
                logger.error('[ChatInputPanel] 发送失败', e);
            }
        } finally {
            this._isProcessing = false;
            this.postMessage({ type: 'setProcessing', processing: false });
        }
    }

    /** 单聊发送 */
    private async handleSingleSend(text: string, abortController: AbortController): Promise<void> {
        const chatService = this._chatService;
        const historyPanel = ChatHistoryPanel.get(chatService.activeRole!.id);

        historyPanel?.appendMessage('user', text);
        historyPanel?.setLoading(true);

        try {
            let accumulated = '';
            await chatService.sendMessageStream(
                text,
                (chunk) => {
                    accumulated += chunk;
                    historyPanel?.streamChunk(accumulated);
                },
                {
                    signal: abortController.signal,
                    onToolStatus: (status) => {
                        historyPanel?.showToolStatus(status.toolName, status.phase);
                    },
                },
            );

            historyPanel?.streamEnd();
            historyPanel?.setLoading(false);
            if (accumulated) {
                historyPanel?.appendMessage('assistant', accumulated);
            }
        } catch (e) {
            historyPanel?.streamEnd();
            historyPanel?.setLoading(false);
            throw e;
        }
    }

    /** 群聊发送 */
    private async handleGroupSend(text: string, abortController: AbortController): Promise<void> {
        const chatService = this._chatService;
        const panelKey = `group:${chatService.activeGroup!.id}`;
        const historyPanel = ChatHistoryPanel.get(panelKey);

        historyPanel?.appendMessage('user', text);
        historyPanel?.setLoading(true, '协调者');

        try {
            await chatService.sendGroupMessageStream(text, {
                onCoordinatorPlan: (plan) => {
                    historyPanel?.setLoading(false);
                    historyPanel?.appendSystemMessage(`🎯 ${plan.summary}`);
                },
                onMemberStart: (role) => {
                    historyPanel?.setLoading(true, role.name);
                },
                onChunk: (chunk, role) => {
                    historyPanel?.streamChunk(chunk, role.name);
                },
                onMemberEnd: (role, fullReply) => {
                    historyPanel?.streamEnd();
                    historyPanel?.setLoading(false);
                    if (fullReply) {
                        historyPanel?.appendMessage('assistant', fullReply, role.name);
                    }
                },
            }, { signal: abortController.signal });
        } catch (e) {
            historyPanel?.streamEnd();
            historyPanel?.setLoading(false);
            throw e;
        }
    }

    /** 通知面板当前对话已切换 */
    notifyConversationChanged(): void {
        const chatService = this._chatService;
        const name = chatService.isGroupChat
            ? chatService.activeGroup?.name || ''
            : chatService.activeRole?.name || '';
        this.postMessage({
            type: 'updateStatus',
            roleName: name,
            hasActiveConversation: !!chatService.activeConversationUri,
        });
    }

    private postMessage(message: unknown): void {
        this._view?.webview.postMessage(message);
    }

    private getHtmlContent(webview: vscode.Webview): string {
        const nonce = getNonce();

        return /*html*/`<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-panel-background, var(--vscode-editor-background));
            padding: 8px;
            display: flex;
            flex-direction: column;
            height: 100vh;
        }
        .status-bar {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            padding: 2px 4px 6px;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .status-bar .role-name {
            font-weight: 600;
            color: var(--vscode-textLink-foreground);
        }
        .status-bar .indicator {
            width: 6px; height: 6px;
            border-radius: 50%;
            background: var(--vscode-testing-iconPassed);
        }
        .status-bar .indicator.inactive {
            background: var(--vscode-disabledForeground);
        }
        .input-area {
            display: flex;
            gap: 6px;
            flex: 1;
            min-height: 0;
        }
        textarea {
            flex: 1;
            resize: none;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            padding: 6px 8px;
            border-radius: 4px;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            outline: none;
            min-height: 36px;
        }
        textarea:focus { border-color: var(--vscode-focusBorder); }
        textarea::placeholder { color: var(--vscode-input-placeholderForeground); }
        button.send-btn {
            width: 36px; min-height: 36px;
            border: none; border-radius: 4px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            font-size: 16px; flex-shrink: 0;
        }
        button.send-btn:hover { background: var(--vscode-button-hoverBackground); }
        button.send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    </style>
</head>
<body>
    <div class="status-bar">
        <span class="indicator inactive" id="indicator"></span>
        <span id="statusText">未选择对话</span>
        <span class="role-name" id="roleName"></span>
    </div>
    <div class="input-area">
        <textarea id="input" placeholder="输入消息…（Enter 发送，Shift+Enter 换行）" rows="2"></textarea>
        <button class="send-btn" id="sendBtn" title="发送 (Enter)">▶</button>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const input = document.getElementById('input');
        const sendBtn = document.getElementById('sendBtn');
        const indicator = document.getElementById('indicator');
        const statusText = document.getElementById('statusText');
        const roleName = document.getElementById('roleName');

        let processing = false;

        function send() {
            const text = input.value.trim();
            if (!text || processing) return;
            vscode.postMessage({ type: 'sendMessage', text });
            input.value = '';
            input.style.height = 'auto';
        }

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
            }
        });

        input.addEventListener('input', () => {
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        });

        sendBtn.addEventListener('click', send);

        window.addEventListener('message', (event) => {
            const msg = event.data;
            switch (msg.type) {
                case 'setProcessing':
                    processing = msg.processing;
                    sendBtn.disabled = processing;
                    input.disabled = processing;
                    if (!processing) input.focus();
                    break;
                case 'updateStatus':
                    if (msg.hasActiveConversation) {
                        indicator.classList.remove('inactive');
                        statusText.textContent = '对话中';
                        roleName.textContent = msg.roleName || '';
                    } else {
                        indicator.classList.add('inactive');
                        statusText.textContent = '未选择对话';
                        roleName.textContent = '';
                    }
                    break;
            }
        });

        input.focus();
    </script>
</body>
</html>`;
    }
}

function getNonce(): string {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}
