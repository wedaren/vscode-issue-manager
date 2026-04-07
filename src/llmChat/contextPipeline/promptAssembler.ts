/**
 * Prompt 组装器
 *
 * 将角色身份 + 选取的 ContextItem[] 组装为结构化 system prompt。
 *
 * 结构：
 *   [角色] 身份与行为约束（开头，高注意力区）
 *   [参考信息] 背景知识（中间，可容忍低注意力）
 *   [当前状态] 任务锚点、环境信息（结尾，高注意力区）
 *
 * 设计原则：
 *   - 指令和上下文分离，用结构化标记
 *   - 参考信息标注"仅供参考，请自行判断"（允许模型忽略不相关的）
 *   - 高优先级 item 放结尾（靠近用户消息，注意力最高）
 */
import type { ContextItem, ContextSourceId } from './types';

/**
 * Item 分区：哪些 source 属于"当前状态"（放结尾高注意力区）
 * 其余归入"参考信息"（放中间）
 */
const TAIL_SOURCES = new Set<ContextSourceId>([
    'intent', 'plan', 'mode', 'active_editor', 'selection', 'git_diff',
]);

/**
 * 组装最终 system prompt。
 *
 * @param identity     角色身份文本（system prompt body）
 * @param items        经过选取和过滤的 ContextItem[]
 * @returns            组装后的完整 system prompt 文本
 */
export function assemblePrompt(identity: string, items: ContextItem[]): string {
    const sections: string[] = [];

    // ── 开头：角色身份 ──
    sections.push(`[角色]\n${identity}`);

    // ── 分区 ──
    const referenceItems: ContextItem[] = [];  // 中间：背景知识
    const stateItems: ContextItem[] = [];      // 结尾：当前状态

    for (const item of items) {
        if (TAIL_SOURCES.has(item.source)) {
            stateItems.push(item);
        } else {
            referenceItems.push(item);
        }
    }

    // ── 中间：参考信息 ──
    if (referenceItems.length > 0) {
        const refParts = referenceItems.map(i => i.content);
        sections.push(
            '[参考信息]\n'
            + '以下信息仅供参考，不一定与用户当前问题直接相关，请自行判断是否使用。\n\n'
            + refParts.join('\n\n'),
        );
    }

    // ── 结尾：当前状态 ──
    if (stateItems.length > 0) {
        const stateParts = stateItems.map(i => i.content);
        sections.push('[当前状态]\n' + stateParts.join('\n\n'));
    }

    return sections.join('\n\n');
}
