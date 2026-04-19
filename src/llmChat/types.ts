/**
 * LLM 聊天模块类型定义
 */

// ─── A2A 协议暴露配置 ─────────────────────────────────────────

/** A2A agent 技能描述（对应 A2A spec 的 AgentSkill） */
export interface A2ASkillDescriptor {
    id: string;
    name: string;
    description: string;
    tags?: string[];
    examples?: string[];
}

/**
 * 角色级 A2A 暴露配置。
 * 写入角色 frontmatter 的 `a2a` 字段；运行时映射到 ChatRoleInfo.a2a。
 * 只有 expose: true 的角色会被 A2A server 注册为 agent card。
 */
export interface A2AExposeConfig {
    /** 是否暴露为 A2A agent（默认 false） */
    expose: boolean;
    /** 对外 agent id（默认取 role id） */
    id?: string;
    /** 对外显示名（默认取 chat_role_name） */
    name?: string;
    /** Agent card description（默认取 markdown body 首段） */
    description?: string;
    /** 技能列表（必填，外部 agent 通过 skill id 路由） */
    skills?: A2ASkillDescriptor[];
    /** 支持的输入 MIME，默认 ["text/plain"] */
    inputModes?: string[];
    /** 支持的输出 MIME，默认 ["text/plain"] */
    outputModes?: string[];
}

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
    /** 空闲超时（ms），LLM 无响应多久后中断，默认 60000 */
    timer_timeout?: number;
    /** 单次工具调用超时（ms），默认 60000。委派类工具自动放宽为此值 ×3 */
    timer_tool_timeout?: number;
    /** 总执行时间上限（ms），默认 600000（10分钟）。到时间无条件中断 */
    timer_max_execution?: number;
    /** 最大重试次数，默认 3 */
    timer_max_retries?: number;
    /** 初始重试间隔（ms），指数退避，默认 5000 */
    timer_retry_delay?: number;
    /** Cron 表达式（minute hour day month weekday），如 "0 22 * * *" = 每天 22:00 */
    timer_cron?: string;
    /** Cron 触发时自动创建对话并排队的消息内容 */
    timer_cron_message?: string;
    /** 角色级 LLM 请求最大 token 预算（可选） */
    chat_role_max_tokens?: number;
    /** 单次执行最大工具调用轮次，默认 30。复杂任务角色可调高。 */
    max_tool_rounds?: number;
    // ─── 工具集配置 ───────────────────────────────────────────
    /**
     * 内置工具包列表，合法值：
     * "memory" | "delegation" | "role_management"
     */
    tool_sets?: string[];
    /** 允许使用的 MCP server 名称列表（取其全部工具）；"*" 表示引入所有已注册的 MCP 工具 */
    mcp_servers?: string[];
    /** 额外引入的具体工具名称列表（来自任何 MCP server） */
    extra_tools?: string[];
    /** 排除的具体工具名称列表 */
    excluded_tools?: string[];
    /** Agent Skills 名称列表（遵循 agentskills.io 规范），知识注入到 system prompt */
    skills?: string[];
    /**
     * 群组成员角色 ID 列表（可选）。
     * 设置后此角色作为协调者，通过 ask_group_member 工具调度这些成员。
     * 替代原有的独立 chat_group 文件概念。
     */
    group_members?: string[];
    /**
     * 委派可用状态：
     * - 'ready'（默认）— 可正常接受委派
     * - 'testing' — 调试中，委派时会显示警告
     * - 'disabled' — 禁止接受委派
     */
    role_status?: 'ready' | 'testing' | 'disabled';
    /**
     * 角色级自主模式默认值：true = 自主执行，false = 交互确认（默认）。
     * 对话级 chat_autonomous 可覆盖此设置，优先级：对话 > 角色。
     */
    chat_autonomous?: boolean;
    /** 角色级执行日志生成开关（默认 false = 不生成日志和工具调用文件）。对话级 chat_log_enabled 可覆盖。 */
    chat_log_enabled?: boolean;
    /**
     * 上下文管道策略：
     * - 'generous' — 注入所有可用上下文（个人助理、思维伙伴）
     * - 'focused' — 只注入 context_sources 声明的上下文（专业角色）
     * - 'minimal' — 仅注入 mode + intent + datetime（定时器角色）
     */
    context_strategy?: 'generous' | 'focused' | 'minimal';
    /** focused 策略下要注入的上下文来源列表 */
    context_sources?: string[];
    /**
     * A2A 协议暴露配置（可选）。
     * 设置后此角色会被 A2A server 注册为独立 agent card，外部 agent 可通过
     * `http://127.0.0.1:<port>/agents/<roleId>` 访问。
     */
    a2a?: A2AExposeConfig;
}

