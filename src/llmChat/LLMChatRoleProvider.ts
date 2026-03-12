/**
 * LLM 聊天角色树视图提供者
 *
 * 两级树：角色/群组 → 历史对话列表。点击对话打开聊天 Webview。
 * 顶部固定显示「个人助手」专属入口节点。
 */
import * as vscode from 'vscode';
import { whenCacheReady } from '../data/IssueMarkdowns';
import { getAllChatRoles, getConversationsForRole, getAllChatGroups, getConversationsForGroup, getExecutionLogInfo } from './llmChatDataManager';
import type { ChatRoleInfo, ChatConversationInfo, ChatGroupInfo, ChatExecutionLogInfo } from './types';

// ─── 节点类型 ────────────────────────────────────────────────

export class ChatRoleNode extends vscode.TreeItem {
    constructor(public readonly role: ChatRoleInfo) {
        super(role.name, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'chatRole';
        this.iconPath = new vscode.ThemeIcon(role.avatar || 'hubot');

        // 工具集徽章
        const capStr = role.toolSets.length > 0 ? role.toolSets.join('/') : '';

        this.description = capStr || undefined;
        this.tooltip = new vscode.MarkdownString(
            `**${role.name}**${capStr ? `\n\n工具集: ${role.toolSets.join(' · ')}` : ''}\n\n（系统提示词在文件正文中）`,
        );

        // 点击打开角色文件（编辑 system prompt）
        this.command = {
            command: 'vscode.open',
            title: '打开角色',
            arguments: [role.uri],
        };
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
        // 有日志时可展开，否则为叶子节点
        super(
            conversation.title,
            conversation.logId
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None,
        );
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

/** 执行日志节点（对话的子节点） */
export class ChatExecutionLogNode extends vscode.TreeItem {
    constructor(public readonly logInfo: ChatExecutionLogInfo) {
        super('执行日志', vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'chatExecutionLog';
        this.iconPath = new vscode.ThemeIcon('output');
        this.description = `${logInfo.totalRuns} 次执行 · ${logInfo.successCount}✓ ${logInfo.failureCount}✗`;
        this.tooltip = new vscode.MarkdownString(
            `**执行日志**\n\n`
            + `- 总执行: ${logInfo.totalRuns} 次\n`
            + `- 成功: ${logInfo.successCount} 次\n`
            + `- 失败: ${logInfo.failureCount} 次\n\n`
            + `点击打开日志文件查看详情`,
        );
        this.command = {
            command: 'vscode.open',
            title: '打开执行日志',
            arguments: [logInfo.uri],
        };
    }
}

export type LLMChatViewNode = ChatRoleNode | ChatGroupNode | ChatConversationNode | ChatExecutionLogNode;

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
            // 确保磁盘缓存 + 类型索引就绪后再查询
            await whenCacheReady;
            const [roles, groups] = [getAllChatRoles(), getAllChatGroups()];

            const nodes: LLMChatViewNode[] = [];
            nodes.push(...groups.map(g => new ChatGroupNode(g)));
            nodes.push(...roles.map(r => new ChatRoleNode(r)));
            return nodes;
        }
        if (element instanceof ChatRoleNode) {
            const convos = await getConversationsForRole(element.role.id);
            return convos.map(c => new ChatConversationNode(c, element.role.id, false));
        }
        if (element instanceof ChatGroupNode) {
            const convos = await getConversationsForGroup(element.group.id);
            return convos.map(c => new ChatConversationNode(c, element.group.id, true));
        }
        if (element instanceof ChatConversationNode) {
            const logInfo = await getExecutionLogInfo(element.conversation.uri);
            if (logInfo) {
                return [new ChatExecutionLogNode(logInfo)];
            }
            return [];
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
