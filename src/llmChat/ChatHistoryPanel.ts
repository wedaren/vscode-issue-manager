/**
 * 聊天记录 Webview 面板（编辑器区域）
 *
 * 以气泡形式展示与某个 LLM 角色（或群组）的对话历史，
 * 支持实时接收流式回复并滚动到底部。
 */
import * as vscode from 'vscode';
import { parseConversationMessages } from './llmChatDataManager';
import type { ChatMessage, ChatRoleInfo } from './types';
import { Logger } from '../core/utils/Logger';

const logger = Logger.getInstance();

export class ChatHistoryPanel {
    private static panels = new Map<string, ChatHistoryPanel>();

    private panel: vscode.WebviewPanel;
    private _disposed = false;
    private _panelKey: string;
    private _conversationUri: vscode.Uri;
    private _role: ChatRoleInfo;

    private constructor(
        panel: vscode.WebviewPanel,
        role: ChatRoleInfo,
        conversationUri: vscode.Uri,
        private readonly extensionUri: vscode.Uri,
    ) {
        this.panel = panel;
        this._role = role;
        this._panelKey = role.id;
        this._conversationUri = conversationUri;

        this.panel.onDidDispose(() => this.dispose());

        // 初始加载
        void this.refreshMessages();
    }

    /** 获取或创建面板（每个角色一个面板） */
    static async openOrShow(
        role: ChatRoleInfo,
        conversationUri: vscode.Uri,
        extensionUri: vscode.Uri,
    ): Promise<ChatHistoryPanel> {
        const key = role.id;
        const existing = ChatHistoryPanel.panels.get(key);
        if (existing && !existing._disposed) {
            existing._conversationUri = conversationUri;
            existing._role = role;
            existing.panel.reveal(vscode.ViewColumn.One);
            await existing.refreshMessages();
            return existing;
        }

        const panel = vscode.window.createWebviewPanel(
            'llmChatHistory',
            `💬 ${role.name}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri],
            },
        );

        const instance = new ChatHistoryPanel(panel, role, conversationUri, extensionUri);
        ChatHistoryPanel.panels.set(key, instance);
        return instance;
    }

    /** 获取已存在的面板 */
    static get(key: string): ChatHistoryPanel | undefined {
        const p = ChatHistoryPanel.panels.get(key);
        return p && !p._disposed ? p : undefined;
    }

    get conversationUri(): vscode.Uri {
        return this._conversationUri;
    }

    get panelKey(): string {
        return this._panelKey;
    }

    /** 追加一条消息到界面 */
    appendMessage(role: 'user' | 'assistant', content: string, roleName?: string): void {
        this.panel.webview.postMessage({
            type: 'appendMessage',
            role,
            content: escapeHtml(content),
            roleName: roleName || '',
            timestamp: Date.now(),
        });
    }

    /** 追加系统/协调者消息到界面 */
    appendSystemMessage(content: string): void {
        this.panel.webview.postMessage({
            type: 'appendSystemMessage',
            content: escapeHtml(content),
        });
    }

    /** 流式追加 chunk（带角色名，用于群聊区分） */
    streamChunk(chunk: string, roleName?: string): void {
        this.panel.webview.postMessage({
            type: 'streamChunk',
            content: escapeHtml(chunk),
            roleName: roleName || '',
        });
    }

    /** 流式结束 */
    streamEnd(): void {
        this.panel.webview.postMessage({ type: 'streamEnd' });
    }

    /** 显示 loading 指示 */
    setLoading(loading: boolean, roleName?: string): void {
        this.panel.webview.postMessage({ type: 'setLoading', loading, roleName: roleName || '' });
    }

    /** 显示工具调用状态 */
    showToolStatus(toolName: string, phase: 'calling' | 'done', roleName?: string): void {
        this.panel.webview.postMessage({
            type: 'toolStatus',
            toolName,
            phase,
            roleName: roleName || '',
        });
    }

    /** 完整刷新消息列表 */
    async refreshMessages(): Promise<void> {
        const messages = await parseConversationMessages(this._conversationUri);
        this.panel.webview.html = this.getHtml(messages);
    }

    private dispose(): void {
        this._disposed = true;
        ChatHistoryPanel.panels.delete(this._panelKey);
        this.panel.dispose();
    }

    // ─── HTML ─────────────────────────────────────────────────

    private getHtml(messages: ChatMessage[]): string {
        const nonce = getNonce();
        const webview = this.panel.webview;
        const roleName = this._role.name;
        const roleAvatar = this._role.avatar || 'hubot';

        const messagesHtml = messages.map(m => {
            const isUser = m.role === 'user';
            const cls = isUser ? 'msg-user' : 'msg-assistant';
            const icon = isUser ? 'person' : roleAvatar;
            const label = isUser ? '我' : roleName;
            const time = formatTime(m.timestamp);
            return `<div class="msg ${cls}">
                <div class="msg-header">
                    <span class="msg-icon codicon codicon-${icon}"></span>
                    <span class="msg-label">${escapeHtml(label)}</span>
                    <span class="msg-time">${time}</span>
                </div>
                <div class="msg-body">${renderMarkdown(m.content)}</div>
            </div>`;
        }).join('\n');

        return this.wrapHtml(nonce, webview, roleName, roleAvatar, messagesHtml, messages.length === 0);
    }

    // ─── 通用 HTML 壳 ────────────────────────────────────────

    private wrapHtml(
        nonce: string,
        webview: vscode.Webview,
        headerName: string,
        headerIcon: string,
        messagesHtml: string,
        isEmpty: boolean,
    ): string {
        const emptyHtml = isEmpty
            ? `<div class="empty-state">
                <div class="codicon codicon-comment-discussion"></div>
                <div>开始对话吧</div>
                <div style="font-size:11px;margin-top:4px">在下方输入面板发送消息</div>
               </div>`
            : '';

        return /*html*/`<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            padding: 0;
            overflow-y: auto;
        }
        .chat-header {
            position: sticky; top: 0; z-index: 10;
            background: var(--vscode-editorGroupHeader-tabsBackground);
            border-bottom: 1px solid var(--vscode-widget-border);
            padding: 8px 16px;
            display: flex; align-items: center; gap: 8px;
            font-weight: 600;
        }
        .chat-header .codicon { font-size: 16px; }
        .chat-container {
            padding: 12px 16px 80px;
            display: flex; flex-direction: column; gap: 12px;
        }
        .msg {
            max-width: 85%;
            border-radius: 8px;
            padding: 8px 12px;
        }
        .msg-user {
            align-self: flex-end;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .msg-assistant {
            align-self: flex-start;
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-widget-border);
        }
        .msg-header {
            display: flex; align-items: center; gap: 6px;
            font-size: 11px;
            opacity: 0.75;
            margin-bottom: 4px;
        }
        .msg-label { font-weight: 600; }
        .msg-time { margin-left: auto; }
        .msg-body {
            line-height: 1.5;
            white-space: pre-wrap;
            word-break: break-word;
        }
        .msg-body code {
            background: var(--vscode-textCodeBlock-background);
            padding: 1px 4px;
            border-radius: 3px;
            font-family: var(--vscode-editor-font-family);
            font-size: 0.9em;
        }
        .msg-body pre {
            background: var(--vscode-textCodeBlock-background);
            padding: 8px;
            border-radius: 4px;
            overflow-x: auto;
            margin: 6px 0;
        }
        .msg-body pre code {
            background: none;
            padding: 0;
        }
        .loading-indicator {
            align-self: flex-start;
            padding: 8px 12px;
            font-style: italic;
            color: var(--vscode-descriptionForeground);
            display: none;
        }
        .loading-indicator.visible { display: block; }
        .streaming-bubble {
            align-self: flex-start;
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 8px;
            padding: 8px 12px;
            max-width: 85%;
            display: none;
            line-height: 1.5;
            white-space: pre-wrap;
            word-break: break-word;
        }
        .streaming-bubble.visible { display: block; }
        .streaming-bubble .stream-header {
            font-size: 11px; opacity: 0.75; font-weight: 600;
            margin-bottom: 4px;
        }
        .empty-state {
            text-align: center;
            padding: 48px 16px;
            color: var(--vscode-descriptionForeground);
        }
        .empty-state .codicon { font-size: 32px; margin-bottom: 12px; }
        .msg-system {
            align-self: center;
            background: var(--vscode-editorInfo-background, rgba(0,120,212,0.1));
            border: 1px dashed var(--vscode-editorInfo-foreground, #3794ff);
            border-radius: 6px;
            padding: 6px 14px;
            font-size: 12px;
            color: var(--vscode-editorInfo-foreground, #3794ff);
            max-width: 90%;
            text-align: center;
        }
        .tool-status {
            align-self: flex-start;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            padding: 3px 10px;
            display: flex; align-items: center; gap: 6px;
        }
        .tool-status .tool-spinner {
            display: inline-block;
            width: 12px; height: 12px;
            border: 2px solid var(--vscode-descriptionForeground);
            border-top-color: transparent;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <div class="chat-header">
        <span class="codicon codicon-${escapeHtml(headerIcon)}"></span>
        <span>${escapeHtml(headerName)}</span>
    </div>
    <div class="chat-container" id="chatContainer">
        ${isEmpty ? emptyHtml : messagesHtml}
        <div class="tool-status" id="toolStatus" style="display:none;"></div>
        <div class="loading-indicator" id="loading">正在思考…</div>
        <div class="streaming-bubble" id="streamBubble">
            <div class="stream-header" id="streamHeader"></div>
            <div id="streamContent"></div>
        </div>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const container = document.getElementById('chatContainer');
        const loading = document.getElementById('loading');
        const streamBubble = document.getElementById('streamBubble');
        const streamHeader = document.getElementById('streamHeader');
        const streamContent = document.getElementById('streamContent');
        const toolStatus = document.getElementById('toolStatus');

        const TOOL_LABELS = {
            search_issues: '检索笔记',
            read_issue: '读取笔记',
            create_issue: '创建笔记',
            create_issue_tree: '创建层级笔记',
            list_issue_tree: '查看笔记结构',
            update_issue: '更新笔记',
            web_search: '网络搜索',
            fetch_url: '抓取网页',
        };

        function scrollToBottom() {
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        }

        scrollToBottom();

        window.addEventListener('message', (event) => {
            const msg = event.data;
            switch (msg.type) {
                case 'appendMessage': {
                    const empty = container.querySelector('.empty-state');
                    if (empty) empty.remove();

                    const isUser = msg.role === 'user';
                    const div = document.createElement('div');
                    div.className = 'msg ' + (isUser ? 'msg-user' : 'msg-assistant');
                    const label = isUser ? '我' : (msg.roleName || '${escapeHtml(headerName)}');
                    div.innerHTML =
                        '<div class="msg-header">' +
                            '<span class="msg-label">' + label + '</span>' +
                            '<span class="msg-time">' + new Date(msg.timestamp).toLocaleTimeString() + '</span>' +
                        '</div>' +
                        '<div class="msg-body">' + msg.content + '</div>';
                    container.insertBefore(div, loading);
                    scrollToBottom();
                    break;
                }
                case 'streamChunk': {
                    streamBubble.classList.add('visible');
                    if (msg.roleName) {
                        streamHeader.textContent = msg.roleName;
                    }
                    streamContent.textContent = msg.content;
                    scrollToBottom();
                    break;
                }
                case 'streamEnd': {
                    streamBubble.classList.remove('visible');
                    streamHeader.textContent = '';
                    streamContent.textContent = '';
                    break;
                }
                case 'setLoading': {
                    if (msg.loading) {
                        loading.textContent = msg.roleName ? msg.roleName + ' 正在思考…' : '正在思考…';
                        loading.classList.add('visible');
                    } else {
                        loading.classList.remove('visible');
                    }
                    scrollToBottom();
                    break;
                }
                case 'appendSystemMessage': {
                    const empty = container.querySelector('.empty-state');
                    if (empty) empty.remove();

                    const div = document.createElement('div');
                    div.className = 'msg-system';
                    div.textContent = msg.content;
                    container.insertBefore(div, toolStatus);
                    scrollToBottom();
                    break;
                }
                case 'toolStatus': {
                    const label = TOOL_LABELS[msg.toolName] || msg.toolName;
                    const prefix = msg.roleName ? msg.roleName + ' ' : '';
                    if (msg.phase === 'calling') {
                        toolStatus.innerHTML = '<span class="tool-spinner"></span>' + prefix + '正在' + label + '…';
                        toolStatus.style.display = 'flex';
                    } else {
                        toolStatus.style.display = 'none';
                    }
                    scrollToBottom();
                    break;
                }
            }
        });
    </script>
</body>
</html>`;
    }
}

// ─── 工具函数 ────────────────────────────────────────────────

function getNonce(): string {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** 简易 markdown 渲染 */
function renderMarkdown(text: string): string {
    let html = escapeHtml(text);
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) => {
        return `<pre><code>${code}</code></pre>`;
    });
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    return html;
}

function formatTime(ts: number): string {
    const d = new Date(ts);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
