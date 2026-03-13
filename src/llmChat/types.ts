/**
 * LLM 聊天模块类型定义
 */

/** 聊天角色的 frontmatter 扩展字段 */
export interface ChatRoleFrontmatter {
    /** 标记为聊天角色文件 */
    chat_role: true;
    /** 角色显示名称 */
    chat_role_name: string;
    /** 角色图标（ThemeIcon 名称） */
    chat_role_avatar?: string;
    /** @deprecated 系统提示词已迁移至 markdown body，此字段仅用于向后兼容读取旧文件 */
    chat_role_system_prompt?: string;
    /** 指定模型 family（可选，覆盖全局配置） */
    chat_role_model_family?: string;
    // ─── 定时器配置 ───────────────────────────────────────────
    /** 是否启用定时器自动处理对话，默认 false */
    timer_enabled?: boolean;
    /** 定时器轮询间隔（ms），默认 30000 */
    timer_interval?: number;
    /** 同一角色最多并发处理的对话数，默认 2 */
    timer_max_concurrent?: number;
    /** 单次 LLM 请求超时（ms），默认 60000 */
    timer_timeout?: number;
    /** 最大重试次数，默认 3 */
    timer_max_retries?: number;
    /** 初始重试间隔（ms），指数退避，默认 5000 */
    timer_retry_delay?: number;
    /** 角色级 LLM 请求最大 token 预算（可选） */
    chat_role_max_tokens?: number;
    // ─── 工具集配置 ───────────────────────────────────────────
    /**
     * 内置工具包列表，合法值：
     * "memory" | "delegation" | "role_management" | "browser"
     */
    tool_sets?: string[];
    /** 允许使用的 MCP server 名称列表（取其全部工具）；"*" 表示引入所有已注册的 MCP 工具 */
    mcp_servers?: string[];
    /** 额外引入的具体工具名称列表（来自任何 MCP server） */
    extra_tools?: string[];
    /** 排除的具体工具名称列表 */
    excluded_tools?: string[];
}

// ─── 角色记忆相关 ─────────────────────────────────────────────

/** 角色记忆文件的 frontmatter */
export interface RoleMemoryFrontmatter {
    /** 标记为角色记忆文件 */
    role_memory: true;
    /** 关联的角色 ID */
    role_memory_owner_id: string;
}

/** 聊天消息 */
export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}

/** 聊天对话的 frontmatter 扩展字段 */
export interface ChatConversationFrontmatter {
    /** 标记为聊天对话文件 */
    chat_conversation: true;
    /** 关联的角色文件 ID（不含扩展名的文件名） */
    chat_role_id: string;
    /** 对话标题（可选，自动生成或手动设置） */
    chat_title?: string;
    /** 对话级模型 family（可选，覆盖角色配置） */
    chat_model_family?: string;
    /** 对话级 LLM 请求最大 token 预算（可选，覆盖角色配置） */
    chat_max_tokens?: number;
    /** 当前对话已消耗的估算 token 数（请求前后自动更新） */
    chat_token_used?: number;
    /** token 使用量占 max_tokens 的百分比（有 max_tokens 时自动更新） */
    chat_token_used_pct?: number;
    /** 关联的执行日志文件 ID（首次执行时自动创建） */
    chat_log_id?: string;
    /**
     * 对话级自主模式（覆盖角色配置）：true = 自主决策，false = 交互确认。
     * 优先级：对话 > 角色 > 触发方式自动推断。
     */
    chat_autonomous?: boolean;
}

/** 运行时聊天角色信息（从 issueMarkdown 解析而来） */
export interface ChatRoleInfo {
    /** 角色文件的 issue ID（文件名去掉 .md） */
    id: string;
    /** 角色显示名称 */
    name: string;
    /** 角色图标 */
    avatar: string;
    /** 系统提示词（懒加载，列表查询时为 undefined；使用 getRoleSystemPrompt() 按需读取） */
    systemPrompt?: string;
    /** 指定模型 family */
    modelFamily?: string;
    /** 文件 URI */
    uri: import('vscode').Uri;
    /** 角色描述（来自 markdown body 的第一段） */
    description?: string;
    // ─── 定时器配置（运行时） ────────────────────────────────
    timerEnabled?: boolean;
    timerInterval?: number;
    timerMaxConcurrent?: number;
    timerTimeout?: number;
    timerMaxRetries?: number;
    timerRetryDelay?: number;
    /** 角色级最大 token 预算 */
    maxTokens?: number;
    // ─── 工具集配置（运行时） ────────────────────────────────
    /** 内置工具包名称列表，如 ["memory", "delegation", "web"] */
    toolSets: string[];
    /** 允许使用的 MCP server 名称列表；"*" 表示引入所有已注册的 MCP 工具 */
    mcpServers?: string[];
    /** 额外引入的具体工具名称列表 */
    extraTools?: string[];
    /** 排除的具体工具名称列表 */
    excludedTools?: string[];
}

/** 运行时对话信息 */
export interface ChatConversationInfo {
    /** 对话文件的 issue ID */
    id: string;
    /** 关联的角色 ID */
    roleId: string;
    /** 对话标题 */
    title: string;
    /** 文件 URI */
    uri: import('vscode').Uri;
    /** 最后修改时间 */
    mtime: number;
    /** 对话级模型 family（覆盖角色配置） */
    modelFamily?: string;
    /** 对话级最大 token 预算 */
    maxTokens?: number;
    /** 已消耗的估算 token 数 */
    tokenUsed?: number;
    /** 关联的执行日志 ID */
    logId?: string;
    /** 对话级自主模式 */
    autonomous?: boolean;
}

