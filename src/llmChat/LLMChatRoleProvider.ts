/**
 * LLM 聊天角色树视图提供者
 *
 * 两级树：角色/群组 → 历史对话列表。点击对话打开聊天 Webview。
 * 顶部固定显示「个人助手」专属入口节点。
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { whenCacheReady, onTitleUpdate, isIssueMarkdownFile } from '../data/IssueMarkdowns';
import { getAllChatRoles, getConversationsForRole, getAllChatGroups, getConversationsForGroup, getExecutionLogInfo, getPlanInfo, getMemoryInfoForRole, getRecentConversationEntries, getToolCallsForLog, type ChatToolCallInfo } from './llmChatDataManager';
import type { ChatRoleInfo, ChatConversationInfo, ChatGroupInfo, ChatExecutionLogInfo, ChatPlanInfo, ChatMemoryInfo, RecentActivityEntry, RecentConversationEntry } from './types';
import { RoleTimerManager } from './RoleTimerManager';
import { McpManager, type McpServerStatus, type McpToolDescriptor } from './mcp';

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

        // label 点击 → 展开 + 预览文件（不折叠）；只有 arrow 才折叠
        this.command = { command: 'issueManager.llmChat.nodeExpandAndOpen', title: '展开', arguments: [role.uri] };
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

        this.command = { command: 'issueManager.llmChat.nodeExpandAndOpen', title: '展开' };
    }
}

export class ChatConversationNode extends vscode.TreeItem {
    constructor(
        public readonly conversation: ChatConversationInfo,
        public readonly parentId: string,
        public readonly isGroup: boolean,
        executing = false,
    ) {
        // 有日志或计划时自动展开，否则为叶子节点
        super(
            conversation.title,
            (conversation.logId || conversation.planId)
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

        // label 点击 → 展开 + 预览文件（不折叠）
        this.command = { command: 'issueManager.llmChat.nodeExpandAndOpen', title: '展开', arguments: [conversation.uri] };
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

/** 执行计划节点（对话的子节点） */
export class ChatPlanNode extends vscode.TreeItem {
    constructor(
        public readonly planInfo: ChatPlanInfo,
        public readonly parentConversation?: ChatConversationInfo,
        public readonly parentRoleOrGroupId?: string,
        public readonly parentIsGroup?: boolean,
    ) {
        super(planInfo.title, vscode.TreeItemCollapsibleState.None);
        this.id = `plan:${planInfo.id}`;
        this.contextValue = 'chatPlan';
        const statusIcon = planInfo.status === 'completed' ? '✅' : planInfo.status === 'abandoned' ? '🚫' : '📋';
        this.iconPath = new vscode.ThemeIcon(
            planInfo.status === 'completed' ? 'pass-filled'
                : planInfo.status === 'abandoned' ? 'circle-slash'
                    : 'tasklist',
        );
        this.description = `${statusIcon} ${planInfo.doneSteps}/${planInfo.totalSteps} 步`;
        this.tooltip = new vscode.MarkdownString(
            `**${planInfo.title}**\n\n`
            + `- 状态: ${planInfo.status === 'completed' ? '已完成' : planInfo.status === 'abandoned' ? '已放弃' : '进行中'}\n`
            + `- 进度: ${planInfo.doneSteps}/${planInfo.totalSteps} 步\n\n`
            + `点击打开计划文件`,
        );
        this.command = {
            command: 'vscode.open',
            title: '打开执行计划',
            arguments: [planInfo.uri],
        };
    }
}

