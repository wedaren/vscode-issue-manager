/**
 * LLM 聊天角色树视图提供者
 *
 * 两级树：角色/群组 → 历史对话列表。点击对话打开聊天 Webview。
 * 顶部固定显示「个人助手」专属入口节点。
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { whenCacheReady, onTitleUpdate, isIssueMarkdownFile } from '../data/IssueMarkdowns';
import { getAllChatRoles, getConversationsForRole, getExecutionLogInfo, getPlanInfo, getMemoryInfoForRole, getRecentConversationEntries, getToolCallsForLog, getKnowledgeBaseTree, type ChatToolCallInfo, type KbCategory, type KbSubCategory, type KbArticleInfo } from './llmChatDataManager';
import type { ChatRoleInfo, ChatConversationInfo, ChatExecutionLogInfo, ChatPlanInfo, ChatMemoryInfo, RecentConversationEntry } from './types';
import { RoleTimerManager } from './RoleTimerManager';
import { McpManager, type McpServerStatus, type McpToolDescriptor } from './mcp';
import { ModelRegistry, type ModelDescriptor } from '../llm/ModelRegistry';
import { ModelAuthErrorRegistry } from '../llm/ModelAuthErrorRegistry';
import { PROVIDER_PRESETS } from '../llm/modelProviderPresets';

// ─── 节点类型 ────────────────────────────────────────────────

export class ChatRoleNode extends vscode.TreeItem {
    constructor(public readonly role: ChatRoleInfo, executing = false) {
        super(role.name, vscode.TreeItemCollapsibleState.Collapsed);
        this.id = `role:${role.id}`;
        this.contextValue = 'chatRole';
        this.iconPath = new vscode.ThemeIcon(
            executing ? 'sync~spin' : (role.avatar || 'hubot'),
            executing ? new vscode.ThemeColor('testing.iconPassed') : undefined,
        );
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
        this.contextValue = executing ? 'chatConversationExecuting' : 'chatConversation';
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
        const statusIcon = planInfo.status === 'completed' ? '✓' : planInfo.status === 'abandoned' ? '🚫' : '📋';
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

/** 单个对话条目（最近对话的子节点，不可展开） */
export class RecentConversationItemNode extends vscode.TreeItem {
    constructor(public readonly entry: RecentConversationEntry, executing = false) {
        super(entry.title, vscode.TreeItemCollapsibleState.None);
        this.contextValue = executing ? 'recentConversationItemExecuting' : 'recentConversationItem';

        if (executing) {
            this.iconPath = new vscode.ThemeIcon('sync~spin');
            this.description = `${entry.roleName} · 执行中…`;
        } else {
            this.iconPath = new vscode.ThemeIcon('comment-discussion');
            this.description = `${entry.roleName} · ${formatRelativeTime(entry.latestTimestamp)}`;
        }

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
            + `- 状态: ${status.connected ? '✓ 已连接' : '❌ 未连接'}\n`
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

/** Skills 根节点 */
export class SkillRootNode extends vscode.TreeItem {
    constructor(skillCount: number, vendorCount: number) {
        super('Skills', skillCount > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'skillRoot';
        this.iconPath = new vscode.ThemeIcon('mortar-board');
        this.description = skillCount > 0 ? `${skillCount} 个技能 · ${vendorCount} 组` : '无';
    }
}

/** Skill 供应商分组节点 */
export class SkillVendorNode extends vscode.TreeItem {
    constructor(
        public readonly vendor: string,
        public readonly skills: Array<{ name: string; description: string; filePath: string; source: string }>,
    ) {
        super(vendor, vscode.TreeItemCollapsibleState.Collapsed);
        this.id = `skill-vendor:${vendor}`;
        this.contextValue = 'skillVendor';
        this.iconPath = new vscode.ThemeIcon('package');
        this.description = `${skills.length} 个技能`;
    }
}

/** 单个 Skill 节点 */
export class SkillItemNode extends vscode.TreeItem {
    constructor(public readonly skill: { name: string; description: string; filePath: string; source: string }) {
        super(skill.name, vscode.TreeItemCollapsibleState.None);
        this.id = `skill:${skill.name}`;
        this.contextValue = 'skillItem';
        this.iconPath = new vscode.ThemeIcon('book');
        this.description = skill.description.length > 50
            ? skill.description.slice(0, 47) + '…'
            : skill.description;
        this.tooltip = new vscode.MarkdownString(
            `**${skill.name}**\n\n${skill.description}\n\n`
            + `来源: ${skill.source === 'project' ? '项目级' : '个人级'}\n`
            + `文件: \`${skill.filePath}\``,
        );
        // 不设 command — 点击 label 不触发动作，通过 inline icon 按钮打开
    }
}


// ─── Knowledge Base 节点类型 ─────────────────────────────────

/** 知识库折叠根节点（树顶层固定节点） */
export class KbRootNode extends vscode.TreeItem {
    constructor(wikiCount: number, rawCount: number) {
        super('Knowledge Base', wikiCount + rawCount > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'kbRoot';
        this.iconPath = new vscode.ThemeIcon('library');
        this.description = wikiCount + rawCount > 0
            ? `wiki ${wikiCount} · raw ${rawCount}`
            : '空';
    }
}

/** 知识库顶层分类节点（wiki/ 或 raw/） */
export class KbCategoryNode extends vscode.TreeItem {
    constructor(public readonly category: KbCategory) {
        super(
            `${category.prefix}/`,
            vscode.TreeItemCollapsibleState.Collapsed,
        );
        this.id = `kb-cat:${category.prefix}`;
        this.contextValue = 'kbCategory';
        this.iconPath = new vscode.ThemeIcon(category.prefix === 'wiki' ? 'book' : 'file-text');
        this.description = `${category.totalCount} 篇`;
    }
}

/** 知识库子分类节点（如 concepts/、user/、observations/） */
export class KbSubCategoryNode extends vscode.TreeItem {
    constructor(
        public readonly sub: KbSubCategory,
        public readonly parentPrefix: 'wiki' | 'raw',
    ) {
        super(
            `${sub.name}/`,
            vscode.TreeItemCollapsibleState.Collapsed,
        );
        this.id = `kb-sub:${parentPrefix}/${sub.name}`;
        this.contextValue = 'kbSubCategory';
        this.iconPath = new vscode.ThemeIcon('folder');
        this.description = `${sub.articles.length}`;
    }
}

/** 知识库文章叶子节点 */
export class KbArticleNode extends vscode.TreeItem {
    constructor(
        public readonly article: KbArticleInfo,
        public readonly parentPrefix: 'wiki' | 'raw',
        public readonly parentSub: string,
    ) {
        // 显示名：去掉 "wiki/concepts/" 前缀，只显示最后的标题部分
        const displayName = article.title.replace(new RegExp(`^${parentPrefix}/${parentSub}/`), '');
        super(displayName, vscode.TreeItemCollapsibleState.None);
        this.id = `kb-article:${article.id}`;
        this.contextValue = 'kbArticle';
        this.iconPath = new vscode.ThemeIcon(parentPrefix === 'wiki' ? 'note' : 'file-text');
        this.description = formatRelativeTime(article.mtime);
        this.resourceUri = article.uri;
        this.command = {
            command: 'vscode.open',
            title: '打开知识文章',
            arguments: [article.uri],
        };
    }
}

/** 角色知识库折叠节点（角色内的 wiki/raw 入口） */
export class KbRoleNode extends vscode.TreeItem {
    constructor(
        public readonly roleName: string,
        public readonly categories: KbCategory[],
    ) {
        const total = categories.reduce((sum, c) => sum + c.totalCount, 0);
        super('角色知识', vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'kbRoleRoot';
        this.iconPath = new vscode.ThemeIcon('library');
        this.description = `${total} 篇`;
    }
}

// ─── 模型节点类型 ──────────────────────────────────────────────

/** 模型折叠根节点（树顶层固定节点，列出 Copilot + 自定义模型） */
export class ModelRootNode extends vscode.TreeItem {
    constructor(totalCount: number, customCount: number) {
        super('AI 模型', totalCount > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'modelRoot';
        this.iconPath = new vscode.ThemeIcon('hubot');
        this.description = customCount > 0 ? `${totalCount} 个 · ${customCount} 自定义` : `${totalCount} 个`;
        this.tooltip = new vscode.MarkdownString(
            '**AI 模型**\n\n右键可新增自定义模型\n\n- Copilot 模型：由 GitHub Copilot 扩展提供\n- 自定义模型：OpenAI 兼容 / Ollama 本地模型',
        );
    }
}

/** 单个模型节点（Copilot 或自定义） */
export class ModelItemNode extends vscode.TreeItem {
    constructor(public readonly descriptor: ModelDescriptor, isCurrent: boolean, maskedKey?: string, hasAuthError = false, dashboardUrl?: string) {
        super(descriptor.displayName, vscode.TreeItemCollapsibleState.None);
        this.id = `model:${descriptor.id}`;

        // contextValue 编码：provider + 是否禁用 + 是否自定义（用于 when 条件）
        const isCustom = descriptor.provider !== 'copilot';
        const isDisabled = descriptor.disabled === true;
        this.contextValue = [
            isCustom ? 'modelItemCustom' : 'modelItemCopilot',
            isCurrent ? 'Current' : '',
            isDisabled ? 'Disabled' : 'Enabled',
        ].join('');

        // 图标：认证错误 ⚠️ / 禁用灰色 / 思考模式 / 当前模型绿色
        let iconId: string;
        let iconColor: vscode.ThemeColor | undefined;
        if (hasAuthError) {
            iconId = 'warning';
            iconColor = new vscode.ThemeColor('problemsWarningIcon.foreground');
        } else if (isDisabled) {
            iconId = descriptor.provider === 'copilot' ? 'sparkle' : 'server';
            iconColor = new vscode.ThemeColor('disabledForeground');
        } else if (descriptor.capabilities?.supportsThinking) {
            iconId = 'lightbulb';
            iconColor = isCurrent ? new vscode.ThemeColor('testing.iconPassed') : undefined;
        } else if (descriptor.provider === 'copilot') {
            iconId = 'sparkle';
            iconColor = isCurrent ? new vscode.ThemeColor('testing.iconPassed') : undefined;
        } else {
            iconId = 'server';
            iconColor = isCurrent ? new vscode.ThemeColor('testing.iconPassed') : undefined;
        }
        this.iconPath = new vscode.ThemeIcon(iconId, iconColor);

        // 描述行：认证错误 ⚠️ / 当前使用 · 上下文 · 倍率 · 视觉 · 思考 · 禁用
        const parts: string[] = [];
        if (hasAuthError) {
            parts.push('⚠️ API Key 失效，请右键更新');
        } else if (isDisabled) {
            parts.push('已禁用');
        } else {
            if (isCurrent) { parts.push('当前使用'); }
            if (descriptor.contextWindow) { parts.push(`上下文 ${(descriptor.contextWindow / 1000).toFixed(0)}k`); }
            const mult = descriptor.capabilities?.requestMultiplier;
            if (mult !== undefined) { parts.push(`${mult}x`); }
            if (descriptor.capabilities?.supportsThinking) { parts.push('思考'); }
            if (descriptor.capabilities?.supportsVision) { parts.push('视觉'); }
            if (!descriptor.provider.includes('copilot') && descriptor.endpoint) { parts.push(descriptor.endpoint); }
        }
        this.description = parts.join(' · ') || descriptor.provider;

        // tooltip 详情
        const capLines: string[] = [];
        if (descriptor.capabilities?.supportsTools) { capLines.push('🔧 工具调用'); }
        if (descriptor.capabilities?.supportsVision) { capLines.push('👁 视觉'); }
        if (descriptor.capabilities?.supportsThinking) { capLines.push(`💡 思考模式 (${descriptor.capabilities.thinkingBudget ?? 'medium'})`); }
        const mult = descriptor.capabilities?.requestMultiplier;
        if (mult !== undefined) { capLines.push(`💰 倍率: ${mult}x`); }

        const hint = isDisabled
            ? '\n\n⚠️ 已禁用（右键启用）'
            : hasAuthError
                ? '\n\n🔴 认证失败 — 请右键 → 更新 API Key'
                : isCurrent
                    ? '\n\n✅ 当前全局默认模型'
                    : '\n\n💡 右键设为默认 / 禁用' + (isCustom ? ' / 删除 / 更新 API Key' : '');

        // 自定义模型显示 API Key 状态
        const keyLine = isCustom
            ? `\n- API Key: ${maskedKey ? maskedKey : '⚠️ 未配置（右键 → 更新 API Key）'}`
            : '';
        const dashboardLine = dashboardUrl
            ? `\n- [前往 API 管理后台](${dashboardUrl})`
            : '';

        this.tooltip = new vscode.MarkdownString(
            `**${descriptor.displayName}**\n\n`
            + `- 提供方: ${descriptor.provider}\n`
            + `- ID: \`${descriptor.id}\`\n`
            + (descriptor.contextWindow ? `- 上下文: ${descriptor.contextWindow.toLocaleString()} tokens\n` : '')
            + (descriptor.endpoint ? `- Endpoint: ${descriptor.endpoint}\n` : '')
            + keyLine
            + dashboardLine
            + (capLines.length > 0 ? `\n${capLines.join('\n')}\n` : '')
            + hint,
        );
    }
}

export type LLMChatViewNode = ChatRoleNode | ChatConversationNode | ChatExecutionLogNode | ChatPlanNode | ChatMemoryNode | ChatToolCallNode | RecentConversationRootNode | RecentConversationItemNode | McpRootNode | McpServerNode | McpToolNode | SkillRootNode | SkillVendorNode | SkillItemNode | KbRootNode | KbCategoryNode | KbSubCategoryNode | KbArticleNode | KbRoleNode | ModelRootNode | ModelItemNode;

// ─── Provider ────────────────────────────────────────────────

export class LLMChatRoleProvider implements vscode.TreeDataProvider<LLMChatViewNode>, vscode.Disposable {
    private _onDidChangeTreeData = new vscode.EventEmitter<LLMChatViewNode | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private refreshTimer: ReturnType<typeof setTimeout> | null = null;
    /** 缓存当前有执行中对话的角色 ID 集合，避免在 getChildren 中遍历 */
    private _executingRoleIds = new Set<string>();

    constructor(private readonly context: vscode.ExtensionContext) {
        // 文件新增或标题变更时自动刷新视图
        this.context.subscriptions.push(
            onTitleUpdate(() => this.debouncedRefresh())
        );
        // 执行状态变化时：更新缓存 + 防抖刷新视图
        this.context.subscriptions.push(
            RoleTimerManager.getInstance().onExecutingCountChange(() => {
                this._updateExecutingRoleIds();
                this.debouncedRefresh(150);
            })
        );
        // MCP server 工具变化时刷新视图
        this.context.subscriptions.push(
            McpManager.getInstance().onDidChangeTools(() => this.refresh())
        );
        // LLM 模型配置变更（默认模型、禁用、自定义模型增删）时刷新树视图
        this.context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('issueManager.llm')) {
                    this.debouncedRefresh();
                }
            })
        );
        // 模型认证错误状态变更（401/403 标记 / 清除）时刷新树视图
        this.context.subscriptions.push(
            ModelAuthErrorRegistry.onDidChange(() => this.debouncedRefresh(200))
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
            }),
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
    private debouncedRefresh(ms = 500): void {
        if (this.refreshTimer) { clearTimeout(this.refreshTimer); }
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = null;
            this.refresh();
        }, ms);
    }

