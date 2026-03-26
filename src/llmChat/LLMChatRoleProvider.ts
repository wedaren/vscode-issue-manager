/**
 * LLM 聊天角色树视图提供者
 *
 * 两级树：角色/群组 → 历史对话列表。点击对话打开聊天 Webview。
 * 顶部固定显示「个人助手」专属入口节点。
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { whenCacheReady, onTitleUpdate, isIssueMarkdownFile } from '../data/IssueMarkdowns';
import { getAllChatRoles, getConversationsForRole, getAllChatGroups, getConversationsForGroup, getExecutionLogInfo, getRecentActivityEntries, getToolCallsForLog, type ChatToolCallInfo } from './llmChatDataManager';
import type { ChatRoleInfo, ChatConversationInfo, ChatGroupInfo, ChatExecutionLogInfo, RecentActivityEntry } from './types';
import { RoleTimerManager } from './RoleTimerManager';

// ─── 节点类型 ────────────────────────────────────────────────

export class ChatRoleNode extends vscode.TreeItem {
    constructor(public readonly role: ChatRoleInfo) {
        super(role.name, vscode.TreeItemCollapsibleState.Collapsed);
        this.id = `role:${role.id}`;
        this.contextValue = 'chatRole';
        this.iconPath = new vscode.ThemeIcon(role.avatar || 'hubot');
        this.resourceUri = role.uri;

        // 工具集徽章
        const capStr = role.toolSets.length > 0 ? role.toolSets.join('/') : '';

        this.description = capStr || undefined;
        this.tooltip = new vscode.MarkdownString(
            `**${role.name}**${capStr ? `\n\n工具集: ${role.toolSets.join(' · ')}` : ''}\n\n（系统提示词在文件正文中）`,
        );

        // 不设置 command：点击节点展开/折叠对话列表，不切换当前编辑器
        // 打开角色文件可通过右键菜单或内联操作
    }
}

export class ChatGroupNode extends vscode.TreeItem {
    constructor(public readonly group: ChatGroupInfo) {
        super(group.name, vscode.TreeItemCollapsibleState.Collapsed);
        this.id = `group:${group.id}`;
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
        executing = false,
    ) {
        // 有日志时自动展开显示执行日志，否则为叶子节点
        super(
            conversation.title,
            conversation.logId
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None,
        );
        this.id = `convo:${conversation.id}`;
        this.contextValue = 'chatConversation';
        this.resourceUri = conversation.uri;
        this.tooltip = conversation.title;

        if (executing) {
            this.iconPath = new vscode.ThemeIcon('sync~spin');
            this.description = '执行中…';
        } else {
            this.iconPath = new vscode.ThemeIcon('comment-discussion');
            this.description = formatRelativeTime(conversation.mtime);
        }
    }
}

/** 执行日志节点（对话的子节点） */
export class ChatExecutionLogNode extends vscode.TreeItem {
    constructor(
        public readonly logInfo: ChatExecutionLogInfo,
        /** 父对话（供 getParent() 使用） */
        public readonly parentConversation?: ChatConversationInfo,
        public readonly parentRoleOrGroupId?: string,
        public readonly parentIsGroup?: boolean,
    ) {
        super('执行日志', vscode.TreeItemCollapsibleState.Collapsed);
        this.id = `log:${logInfo.id}`;
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

/** 最近活动折叠根节点 */
export class RecentActivityRootNode extends vscode.TreeItem {
    constructor() {
        super('最近活动', vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'recentActivityRoot';
        this.iconPath = new vscode.ThemeIcon('history');
        this.description = undefined;
    }
}

/** 单条最近活动条目 */
export class RecentActivityItemNode extends vscode.TreeItem {
    constructor(public readonly entry: RecentActivityEntry) {
        super(
            `${entry.success ? '✓' : '❌'} Run #${entry.runNumber}`,
            vscode.TreeItemCollapsibleState.None,
        );
        this.contextValue = 'recentActivityItem';
        this.iconPath = new vscode.ThemeIcon(entry.success ? 'pass' : 'error');
        this.description = `${entry.roleName ?? '未知角色'} · ${formatRelativeTime(entry.timestamp)}`;
        this.tooltip = new vscode.MarkdownString(
            `**Run #${entry.runNumber}**\n\n`
            + `- 角色: ${entry.roleName ?? '未知'}\n`
            + `- 模型: ${entry.modelFamily ?? '未知'}\n`
            + `- 触发: ${entry.trigger ?? '未知'}\n`
            + `- 对话: \`${entry.conversationId}\`\n`
            + `- 结果: ${entry.summary}`,
        );
        this.command = {
            command: 'vscode.open',
            title: '打开执行日志',
            arguments: [entry.logUri],
        };
    }
}

/** 工具调用节点（执行日志的子节点） */
export class ChatToolCallNode extends vscode.TreeItem {
    constructor(
        public readonly toolCall: ChatToolCallInfo,
        public readonly parentLogInfo?: ChatExecutionLogInfo,
        public readonly parentConversation?: ChatConversationInfo,
        public readonly parentRoleOrGroupId?: string,
        public readonly parentIsGroup?: boolean,
    ) {
        super(
            `#${toolCall.sequence} ${toolCall.toolName}`,
            vscode.TreeItemCollapsibleState.None,
        );
        this.id = `toolcall:${toolCall.id}`;
        this.contextValue = 'chatToolCall';
        const durLabel = toolCall.duration >= 1000
            ? `${(toolCall.duration / 1000).toFixed(1)}s`
            : `${toolCall.duration}ms`;
        this.iconPath = new vscode.ThemeIcon(toolCall.success ? 'pass' : 'error');
        this.description = `Run #${toolCall.runNumber} · ${durLabel}`;
        this.resourceUri = toolCall.uri;
    }
}

export type LLMChatViewNode = ChatRoleNode | ChatGroupNode | ChatConversationNode | ChatExecutionLogNode | ChatToolCallNode | RecentActivityRootNode | RecentActivityItemNode;

// ─── Provider ────────────────────────────────────────────────

export class LLMChatRoleProvider implements vscode.TreeDataProvider<LLMChatViewNode>, vscode.Disposable {
    private _onDidChangeTreeData = new vscode.EventEmitter<LLMChatViewNode | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private refreshTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly context: vscode.ExtensionContext) {
        // 文件新增或标题变更时自动刷新视图
        this.context.subscriptions.push(
            onTitleUpdate(() => this.debouncedRefresh())
        );
        // 执行状态变化时刷新视图（更新对话节点的执行中图标）
        this.context.subscriptions.push(
            RoleTimerManager.getInstance().onExecutingCountChange(() => this.refresh())
        );
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * 绑定 TreeView 实例，注册选中自动预览。
     * 点击节点时自然展开/折叠（因为没有 command），
     * 同时通过 onDidChangeSelection 打开对应文件（preserveFocus 不抢焦点）。
     */
    bindTreeView(treeView: vscode.TreeView<LLMChatViewNode>): void {
        // 选中节点 → 预览对应文件（不抢焦点）
        this.context.subscriptions.push(
            treeView.onDidChangeSelection(e => {
                const node = e.selection[0];
                if (!node) { return; }
                let uri: vscode.Uri | undefined;
                if (node instanceof ChatRoleNode) { uri = node.role.uri; }
                else if (node instanceof ChatConversationNode) { uri = node.conversation.uri; }
                else if (node instanceof ChatExecutionLogNode) { uri = node.logInfo.uri; }
                else if (node instanceof ChatToolCallNode) { uri = node.toolCall.uri; }
                else if (node instanceof RecentActivityItemNode) { uri = node.entry.logUri; }
                if (uri) {
                    // 文件已是当前活动编辑器时跳过，避免 reveal 回路
                    const activeUri = vscode.window.activeTextEditor?.document.uri;
                    if (activeUri?.fsPath === uri.fsPath) { return; }
                    void vscode.commands.executeCommand('vscode.open', uri, { preserveFocus: true, preview: true });
                }
            })
        );

        // 编辑器切换 → 自动在树视图中定位对应节点（仅视图可见时）
        this.context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(async editor => {
                if (!editor || !treeView.visible) { return; }
                if (!isIssueMarkdownFile(editor.document.uri)) { return; }
                try {
                    const node = await this.findNodeByUri(editor.document.uri);
                    if (node) {
                        await treeView.reveal(node, { select: true, focus: false, expand: true });
                    }
                } catch { /* 节点不在树中，忽略 */ }
            })
        );
    }

    /** 防抖刷新，合并短时间内的多次缓存更新事件 */
    private debouncedRefresh(): void {
        if (this.refreshTimer) { clearTimeout(this.refreshTimer); }
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = null;
            this.refresh();
        }, 500);
    }