// ─── 角色记忆相关 ─────────────────────────────────────────────

/** 角色记忆文件的 frontmatter（LLM 主动写入，自由格式） */
export interface RoleMemoryFrontmatter {
    /** 标记为角色记忆文件 */
    role_memory: true;
    /** 关联的角色 ID */
    role_memory_owner_id: string;
}

/**
 * 自动提取记忆文件的 frontmatter（hook 自动写入，结构化格式）。
 * 与 role_memory 完全独立，LLM 只读不写此文件。
 */
export interface RoleAutoMemoryFrontmatter {
    /** 标记为自动提取记忆文件 */
    role_auto_memory: true;
    /** 关联的角色 ID */
    role_auto_memory_owner_id: string;
}

// ─── 执行计划相关 ─────────────────────────────────────────────

/** 执行计划文件的 frontmatter（LLM 通过 planning 工具集管理） */
export interface ChatPlanFrontmatter {
    /** 标记为执行计划文件 */
    chat_plan: true;
    /** 关联的对话 ID */
    chat_plan_conversation_id: string;
    /** 计划标题 */
    chat_plan_title: string;
    /** 计划状态 */
    chat_plan_status: 'in_progress' | 'completed' | 'abandoned';
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
     * 优先级：对话 > 角色。
     */
    chat_autonomous?: boolean;
    /** 对话级执行日志生成开关（覆盖角色配置）。true = 生成，false = 不生成，undefined = 继承角色。 */
    chat_log_enabled?: boolean;
    /**
     * 意图锚点：首次回复后由 hook 自动提取并写入，注入到 system prompt 最前。
     * 防止长对话中目标漂移。可由用户手动修改以更正意图描述。
     */
    chat_intent?: string;
    /**
     * 关联的执行计划文件 ID（LLM 调用 create_plan 后自动写入）。
     * 计划内容在每次 buildMessages() 时注入到 system prompt。
     */
    chat_plan_id?: string;
    /**
     * 关联的群组 ID（群组成员专属对话文件时设置）。
     * 配合 chat_role_id 唯一确定某成员在某群组下的对话文件。
     */
    chat_group_id?: string;
    /**
     * 当前对话中 queue_continuation 的累计调用次数。
     * 由 queue_continuation handler 自增，达到上限时拒绝继续排队。
     * 用户可手动清零（设为 0）以恢复自动续写能力。
     */
    chat_auto_queue_count?: number;
    /**
     * 待提升的续写消息（两阶段提交）。
     * queue_continuation 在 run 执行中无法直接追加消息（executing 状态限制），
     * 故先暂存于此字段。run 成功结束后由 RoleTimerManager 提升为 queued 消息，
     * run 失败时清空（避免错误状态下死循环）。
     */
    chat_pending_continuation?: string;
    /**
     * 对话目标：明确的完成条件（自然语言）。
     * 由用户或 LLM 设置，注入到 system prompt。
     * 与 intent（描述性）不同，goal 是判定"什么时候算完"的依据。
     * 系统在每次 run 结束后检查 plan 完成状态，结合 goal 决定是否自动续写。
     */
    chat_goal?: string;
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
    timerToolTimeout?: number;
    timerMaxExecution?: number;
    timerMaxRetries?: number;
    timerRetryDelay?: number;
    /** Cron 表达式，设置后自动启用定时器 */
    timerCron?: string;
    /** Cron 触发时排队的消息 */
    timerCronMessage?: string;
    /** 角色级最大 token 预算 */
    maxTokens?: number;
    /** 单次执行最大工具调用轮次 */
    maxToolRounds?: number;
    // ─── 工具集配置（运行时） ────────────────────────────────
    /** 内置工具包名称列表，如 ["memory", "delegation", "web"] */
    toolSets: string[];
    /** 允许使用的 MCP server 名称列表；"*" 表示引入所有已注册的 MCP 工具 */
    mcpServers?: string[];
    /** 额外引入的具体工具名称列表 */
    extraTools?: string[];
    /** 排除的具体工具名称列表 */
    excludedTools?: string[];
    /** Agent Skills 名称列表 */
    skills?: string[];
    /**
     * 群组成员角色 ID 列表（运行时）。
     * 有值时此角色作为协调者，ask_group_member 工具从此列表解析成员。
     */
    groupMembers?: string[];
    /** 委派可用状态，undefined 等同于 'ready' */
    roleStatus?: 'ready' | 'testing' | 'disabled';
    /** 角色级自主模式默认值，undefined 等同于 false（交互模式） */
    autonomous?: boolean;
    /** 角色级日志生成开关，undefined 等同于 false */
    logEnabled?: boolean;
    /** 上下文管道策略，undefined 等同于 'generous' */
    contextStrategy?: 'generous' | 'focused' | 'minimal';
    /** focused 策略下要注入的上下文来源列表 */
    contextSources?: string[];
    /** A2A 暴露配置（来自 frontmatter.a2a，原样保留；undefined 表示不暴露） */
    a2a?: A2AExposeConfig;
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
    /** 关联的执行计划 ID */
    planId?: string;
    /** 对话级自主模式 */
    autonomous?: boolean;
    /** 对话级日志生成开关 */
    logEnabled?: boolean;
    /** 意图锚点（首次回复后自动提取，防止目标漂移） */
    intent?: string;
}

