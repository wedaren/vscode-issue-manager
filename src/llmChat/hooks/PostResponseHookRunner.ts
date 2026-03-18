/**
 * Post-response hook 子系统
 *
 * 每次 LLM 回复写入完成后，Runner 异步触发所有已注册的 hook。
 * hook 失败时静默 warn，不影响主流程。
 *
 * 扩展方式：
 *   1. 新建 hooks/xxxHook.ts，导出 PostResponseHook 函数
 *   2. 在 RoleTimerManager 初始化时调用 runner.register('xxx', xxxHook)
 */
import * as vscode from 'vscode';
import { Logger } from '../../core/utils/Logger';
import type { ChatRoleInfo } from '../types';

const logger = Logger.getInstance();

/** hook 函数执行时拿到的上下文 */
export interface PostResponseHookContext {
    /** 对话文件 URI */
    uri: vscode.Uri;
    /** 当前角色信息 */
    role: ChatRoleInfo;
    /** 是否为本对话的首次 LLM 回复 */
    isFirstResponse: boolean;
    /** 首条用户消息的纯文本（已提取），isFirstResponse=true 时有意义 */
    firstUserText: string;
    /** 本次 LLM 回复的文本 */
    assistantText: string;
    /** 通知树视图刷新（hook 写入数据后应调用） */
    notifyChange: (payload: { uri: vscode.Uri; roleId: string; success: boolean }) => void;
}

export type PostResponseHook = (ctx: PostResponseHookContext) => Promise<void>;

export class PostResponseHookRunner {
    private readonly _hooks: Array<{ name: string; fn: PostResponseHook }> = [];

    /** 注册一个 hook，name 仅用于日志 */
    register(name: string, fn: PostResponseHook): void {
        this._hooks.push({ name, fn });
    }

    /**
     * 异步触发所有已注册 hook，fire-and-forget。
     * 每个 hook 独立执行，单个失败不影响其他。
     */
    fire(ctx: PostResponseHookContext): void {
        for (const { name, fn } of this._hooks) {
            void fn(ctx).catch(e =>
                logger.warn(`[PostResponseHookRunner] hook "${name}" 执行失败（已忽略）`, e),
            );
        }
    }
}
