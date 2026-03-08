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