// ─── 群组相关（仅保留消息格式，用于协调者对话文件的消息解析） ──

/** 协调者对话中的消息，assistant 消息额外携带角色名称前缀 */
export interface ChatGroupMessage {
    role: 'user' | 'assistant';
    /** assistant 消息对应的角色名称（来自 ## Assistant:RoleName 格式） */
    roleName?: string;
    content: string;
    timestamp: number;
}

// ─── 最近对话（聚合视图） ─────────────────────────────────────

/** 按对话聚合的最近对话条目（顶层节点） */
export interface RecentConversationEntry {
    /** 对话 ID */
    conversationId: string;
    /** 对话标题 */
    title: string;
    /** 所属角色名称 */
    roleName: string;
    /** 对话文件 URI（可能为空，如对话被删除） */
    conversationUri?: import('vscode').Uri;
    /** 最近一次 Run 的时间戳 */
    latestTimestamp: number;
    /** 该对话下的所有 Run（按时间倒序） */
    runs: RecentActivityEntry[];
}

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
    trigger?: 'timer' | 'direct' | 'save' | 'a2a';
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

/** 执行计划运行时信息 */
export interface ChatPlanInfo {
    /** 计划文件 ID */
    id: string;
    /** 关联的对话 ID */
    conversationId: string;
    /** 文件 URI */
    uri: import('vscode').Uri;
    /** 计划标题 */
    title: string;
    /** 计划状态 */
    status: 'in_progress' | 'completed' | 'abandoned';
    /** 总步骤数 */
    totalSteps: number;
    /** 已完成步骤数 */
    doneSteps: number;
}

/** 角色记忆运行时信息 */
export interface ChatMemoryInfo {
    /** 记忆文件 ID */
    id: string;
    /** 关联的角色 ID */
    roleId: string;
    /** 文件 URI */
    uri: import('vscode').Uri;
    /** 记忆类型 */
    type: 'role_memory' | 'role_auto_memory';
    /** 内容概要（首行或条目数） */
    summary: string;
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