    async getChildren(element?: LLMChatViewNode): Promise<LLMChatViewNode[]> {
        if (!element) {
            // 确保磁盘缓存 + 类型索引就绪后再查询
            await whenCacheReady;
            const [roles, groups] = [getAllChatRoles(), getAllChatGroups()];

            const nodes: LLMChatViewNode[] = [];
            // 最近活动放在最顶部
            nodes.push(new RecentActivityRootNode());
            nodes.push(...groups.map(g => new ChatGroupNode(g)));
            nodes.push(...roles.map(r => new ChatRoleNode(r)));
            return nodes;
        }
        if (element instanceof RecentActivityRootNode) {
            const entries = await getRecentActivityEntries(30);
            return entries.map(e => new RecentActivityItemNode(e));
        }
        if (element instanceof ChatRoleNode) {
            const convos = await getConversationsForRole(element.role.id);
            const mgr = RoleTimerManager.getInstance();
            return convos.map(c => new ChatConversationNode(c, element.role.id, false, mgr.isExecuting(c.uri)));
        }
        if (element instanceof ChatGroupNode) {
            const convos = await getConversationsForGroup(element.group.id);
            const mgr = RoleTimerManager.getInstance();
            return convos.map(c => new ChatConversationNode(c, element.group.id, true, mgr.isExecuting(c.uri)));
        }
        if (element instanceof ChatConversationNode) {
            const logInfo = await getExecutionLogInfo(element.conversation.uri);
            if (logInfo) {
                return [new ChatExecutionLogNode(logInfo, element.conversation, element.parentId, element.isGroup)];
            }
            return [];
        }
        if (element instanceof ChatExecutionLogNode) {
            const toolCalls = getToolCallsForLog(element.logInfo.id);
            return toolCalls.map(tc => new ChatToolCallNode(
                tc, element.logInfo, element.parentConversation,
                element.parentRoleOrGroupId, element.parentIsGroup,
            ));
        }
        return [];
    }