    /** 从 executingPaths 反查出哪些角色有执行中对话 */
    private _updateExecutingRoleIds(): void {
        const mgr = RoleTimerManager.getInstance();
        const paths = new Set(mgr.executingPaths);
        this._executingRoleIds.clear();
        if (paths.size === 0) { return; }
        for (const role of getAllChatRoles()) {
            for (const c of getConversationsForRole(role.id)) {
                if (paths.has(c.uri.fsPath)) {
                    this._executingRoleIds.add(role.id);
                    break;
                }
            }
        }
    }

    async getChildren(element?: LLMChatViewNode): Promise<LLMChatViewNode[]> {
        if (!element) {
            // 确保磁盘缓存 + 类型索引就绪后再查询
            await whenCacheReady;
            const roles = getAllChatRoles();

            const nodes: LLMChatViewNode[] = [];

            // 最近对话根节点置顶，便于快速回到最近工作上下文
            nodes.push(new RecentConversationRootNode());

            // MCP Server 根节点
            const mcpManager = McpManager.getInstance();
            const statuses = mcpManager.getServerStatuses();
            const connectedCount = statuses.filter(s => s.connected).length;
            nodes.push(new McpRootNode(statuses.length, connectedCount));

            // Skills 根节点（MCP 下方）
            const { SkillManager } = await import('./SkillManager');
            const skillMgr = SkillManager.getInstance();
            const allSkills = skillMgr.getAllSkills();
            const vendorMap = skillMgr.getVendorGroups();
            nodes.push(new SkillRootNode(allSkills.length, vendorMap.size));

            // 知识库根节点（Skills 下方）
            const kbTree = await getKnowledgeBaseTree();
            const wikiCat = kbTree.find(c => c.prefix === 'wiki');
            const rawCat = kbTree.find(c => c.prefix === 'raw');
            nodes.push(new KbRootNode(wikiCat?.totalCount ?? 0, rawCat?.totalCount ?? 0));

            // 模型根节点（知识库下方）
            const allModels = await ModelRegistry.getAll();
            const customModelCount = allModels.filter(m => m.provider !== 'copilot').length;
            nodes.push(new ModelRootNode(allModels.length, customModelCount));

            nodes.push(...roles.map(r => new ChatRoleNode(r, this._executingRoleIds.has(r.id))));
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
        // ─── Skills 子节点（按 vendor 分组） ────────────────────
        if (element instanceof SkillRootNode) {
            const { SkillManager } = await import('./SkillManager');
            const vendorMap = SkillManager.getInstance().getVendorGroups();
            const nodes: LLMChatViewNode[] = [];
            for (const [vendor, skills] of vendorMap) {
                if (skills.length === 1) {
                    nodes.push(new SkillItemNode(skills[0]));
                } else {
                    nodes.push(new SkillVendorNode(vendor, skills));
                }
            }
            return nodes;
        }
        if (element instanceof SkillVendorNode) {
            return element.skills.map(s => new SkillItemNode(s));
        }
        // ─── Knowledge Base 子节点 ──────────────────────────────
        if (element instanceof KbRootNode) {
            const kbTree = await getKnowledgeBaseTree();
            return kbTree.map(c => new KbCategoryNode(c));
        }
        // ─── 模型子节点 ────────────────────────────────────────
        if (element instanceof ModelRootNode) {
            const allModels = await ModelRegistry.getAll();
            const config = vscode.workspace.getConfiguration('issueManager');
            const currentModelId = config.get<string>('llm.modelFamily') || 'copilot/gpt-5-mini';
            const nodes: ModelItemNode[] = [];
            const copilotModels = allModels.filter(m => m.provider === 'copilot');
            const customModels = allModels.filter(m => m.provider !== 'copilot');
            for (const m of copilotModels) {
                nodes.push(new ModelItemNode(m, !m.disabled && m.id === currentModelId));
            }
            for (const m of customModels) {
                const maskedKey = await ModelRegistry.getApiKeyMasked(m.provider, m.endpoint);
                const hasAuthError = ModelAuthErrorRegistry.hasError(m.id);
                // 按 hostname 匹配服务商预设，获取 API 管理后台链接（避免前缀误匹配）
                const preset = m.endpoint
                    ? PROVIDER_PRESETS.find(p => {
                        if (!p.baseUrl) { return false; }
                        try {
                            return new URL(m.endpoint!).hostname === new URL(p.baseUrl).hostname;
                        } catch { return false; }
                    })
                    : undefined;
                const dashboardUrl = preset?.dashboardUrl;
                nodes.push(new ModelItemNode(m, !m.disabled && m.id === currentModelId, maskedKey, hasAuthError, dashboardUrl));
            }
            return nodes;
        }
        if (element instanceof KbCategoryNode) {
            return element.category.subCategories.map(
                s => new KbSubCategoryNode(s, element.category.prefix),
            );
        }
        if (element instanceof KbSubCategoryNode) {
            return element.sub.articles.map(
                a => new KbArticleNode(a, element.parentPrefix, element.sub.name),
            );
        }
        if (element instanceof KbRoleNode) {
            return element.categories.map(c => new KbCategoryNode(c));
        }
        if (element instanceof RecentConversationRootNode) {
            const conversations = await getRecentConversationEntries(20);
            const mgr = RoleTimerManager.getInstance();
            return conversations.map(c => new RecentConversationItemNode(
                c,
                c.conversationUri ? mgr.isExecuting(c.conversationUri) : false,
            ));
        }
        // RecentConversationItemNode 不再展开子节点
        if (element instanceof ChatRoleNode) {
            const nodes: LLMChatViewNode[] = [];
            // 角色记忆文件（置顶）
            const memInfos = getMemoryInfoForRole(element.role.id);
            nodes.push(...memInfos.map(m => new ChatMemoryNode(m, element.role)));
            // 角色相关知识（wiki/roles/{name} + wiki/user + raw/observations/{name}）
            const roleKb = await getKnowledgeBaseTree(element.role.name);
            const roleKbTotal = roleKb.reduce((sum, c) => sum + c.totalCount, 0);
            if (roleKbTotal > 0) {
                nodes.push(new KbRoleNode(element.role.name, roleKb));
            }
            // 对话列表
            const convos = await getConversationsForRole(element.role.id);
            const mgr = RoleTimerManager.getInstance();
            nodes.push(...convos.map(c => new ChatConversationNode(c, element.role.id, false, mgr.isExecuting(c.uri))));
            return nodes;
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
        if (element instanceof SkillItemNode) {
            return undefined; // 简化：不追溯到 vendor/root
        }
        if (element instanceof SkillVendorNode) {
            return undefined;
        }
        if (element instanceof KbArticleNode) {
            return undefined; // 简化：不追溯到 sub/category/root
        }
        if (element instanceof KbSubCategoryNode) {
            return undefined;
        }
        if (element instanceof KbCategoryNode) {
            return undefined;
        }
        return undefined;
    }

    /** 通过文件 URI 查找对应的树节点（用于 reveal） */
    async findNodeByUri(uri: vscode.Uri): Promise<LLMChatViewNode | undefined> {
        await whenCacheReady;
        const fsPath = uri.fsPath;
        const roles = getAllChatRoles();

        // 角色文件
        const role = roles.find(r => r.uri.fsPath === fsPath);
        if (role) { return new ChatRoleNode(role); }

        // 对话文件
        for (const r of roles) {
            const convo = getConversationsForRole(r.id).find(c => c.uri.fsPath === fsPath);
            if (convo) { return new ChatConversationNode(convo, r.id, false); }
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

        // 计划文件（通过 planId 反查所属对话）
        const fileId = path.basename(fsPath, '.md');
        for (const r of roles) {
            const convo = getConversationsForRole(r.id).find(c => c.planId === fileId);
            if (convo) {
                const planInfo = await getPlanInfo(convo.uri);
                if (planInfo) { return new ChatPlanNode(planInfo, convo, r.id, false); }
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
