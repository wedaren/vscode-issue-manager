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
    /** 系统提示词 */
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
    /** 标记为个人助手角色（系统唯一） */
    chat_role_is_personal_assistant?: true;
}

// ─── 个人助手相关 ─────────────────────────────────────────────

/** 个人助手记忆文件的 frontmatter */
export interface PersonalAssistantMemoryFrontmatter {
    /** 标记为助手记忆文件 */
    assistant_memory: true;
    /** 关联的助手角色 ID */
    assistant_role_id: string;
}

/** 个人助手持久记忆结构 */
export interface PersonalAssistantMemory {
    /** 用户背景和偏好摘要 */
    userContext: string;
    /** 历史任务记录（最近 20 条） */
    taskHistory: Array<{
        summary: string;
        rolesInvolved: string[];
        outcome: 'success' | 'partial' | 'failed';
        timestamp: number;
    }>;
    /** 角色绩效记录 */
    rolePerformance: Record<string, {
        successCount: number;
        failureCount: number;
        lastEvaluation: string;
        improvementNotes: string;
    }>;
    /** 助手自我反思笔记 */
    selfReflection: string;
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
}

/** 运行时聊天角色信息（从 issueMarkdown 解析而来） */
export interface ChatRoleInfo {
    /** 角色文件的 issue ID（文件名去掉 .md） */
    id: string;
    /** 角色显示名称 */
    name: string;
    /** 角色图标 */
    avatar: string;
    /** 系统提示词 */
    systemPrompt: string;
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
    /** 是否为个人助手角色 */
    isPersonalAssistant?: boolean;
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