/** 角色记忆节点（角色的子节点） */
export class ChatMemoryNode extends vscode.TreeItem {
    constructor(
        public readonly memoryInfo: ChatMemoryInfo,
        public readonly parentRole?: ChatRoleInfo,
    ) {
        super(
            memoryInfo.type === 'role_memory' ? '角色记忆' : '自动记忆',
            vscode.TreeItemCollapsibleState.None,
        );
        this.id = `memory:${memoryInfo.id}`;
        this.contextValue = memoryInfo.type === 'role_memory' ? 'chatMemory' : 'chatAutoMemory';
        this.iconPath = new vscode.ThemeIcon(
            memoryInfo.type === 'role_memory' ? 'notebook' : 'lightbulb-autofix',
        );
        this.description = memoryInfo.summary;
        this.tooltip = new vscode.MarkdownString(
            memoryInfo.type === 'role_memory'
                ? '**角色记忆**\n\nLLM 主动管理的知识积累，点击查看/编辑'
                : '**自动记忆**\n\n系统自动从对话中提取的要点，点击查看',
        );
        this.command = {
            command: 'vscode.open',
            title: '打开记忆文件',
            arguments: [memoryInfo.uri],
        };
    }
}

/** 最近对话折叠根节点 */
export class RecentConversationRootNode extends vscode.TreeItem {
    constructor() {
        super('最近对话', vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'recentConversationRoot';
        this.iconPath = new vscode.ThemeIcon('history');
        this.description = undefined;
    }
}

/** 单个对话条目（最近对话的子节点，可展开显示 Run 列表） */
export class RecentConversationItemNode extends vscode.TreeItem {
    constructor(public readonly entry: RecentConversationEntry) {
        super(
            entry.title,
            entry.runs.length > 0
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None,
        );
        this.contextValue = 'recentConversationItem';
        this.iconPath = new vscode.ThemeIcon('comment-discussion');
        this.description = `${entry.roleName} · ${entry.runs.length} 次执行 · ${formatRelativeTime(entry.latestTimestamp)}`;
        this.tooltip = new vscode.MarkdownString(
            `**${entry.title}**\n\n`
            + `- 角色: ${entry.roleName}\n`
            + `- 执行次数: ${entry.runs.length}\n`
            + `- 最近执行: ${formatRelativeTime(entry.latestTimestamp)}`,
        );
        if (entry.conversationUri) {
            this.command = {
                command: 'vscode.open',
                title: '打开对话',
                arguments: [entry.conversationUri],
            };
        }
    }
}

/** 单次 Run 条目（对话的子节点） */
export class RecentRunItemNode extends vscode.TreeItem {
    constructor(
        public readonly run: RecentActivityEntry,
        public readonly parentConversation: RecentConversationEntry,
    ) {
        super(
            `${run.success ? '✓' : '❌'} Run #${run.runNumber}`,
            vscode.TreeItemCollapsibleState.None,
        );
        this.contextValue = 'recentRunItem';
        this.iconPath = new vscode.ThemeIcon(run.success ? 'pass' : 'error');
        this.description = `${run.modelFamily ?? '未知模型'} · ${formatRelativeTime(run.timestamp)}`;
        this.tooltip = new vscode.MarkdownString(
            `**Run #${run.runNumber}**\n\n`
            + `- 角色: ${run.roleName ?? '未知'}\n`
            + `- 模型: ${run.modelFamily ?? '未知'}\n`
            + `- 触发: ${run.trigger ?? '未知'}\n`
            + `- 结果: ${run.summary}`,
        );
        this.command = {
            command: 'vscode.open',
            title: '打开执行日志',
            arguments: [run.logUri],
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
        this.command = { command: 'vscode.open', title: '打开工具调用详情', arguments: [toolCall.uri] };
    }
}

// ─── MCP 节点类型 ─────────────────────────────────────────────

/** MCP Server 折叠根节点（树顶层固定节点） */
export class McpRootNode extends vscode.TreeItem {
    constructor(serverCount: number, connectedCount: number) {
        // 无 server 时展开（引导添加），有 server 时折叠
        super('MCP Server', serverCount > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'mcpRoot';
        this.iconPath = new vscode.ThemeIcon('server-environment');
        this.description = serverCount > 0 ? `${connectedCount}/${serverCount} 已连接` : '点击 + 添加';
    }
}

/** 单个 MCP Server 节点 */
export class McpServerNode extends vscode.TreeItem {
    constructor(public readonly status: McpServerStatus) {
        super(status.name, status.connected
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None);
        this.id = `mcp-server:${status.name}`;
        this.contextValue = status.connected ? 'mcpServerConnected' : 'mcpServerDisconnected';
        this.iconPath = new vscode.ThemeIcon(
            status.connected ? 'plug' : 'debug-disconnect',
            status.connected
                ? new vscode.ThemeColor('testing.iconPassed')
                : status.error
                    ? new vscode.ThemeColor('testing.iconFailed')
                    : new vscode.ThemeColor('disabledForeground'),
        );
        if (status.connected) {
            this.description = `${status.toolCount} 个工具`;
        } else {
            const shortError = status.error
                ? (status.error.length > 40 ? status.error.slice(0, 37) + '…' : status.error)
                : '未连接';
            this.description = shortError;
            // 未连接时点击触发重启
            this.command = {
                command: 'issueManager.mcp.restartServer',
                title: '重启',
                arguments: [this],
            };
        }
        this.tooltip = new vscode.MarkdownString(
            `**${status.name}**\n\n`
            + `- 状态: ${status.connected ? '✅ 已连接' : '❌ 未连接'}\n`
            + `- 工具数: ${status.toolCount}\n`
            + (status.error ? `\n**错误详情:**\n\`\`\`\n${status.error}\n\`\`\`\n` : '')
            + (status.connected ? '' : '\n💡 点击节点重启，右键更多操作'),
        );
    }
}

/** MCP 工具节点（Server 的子节点） */
export class McpToolNode extends vscode.TreeItem {
    constructor(
        public readonly tool: McpToolDescriptor,
        public readonly serverName: string,
    ) {
        super(tool.originalName, vscode.TreeItemCollapsibleState.None);
        this.id = `mcp-tool:${tool.name}`;
        this.contextValue = 'mcpTool';
        this.iconPath = new vscode.ThemeIcon('wrench');
        this.description = tool.description.length > 60
            ? tool.description.slice(0, 57) + '…'
            : tool.description;
        this.tooltip = new vscode.MarkdownString(
            `**${tool.originalName}**\n\n${tool.description}\n\n`
            + `完整名称: \`${tool.name}\``,
        );
    }
}

export type LLMChatViewNode = ChatRoleNode | ChatGroupNode | ChatConversationNode | ChatExecutionLogNode | ChatPlanNode | ChatMemoryNode | ChatToolCallNode | RecentConversationRootNode | RecentConversationItemNode | RecentRunItemNode | McpRootNode | McpServerNode | McpToolNode;

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
        // MCP server 工具变化时刷新视图
        this.context.subscriptions.push(
            McpManager.getInstance().onDidChangeTools(() => this.refresh())
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
        // label 点击 → 展开节点 + 预览文件（不折叠，只有 arrow 折叠）
        // 所有可展开节点（Role/Group/Conversation）通过此命令统一处理
        this.context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.llmChat.nodeExpandAndOpen', (uri?: vscode.Uri) => {
                if (uri) {
                    void vscode.commands.executeCommand('vscode.open', uri, { preserveFocus: true, preview: true });
                }
                void vscode.commands.executeCommand('list.expand');
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

            // MCP Server 根节点（最顶部）
            const mcpManager = McpManager.getInstance();
            const statuses = mcpManager.getServerStatuses();
            const connectedCount = statuses.filter(s => s.connected).length;
            nodes.push(new McpRootNode(statuses.length, connectedCount));

            // 最近对话
            nodes.push(new RecentConversationRootNode());
            nodes.push(...groups.map(g => new ChatGroupNode(g)));
            nodes.push(...roles.map(r => new ChatRoleNode(r)));
            return nodes;
        }
        // ─── MCP 子节点 ──────────────────────────────────────
        if (element instanceof McpRootNode) {
            const mcpManager = McpManager.getInstance();
            const statuses = mcpManager.getServerStatuses();
            if (statuses.length === 0) { return []; }
            return statuses.map(s => new McpServerNode(s));
        }
        if (element instanceof McpServerNode) {
            if (!element.status.connected) { return []; }
            const mcpManager = McpManager.getInstance();
            const tools = mcpManager.getServersWithTools().get(element.status.name) || [];
            return tools.map(t => new McpToolNode(t, element.status.name));
        }
        if (element instanceof RecentConversationRootNode) {
            const conversations = await getRecentConversationEntries(20);
            return conversations.map(c => new RecentConversationItemNode(c));
        }
        if (element instanceof RecentConversationItemNode) {
            return element.entry.runs.map(r => new RecentRunItemNode(r, element.entry));
        }
        if (element instanceof ChatRoleNode) {
            const nodes: LLMChatViewNode[] = [];
            // 角色记忆文件（置顶）
            const memInfos = getMemoryInfoForRole(element.role.id);
            nodes.push(...memInfos.map(m => new ChatMemoryNode(m, element.role)));
            // 对话列表
            const convos = await getConversationsForRole(element.role.id);
            const mgr = RoleTimerManager.getInstance();
            nodes.push(...convos.map(c => new ChatConversationNode(c, element.role.id, false, mgr.isExecuting(c.uri))));
            return nodes;
        }
        if (element instanceof ChatGroupNode) {
            const convos = await getConversationsForGroup(element.group.id);
            const mgr = RoleTimerManager.getInstance();
            return convos.map(c => new ChatConversationNode(c, element.group.id, true, mgr.isExecuting(c.uri)));
        }
        if (element instanceof ChatConversationNode) {
            const nodes: LLMChatViewNode[] = [];
            // 执行计划
            const planInfo = await getPlanInfo(element.conversation.uri);
            if (planInfo) {
                nodes.push(new ChatPlanNode(planInfo, element.conversation, element.parentId, element.isGroup));
            }
            // 执行日志
            const logInfo = await getExecutionLogInfo(element.conversation.uri);
            if (logInfo) {
                nodes.push(new ChatExecutionLogNode(logInfo, element.conversation, element.parentId, element.isGroup));
            }
            return nodes;
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
        if (element instanceof ChatPlanNode) {
            if (element.parentConversation && element.parentRoleOrGroupId !== undefined) {
                return new ChatConversationNode(element.parentConversation, element.parentRoleOrGroupId, element.parentIsGroup ?? false);
            }
        }
        if (element instanceof ChatMemoryNode) {
            if (element.parentRole) {
                return new ChatRoleNode(element.parentRole);
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
        if (element instanceof RecentRunItemNode) {
            return new RecentConversationItemNode(element.parentConversation);
        }
        if (element instanceof RecentConversationItemNode) {
            return new RecentConversationRootNode();
        }
        if (element instanceof McpToolNode) {
            const statuses = McpManager.getInstance().getServerStatuses();
            const status = statuses.find(s => s.name === element.serverName);
            return status ? new McpServerNode(status) : undefined;
        }
        if (element instanceof McpServerNode) {
            const statuses = McpManager.getInstance().getServerStatuses();
            const connectedCount = statuses.filter(s => s.connected).length;
            return new McpRootNode(statuses.length, connectedCount);
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

        // 计划文件（通过 planId 反查所属对话）
        const fileId = path.basename(fsPath, '.md');
        for (const r of roles) {
            const convo = getConversationsForRole(r.id).find(c => c.planId === fileId);
            if (convo) {
                const planInfo = await getPlanInfo(convo.uri);
                if (planInfo) { return new ChatPlanNode(planInfo, convo, r.id, false); }
            }
        }
        for (const g of groups) {
            const convo = getConversationsForGroup(g.id).find(c => c.planId === fileId);
            if (convo) {
                const planInfo = await getPlanInfo(convo.uri);
                if (planInfo) { return new ChatPlanNode(planInfo, convo, g.id, true); }
            }
        }

        // 记忆文件（通过 memoryInfo 反查所属角色）
        for (const r of roles) {
            const memInfos = getMemoryInfoForRole(r.id);
            const mem = memInfos.find(m => m.uri.fsPath === fsPath);
            if (mem) { return new ChatMemoryNode(mem, r); }
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