// ─── 群组相关 ───────────────────────────────────────────────

/** 群组的 frontmatter 扩展字段 */
export interface ChatGroupFrontmatter {
    /** 标记为群组文件 */
    chat_group: true;
    /** 群组名称 */
    chat_group_name: string;
    /** 群组成员（角色 ID 列表） */
    chat_group_members: string[];
    /** 群组图标 */
    chat_group_avatar?: string;
}

/** 群组对话的 frontmatter 扩展字段 */
export interface ChatGroupConversationFrontmatter {
    /** 标记为群组对话文件 */
    chat_group_conversation: true;
    /** 关联的群组 ID */
    chat_group_id: string;
    /** 对话标题 */
    chat_title?: string;
}

/** 运行时群组信息 */
export interface ChatGroupInfo {
    id: string;
    name: string;
    avatar: string;
    /** 成员角色 ID 列表 */
    memberIds: string[];
    uri: import('vscode').Uri;
}

/** 群组对话中的消息，assistant 消息额外携带角色名称 */
export interface ChatGroupMessage {
    role: 'user' | 'assistant';
    /** assistant 消息对应的角色名称 */
    roleName?: string;
    content: string;
    timestamp: number;
}

// ─── 最近活动（聚合视图） ─────────────────────────────────────

/** 从多个执行日志聚合出的单次 Run 条目 */
export interface RecentActivityEntry {
    /** Run 编号 */
    runNumber: number;
    /** 执行开始时间戳 */
    timestamp: number;
    /** 关联的对话 ID */
    conversationId: string;
    /** 日志文件 URI */
    logUri: import('vscode').Uri;
    /** 角色名称 */
    roleName?: string;
    /** 模型 */
    modelFamily?: string;
    /** 触发方式 */
    trigger?: string;
    /** 是否成功 */
    success: boolean;
    /** 摘要（一行描述） */
    summary: string;
}

// ─── 执行日志 ───────────────────────────────────────────────

/** 执行日志文件的 frontmatter */
export interface ChatExecutionLogFrontmatter {
    /** 标记为执行日志文件 */
    chat_execution_log: true;
    /** 关联的对话文件 ID */
    chat_conversation_id: string;
    /** 日志最大保留条数（超出时自动裁剪），默认 50 */
    log_max_runs?: number;
}

/** 单次执行记录中的工具调用信息 */
export interface ExecutionToolCall {
    /** 工具名称 */
    tool: string;
    /** 输入摘要（截断） */
    inputSummary: string;
    /** 耗时（ms） */
    duration: number;
    /** 结果摘要（截断） */
    resultSummary: string;
}

/** 单次 LLM 执行记录 */
export interface ExecutionRunRecord {
    /** 执行序号 */
    runNumber: number;
    /** 执行开始时间戳 */
    startedAt: number;
    /** 状态轨迹，如 "queued → executing → success" */
    stateTrace: string;
    /** 是否成功 */
    success: boolean;
    /** 总耗时（ms） */
    duration: number;
    /** 输入 token 数 */
    inputTokens: number;
    /** 输出 token 数 */
    outputTokens: number;
    /** 工具调用明细 */
    toolCalls: ExecutionToolCall[];
    /** 错误信息（失败时） */
    errorMessage?: string;
    /** 重试次数 */
    retryCount: number;
    // ─── 上下文信息（用于审计） ─────────────────────────────
    /** 触发方式 */
    trigger?: 'timer' | 'direct' | 'save';
    /** 角色名称 */
    roleName?: string;
    /** 使用的模型 */
    modelFamily?: string;
    /** 配置的 max_tokens */
    maxTokens?: number;
    /** 配置的超时时间（ms） */
    timeout?: number;
}

/** 执行日志运行时信息 */
export interface ChatExecutionLogInfo {
    /** 日志文件 ID */
    id: string;
    /** 关联的对话 ID */
    conversationId: string;
    /** 文件 URI */
    uri: import('vscode').Uri;
    /** 最后修改时间 */
    mtime: number;
    /** 执行总次数 */
    totalRuns: number;
    /** 成功次数 */
    successCount: number;
    /** 失败次数 */
    failureCount: number;
}

// ─── 工具调用详情节点 ─────────────────────────────────────────

/** 工具调用详情节点的 frontmatter（每次工具调用一个文件） */
export interface ChatToolCallFrontmatter {
    /** 标记为工具调用详情节点 */
    chat_tool_call: true;
    /** 关联的执行日志文件 ID */
    chat_log_id: string;
    /** Run 编号 */
    run_number: number;
    /** 工具名称 */
    tool_name: string;
    /** 调用是否成功 */
    tool_success: boolean;
    /** 调用耗时（ms） */
    tool_duration: number;
    /** 本次 Run 中的调用序号 */
    call_sequence: number;
}

// ─── Chrome 面板聊天 ─────────────────────────────────────────

/** Chrome 面板聊天对话的 frontmatter */
export interface ChromeChatFrontmatter {
    /** 标记为 Chrome 面板聊天对话文件 */
    chrome_chat: true;
    /** 对话标题 */
    chat_title?: string;
}

/** Chrome 面板对话运行时信息（轻量，不含消息体） */
export interface ChromeChatInfo {
    /** 对话文件 ID（文件名去掉 .md） */
    id: string;
    /** 对话标题 */
    title: string;
    /** 最后修改时间 */
    mtime: number;
}
