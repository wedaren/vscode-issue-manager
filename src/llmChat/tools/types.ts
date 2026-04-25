/**
 * 工具系统的公共类型定义
 */
import type { ExecutionContext } from '../ExecutionContext';
import type { ChatRoleInfo } from '../types';

/** 工具执行时需要的角色上下文 */
export interface ToolExecContext {
    /** 统一执行上下文。提供时优先使用，以下字段作为回退兼容。 */
    ctx?: ExecutionContext;
    /** 当前角色信息（用于记忆/委派等能力工具） */
    role?: ChatRoleInfo;
    /** 当前对话文件 URI（用于对话级工具如 todo） */
    conversationUri?: import('vscode').Uri;
    /** 中止信号 */
    signal?: AbortSignal;
    /**
     * 心跳回调：长时间运行的工具（如同步委派等待）应定期调用此函数，
     * 通知调用方（RoleTimerManager）工具仍在活跃中，避免空闲超时误判。
     * @deprecated 使用 ctx.heartbeat()
     */
    onHeartbeat?: () => void;
    /**
     * 自主模式标记。true = 跳过所有确认（定时器/自主模式），false = 危险操作需用户确认。
     * undefined 等同于 false。
     */
    autonomous?: boolean;
    /**
     * 当前委派递归深度（per-execution，非进程级）。
     * 每层同步委派 +1，回到上层 -1。不传则视为 0（顶层）。
     */
    delegationDepth?: number;
    /**
     * 当前任务链的委派总调用次数（per-execution，非进程级）。
     * 同步/异步委派及追问均计数。不传则视为 0。
     */
    delegationTotalCalls?: number;
}

export interface ToolCallResult {
    success: boolean;
    content: string;
}

export type ToolRiskLevel = 'safe' | 'write' | 'destructive';
