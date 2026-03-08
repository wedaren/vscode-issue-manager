/**
 * LLM 聊天角色树视图提供者
 *
 * 两级树：角色/群组 → 历史对话列表。点击对话打开聊天 Webview。
 */
import * as vscode from 'vscode';
import { getAllChatRoles, getConversationsForRole, getAllChatGroups, getConversationsForGroup } from './llmChatDataManager';
import type { ChatRoleInfo, ChatConversationInfo, ChatGroupInfo } from './types';

// ─── 节点类型 ────────────────────────────────────────────────

export class ChatRoleNode extends vscode.TreeItem {
    constructor(public readonly role: ChatRoleInfo) {
        super(role.name, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'chatRole';
        this.iconPath = new vscode.ThemeIcon(role.avatar || 'hubot');
        this.description = role.systemPrompt
            ? role.systemPrompt.slice(0, 40) + (role.systemPrompt.length > 40 ? '…' : '')
            : undefined;
        this.tooltip = new vscode.MarkdownString(
            `**${role.name}**\n\n${role.systemPrompt || '（无系统提示词）'}`,
        );
    }
}

export class ChatGroupNode extends vscode.TreeItem {
    constructor(public readonly group: ChatGroupInfo) {
        super(group.name, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'chatGroup';
        this.iconPath = new vscode.ThemeIcon(group.avatar || 'organization');
        this.description = `${group.memberIds.length} 位成员`;
        this.tooltip = new vscode.MarkdownString(
            `**${group.name}**\n\n成员: ${group.memberIds.length} 位`,
        );
    }
}

export class ChatConversationNode extends vscode.TreeItem {
    constructor(
        public readonly conversation: ChatConversationInfo,
        public readonly parentId: string,
        public readonly isGroup: boolean,
    ) {
        super(conversation.title, vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'chatConversation';
        this.iconPath = new vscode.ThemeIcon('comment-discussion');
        this.description = formatRelativeTime(conversation.mtime);
        this.tooltip = conversation.title;
        this.command = {
            command: isGroup
                ? 'issueManager.llmChat.openGroupConversation'
                : 'issueManager.llmChat.openConversation',
            title: '打开对话',
            arguments: [parentId, conversation.uri],
        };
    }
}

export type LLMChatViewNode = ChatRoleNode | ChatGroupNode | ChatConversationNode;

// ─── Provider ────────────────────────────────────────────────

export class LLMChatRoleProvider implements vscode.TreeDataProvider<LLMChatViewNode>, vscode.Disposable {
    private _onDidChangeTreeData = new vscode.EventEmitter<LLMChatViewNode | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private readonly context: vscode.ExtensionContext) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    async getChildren(element?: LLMChatViewNode): Promise<LLMChatViewNode[]> {
        if (!element) {
            const [roles, groups] = await Promise.all([getAllChatRoles(), getAllChatGroups()]);
            return [
                ...groups.map(g => new ChatGroupNode(g)),
                ...roles.map(r => new ChatRoleNode(r)),
            ];
        }
        if (element instanceof ChatRoleNode) {
            const convos = await getConversationsForRole(element.role.id);
            return convos.map(c => new ChatConversationNode(c, element.role.id, false));
        }
        if (element instanceof ChatGroupNode) {
            const convos = await getConversationsForGroup(element.group.id);
            return convos.map(c => new ChatConversationNode(c, element.group.id, true));
        }
        return [];
    }

    getTreeItem(element: LLMChatViewNode): vscode.TreeItem {
        return element;
    }

    dispose(): void {
        this._onDidChangeTreeData.dispose();
    }
}

// ─── 工具函数 ────────────────────────────────────────────────

function formatRelativeTime(mtime: number): string {
    const diff = Date.now() - mtime;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) { return '刚刚'; }
    if (minutes < 60) { return `${minutes} 分钟前`; }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) { return `${hours} 小时前`; }
    const days = Math.floor(hours / 24);
    if (days < 30) { return `${days} 天前`; }
    const d = new Date(mtime);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
