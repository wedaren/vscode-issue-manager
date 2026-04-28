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
    contextWindow?: number,
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
        } catch (e) {
            logger.warn(`[ContextPipeline] provider '${source}' 失败: ${e instanceof Error ? e.message : String(e)}`);
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

    // Token 预算修剪：system prompt 占总预算的 35%
    const budget = contextWindow ? Math.floor(contextWindow * 0.35) : undefined;
    const { trimmedItems, trimTrace } = budget
        ? trimItems(items, budget)
        : { trimmedItems: items, trimTrace: [] };
    trace.push(...trimTrace);

    // 组装 prompt
    const systemPrompt = assemblePrompt(identity, trimmedItems);

    // 日志
    const included = trace.filter(t => t.status === 'included');
    const totalTokens = included.reduce((sum, t) => sum + t.tokens, 0);
    logger.debug(
        `[ContextPipeline] 策略=${strategy} | `
        + `注入=${included.map(t => t.source).join(',')} (${totalTokens} tok) | `
        + `跳过=${trace.filter(t => t.status === 'skipped').map(t => t.source).join(',') || '无'}`,
    );

    const compressed = trace.filter(t => t.status === 'compressed');
    const budgetDropped = trace.filter(t => t.status === 'budget_dropped');
    if (compressed.length > 0 || budgetDropped.length > 0) {
        logger.info(
            `[ContextPipeline] 预算修剪 (budget=${budget}): `
            + `压缩=${compressed.map(t => t.source).join(',') || '无'} | `
            + `丢弃=${budgetDropped.map(t => t.source).join(',') || '无'}`,
        );
    }

    return { systemPrompt, trace, strategy };
}

// ─── Token 预算修剪 ─────────────────────────────────────────

/** 粗略 token 估算（与 contextProviders.ts 一致） */
function estimateTokensRough(text: string): number {
    let cjk = 0, ascii = 0;
    for (const ch of text) {
        if (ch.charCodeAt(0) > 0x7F) { cjk++; } else { ascii++; }
    }
    return Math.ceil(cjk / 2 + ascii / 4);
}

/**
 * 两阶段 token 预算修剪。
 *
 * Phase 1：从低优先级开始，将 compressible item 替换为 compressedContent
 * Phase 2：仍超预算，从低优先级开始丢弃 compressible item
 * 永不压缩/丢弃 compressible=false 的 item（mode, intent, goal 等）
 */
function trimItems(
    items: ContextItem[],
    budget: number,
): { trimmedItems: ContextItem[]; trimTrace: ContextTraceEntry[] } {
    const trimTrace: ContextTraceEntry[] = [];
    const totalTokens = items.reduce((sum, item) => sum + item.tokens, 0);

    if (totalTokens <= budget) {
        return { trimmedItems: items, trimTrace };
    }

    logger.debug(`[ContextPipeline] Token 超预算: ${totalTokens} > ${budget}，开始修剪`);

    // 浅拷贝，按 priority 降序（已排好），从末尾（低优先级）开始修剪
    const workItems = items.map(item => ({ ...item }));
    let current = totalTokens;

    // Phase 1：压缩
    for (let i = workItems.length - 1; i >= 0 && current > budget; i--) {
        const item = workItems[i];
        if (!item.compressible || !item.compressedContent || !item.compressedTokens) { continue; }
        const saving = item.tokens - item.compressedTokens;
        if (saving <= 0) { continue; }

        current -= saving;
        workItems[i] = {
            ...item,
            content: item.compressedContent,
            tokens: item.compressedTokens,
        };
        trimTrace.push({
            source: item.source, priority: item.priority, tokens: item.compressedTokens,
            status: 'compressed', reason: `saved ${saving} tok`,
        });
    }

    // Phase 2：丢弃
    for (let i = workItems.length - 1; i >= 0 && current > budget; i--) {
        const item = workItems[i];
        if (!item.compressible) { continue; }

        current -= item.tokens;
        trimTrace.push({
            source: item.source, priority: item.priority, tokens: item.tokens,
            status: 'budget_dropped', reason: `over by ${current + item.tokens - budget} tok`,
        });
        workItems.splice(i, 1);
    }

    return { trimmedItems: workItems, trimTrace };
}

// 导出
export type { ContextItem, ContextTraceEntry, ContextSourceId, ProviderContext } from './types';