    getTreeItem(element: LLMChatViewNode): vscode.TreeItem {
        return element;
    }

    /** 供 treeView.reveal() 使用，返回节点的逻辑父节点 */
    getParent(element: LLMChatViewNode): LLMChatViewNode | undefined {
        if (element instanceof ChatConversationNode) {
            if (element.isGroup) {
                const group = getAllChatGroups().find(g => g.id === element.parentId);
                return group ? new ChatGroupNode(group) : undefined;
            }
            const role = getAllChatRoles().find(r => r.id === element.parentId);
            return role ? new ChatRoleNode(role) : undefined;
        }
        if (element instanceof ChatExecutionLogNode) {
            if (element.parentConversation && element.parentRoleOrGroupId !== undefined) {
                return new ChatConversationNode(element.parentConversation, element.parentRoleOrGroupId, element.parentIsGroup ?? false);
            }
        }
        if (element instanceof ChatToolCallNode) {
            if (element.parentLogInfo) {
                return new ChatExecutionLogNode(
                    element.parentLogInfo, element.parentConversation,
                    element.parentRoleOrGroupId, element.parentIsGroup,
                );
            }
        }
        if (element instanceof RecentActivityItemNode) {
            return new RecentActivityRootNode();
        }
        return undefined;
    }

    /** 通过文件 URI 查找对应的树节点（用于 reveal） */
    async findNodeByUri(uri: vscode.Uri): Promise<LLMChatViewNode | undefined> {
        await whenCacheReady;
        const fsPath = uri.fsPath;
        const roles = getAllChatRoles();
        const groups = getAllChatGroups();

        // 角色文件
        const role = roles.find(r => r.uri.fsPath === fsPath);
        if (role) { return new ChatRoleNode(role); }

        // 群组文件
        const group = groups.find(g => g.uri.fsPath === fsPath);
        if (group) { return new ChatGroupNode(group); }

        // 角色对话文件
        for (const r of roles) {
            const convo = getConversationsForRole(r.id).find(c => c.uri.fsPath === fsPath);
            if (convo) { return new ChatConversationNode(convo, r.id, false); }
        }

        // 群组对话文件
        for (const g of groups) {
            const convo = getConversationsForGroup(g.id).find(c => c.uri.fsPath === fsPath);
            if (convo) { return new ChatConversationNode(convo, g.id, true); }
        }

        // 执行日志文件（通过 logId 反查所属对话）
        const logId = path.basename(fsPath, '.md');
        for (const r of roles) {
            const convo = getConversationsForRole(r.id).find(c => c.logId === logId);
            if (convo) {
                const logInfo = await getExecutionLogInfo(convo.uri);
                if (logInfo) { return new ChatExecutionLogNode(logInfo, convo, r.id, false); }
            }
        }
        for (const g of groups) {
            const convo = getConversationsForGroup(g.id).find(c => c.logId === logId);
            if (convo) {
                const logInfo = await getExecutionLogInfo(convo.uri);
                if (logInfo) { return new ChatExecutionLogNode(logInfo, convo, g.id, true); }
            }
        }

        return undefined;
    }

    dispose(): void {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
        }
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
