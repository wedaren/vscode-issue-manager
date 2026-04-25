/**
 * Post-response hook 子系统
 *
 * 每次 LLM 回复写入完成后，Runner 异步触发所有已注册的 hook。
 * hook 失败时静默 warn，不影响主流程。
 *
 * 日志设计：
 *   hook 调用的 ctx.log() 写入内存收集器（HookLogCollector），
 *   全部 hook 完成后一次性批写 `### 🪝 Hooks (Run #N)` 子段到执行日志。
 *   这样主执行锁可立即释放（fire-and-forget），同时日志不会与下一个 Run 交错。
 *
 * 扩展方式：
 *   1. 新建 hooks/xxxHook.ts，导出 PostResponseHook 函数
 *   2. 在 RoleTimerManager 初始化时调用 runner.register('xxx', xxxHook)
 */
import * as vscode from 'vscode';
import { Logger } from '../../core/utils/Logger';
import { appendHookSection } from '../llmChatDataManager';
import type { ChatRoleInfo } from '../types';

const logger = Logger.getInstance();

/** hook 函数执行时拿到的上下文 */
export interface PostResponseHookContext {
    /** 对话文件 URI */
    uri: vscode.Uri;
    /** 对话 ID（文件名去掉 .md） */
    conversationId: string;
    /** 当前角色信息 */
    role: ChatRoleInfo;
    /** 是否为本对话的首次 LLM 回复 */
    isFirstResponse: boolean;
    /** 首条用户消息的纯文本（已提取），isFirstResponse=true 时有意义 */
    firstUserText: string;
    /** 本次用户消息的纯文本 */
    lastUserText: string;
    /** 本次 LLM 回复的文本 */
    assistantText: string;
    /** 通知树视图刷新（hook 写入数据后应调用） */
    notifyChange: (payload: { uri: vscode.Uri; roleId: string; success: boolean }) => void;
    /** Hook 日志函数。写入内存收集器，最终批量写入执行日志的 Hooks 子段。 */
    log?: (line: string) => void;
}

export type PostResponseHook = (ctx: PostResponseHookContext) => Promise<void>;

// ─── 内存日志收集器 ──────────────────────────────────────────

/** 收集各 hook 的日志条目，全部完成后一次性格式化为 Markdown 子段 */
class HookLogCollector {
    private readonly _entries: Array<{ line: string; timestamp: Date }> = [];

    log(line: string): void {
        this._entries.push({ line, timestamp: new Date() });
    }

    /** 格式化为 `### 🪝 Hooks (Run #N)` 子段，无日志时返回 null */
    format(runNumber: number): string | null {
        if (this._entries.length === 0) { return null; }
        const lines = this._entries.map(e => {
            const ts = formatTimeHMS(e.timestamp);
            return `- \`${ts}\` ${e.line}`;
        });
        return `\n### 🪝 Hooks (Run #${runNumber})\n\n${lines.join('\n')}\n`;
    }
}

function formatTimeHMS(d: Date): string {
    const p = (n: number) => n.toString().padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ─── Runner ─────────────────────────────────────────────────

export class PostResponseHookRunner {
    private readonly _hooks: Array<{ name: string; fn: PostResponseHook }> = [];

    /** 注册一个 hook，name 仅用于日志 */
    register(name: string, fn: PostResponseHook): void {
        this._hooks.push({ name, fn });
    }

    /**
     * 异步触发所有已注册 hook，fire-and-forget。
     * 每个 hook 独立执行，单个失败不影响其他。
     *
     * hook 的 ctx.log() 写入 HookLogCollector 内存收集器。
     * 全部 hook 完成后，收集器批量写入执行日志的独立子段。
     */
    fire(
        ctx: PostResponseHookContext,
        logTarget?: { logUri: vscode.Uri; runNumber: number },
    ): void {
        const collector = logTarget ? new HookLogCollector() : undefined;

        const tasks = this._hooks.map(({ name, fn }) => {
            const start = Date.now();
            const hookCtx: PostResponseHookContext = {
                ...ctx,
                log: collector ? (line: string) => collector.log(line) : undefined,
            };
            return fn(hookCtx).catch(e => {
                const dur = ((Date.now() - start) / 1000).toFixed(1);
                const msg = e instanceof Error ? e.message : String(e);
                collector?.log(`✗ ~~${name}~~ 失败 (${dur}s): ${msg}`);
                logger.warn(`[PostResponseHookRunner] hook "${name}" 执行失败（已忽略）`, e);
            });
        });

        // fire-and-forget：全部完成后批量写入日志子段
        void Promise.allSettled(tasks).then(() => {
            if (collector && logTarget && logTarget.runNumber > 0) {
                const section = collector.format(logTarget.runNumber);
                if (section) {
                    void appendHookSection(logTarget.logUri, section);
                }
            }
        });
    }
}
