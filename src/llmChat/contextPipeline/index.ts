/**
 * 上下文管道 — 入口
 *
 * 三种策略，零分类开销：
 *   generous → 注入所有 provider（个人助理、思维伙伴）
 *   focused  → 只注入角色声明的 context_sources（专业角色）
 *   minimal  → 只注入 mode + intent + datetime（定时器角色）
 *
 * 角色自己知道需要什么上下文，不需要运行时猜测。
 */
import type { ChatRoleInfo } from '../types';
import type { ProviderContext, ContextItem, ContextTraceEntry, ContextSourceId } from './types';
import { ALL_SOURCES, ALWAYS_ON, MINIMAL_SOURCES } from './types';
import { allProviders } from './contextProviders';
import { assemblePrompt } from './promptAssembler';
import { Logger } from '../../core/utils/Logger';

const logger = Logger.getInstance();

export interface ContextPipelineResult {
    systemPrompt: string;
    trace: ContextTraceEntry[];
    strategy: string;
}

/**
 * 运行上下文管道，生成 system prompt。
 */
export async function runContextPipeline(
    identity: string,
    conversationUri: import('vscode').Uri,
    role: ChatRoleInfo,
    convoConfig: ProviderContext['convoConfig'],
    autonomous: boolean,
    latestUserMessage: string,
    _hasHistory: boolean,
): Promise<ContextPipelineResult> {
    const strategy = role.contextStrategy ?? 'generous';

    const ctx: ProviderContext = {
        conversationUri,
        role,
        convoConfig,
        autonomous,
        latestUserMessage,
    };

    // 确定要获取的 source 列表
    let sourcesToFetch: ContextSourceId[];

    if (strategy === 'generous') {
        sourcesToFetch = ALL_SOURCES;
    } else if (strategy === 'minimal') {
        sourcesToFetch = [...MINIMAL_SOURCES];
    } else {
        // focused：始终注入 mode + intent，加上角色声明的 sources
        const declared = role.contextSources ?? [];
        const validDeclared = declared.filter(
            (s): s is ContextSourceId => s in allProviders,
        );
        sourcesToFetch = [...new Set([...ALWAYS_ON, ...validDeclared])];
    }

    // skills 跟随角色配置：有 skills 就注入 catalog，无论策略
    if (role.skills && role.skills.length > 0 && !sourcesToFetch.includes('skills')) {
        sourcesToFetch.push('skills');
    }

    // 并行获取所有 source
    const trace: ContextTraceEntry[] = [];
    const items: ContextItem[] = [];

    const tasks = sourcesToFetch.map(async (source) => {
        const provider = allProviders[source];
        if (!provider) { return; }

        try {
            const item = await provider(ctx);
            if (!item || item.content.length < 5) {
                trace.push({ source, priority: 0, tokens: 0, status: 'dropped', reason: item ? 'empty' : 'null' });
                return;
            }
            items.push(item);
            trace.push({ source, priority: item.priority, tokens: item.tokens, status: 'included' });
        } catch {
            trace.push({ source, priority: 0, tokens: 0, status: 'dropped', reason: 'error' });
        }
    });

    // 记录被跳过的 source
    const fetchSet = new Set(sourcesToFetch);
    for (const s of ALL_SOURCES) {
        if (!fetchSet.has(s)) {
            trace.push({ source: s, priority: 0, tokens: 0, status: 'skipped', reason: `not_in_${strategy}` });
        }
    }

    await Promise.all(tasks);

    // 按 priority 降序
    items.sort((a, b) => b.priority - a.priority);

    // 组装 prompt
    const systemPrompt = assemblePrompt(identity, items);

    // 日志
    const included = trace.filter(t => t.status === 'included');
    const totalTokens = included.reduce((sum, t) => sum + t.tokens, 0);
    logger.debug(
        `[ContextPipeline] 策略=${strategy} | `
        + `注入=${included.map(t => t.source).join(',')} (${totalTokens} tok) | `
        + `跳过=${trace.filter(t => t.status === 'skipped').map(t => t.source).join(',') || '无'}`,
    );

    return { systemPrompt, trace, strategy };
}

// 导出
export type { ContextItem, ContextTraceEntry, ContextSourceId, ProviderContext } from './types';
