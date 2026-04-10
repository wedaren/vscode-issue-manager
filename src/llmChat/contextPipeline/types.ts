/**
 * 上下文管道类型定义
 *
 * 设计原则：角色自己知道需要什么上下文。
 *
 * 三种策略：
 *   - generous: 注入所有可用上下文（个人助理、思维伙伴）
 *   - focused:  只注入角色声明的 context_sources（专业角色）
 *   - minimal:  只注入基础锚点（定时器角色）
 */

/** 上下文来源 ID（与 provider 一一对应） */
export type ContextSourceId =
    | 'identity'              // 角色身份（system prompt body）
    | 'goal'                  // 对话目标（完成条件）
    | 'intent'                // 意图锚点
    | 'plan'                  // 执行计划
    | 'mode'                  // 执行模式（自主/交互）
    | 'memory'                // 自动提取记忆（系统维护，hook 写入）
    | 'role_memory'           // 角色记忆（LLM 主动写入，自动注入替代 read_memory 工具调用）
    | 'active_editor'         // 当前编辑器内容
    | 'selection'             // 编辑器选中文本
    | 'git_diff'              // Git 变更
    | 'datetime'              // 当前时间
    | 'linked_files'          // 关联文件
    | 'terms'                 // 术语表
    | 'children'              // 子问题摘要
    | 'conversation_context' // 对话上下文（相关 + 近期，合并去重）
    | 'skills'              // Agent Skills（agentskills.io 规范）
    | 'external_knowledge'; // 全局知识库（wiki/ 文章按关键词注入）

/** 所有可获取的 source（identity 由 assembler 处理，不在此列） */
export const ALL_SOURCES: ContextSourceId[] = [
    'goal', 'intent', 'plan', 'mode', 'skills', 'role_memory', 'memory', 'active_editor', 'selection',
    'git_diff', 'datetime', 'linked_files', 'terms', 'children', 'conversation_context', 'external_knowledge',
];

/** 所有策略下始终注入的 source */
export const ALWAYS_ON: ContextSourceId[] = ['mode', 'intent', 'goal'];

/** minimal 策略注入的 source */
export const MINIMAL_SOURCES: ContextSourceId[] = ['mode', 'intent', 'datetime'];

/** 结构化上下文单元 */
export interface ContextItem {
    /** 来源 ID */
    source: ContextSourceId;
    /** 优先级 0-100，越高越重要 */
    priority: number;
    /** 预估 token 数 */
    tokens: number;
    /** 渲染后的文本内容 */
    content: string;
    /** 是否可被压缩（token 不够时降级） */
    compressible: boolean;
    /** 压缩版本（可选，由 provider 提供） */
    compressedContent?: string;
    /** 压缩版 token 数 */
    compressedTokens?: number;
}

/** Provider 解析上下文 */
export interface ProviderContext {
    conversationUri: import('vscode').Uri;
    role: import('../types').ChatRoleInfo;
    convoConfig: {
        modelFamily?: string;
        maxTokens?: number;
        tokenUsed?: number;
        autonomous?: boolean;
        intent?: string;
        goal?: string;
    } | null;
    autonomous: boolean;
    latestUserMessage: string;
}

/** 审计跟踪条目 */
export interface ContextTraceEntry {
    source: ContextSourceId;
    priority: number;
    tokens: number;
    status: 'included' | 'dropped' | 'skipped' | 'compressed' | 'budget_dropped';
    reason?: string;
}
