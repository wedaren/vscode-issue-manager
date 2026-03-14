import * as vscode from 'vscode';

/**
 * 批量刷新控制器（Batch Refresh Controller）
 *
 * ## 问题
 * 当 LLM 批量创建笔记（如 create_issue_tree 一次创建 N 个文件）或
 * 自动化脚本连续变更多个文件时，每个文件写入都会触发 FileSystemWatcher
 * 事件，进而导致以下连锁刷新：
 *   1. UnifiedFileWatcher → 分发 Markdown / .issueManager 文件变更事件
 *   2. IssueStructureProvider → 重建树节点 + fire onDidChangeTreeData
 *   3. ViewCommandRegistry.refreshViews → 刷新 6 个视图 Provider
 * N 个文件 → N 次完整刷新链路，产生大量冗余 IO 和 UI 重绘，
 * 体感上表现为编辑器卡顿和视图频繁闪烁。
 *
 * ## 修改（三层防抖 + 批量暂停）
 *
 * | 层级 | 组件 | 策略 | 说明 |
 * |------|------|------|------|
 * | L1 | UnifiedFileWatcher | 事件合并（coalesce 200ms） | 同一文件在 200ms 内的多次变更只分发最后一次；按文件名去重 |
 * | L2 | IssueStructureProvider | 防抖刷新（debounce 300ms） | 收到文件变更后 300ms 内不重复触发树重建 |
 * | L3 | ViewCommandRegistry | 防抖刷新（debounce 500ms） | refreshViews 命令 500ms 内合并为一次执行 |
 * | 跨层 | refreshBatch（本模块） | 批量暂停/恢复 | batch 期间 L1 只缓冲不分发，L3 只标记不调度；batch 结束后统一 flush + 刷新 |
 *
 * ## 原理
 * - **引用计数**：`batchDepth` 支持嵌套调用，只在最外层 `endBatch` 时触发
 * - **缓冲 + 去重**：UnifiedFileWatcher 在 batch 期间将事件存入 buffer，
 *   batch 结束后调用 `flushAllBufferedEvents()`，对 buffer 按文件名去重后
 *   一次性分发，N 个文件的 N 次写入最终只产生 N 个去重事件（而非 N×M 次回调）
 * - **延迟刷新**：ViewCommandRegistry 在 batch 期间调用 `markRefreshNeeded()`
 *   而非直接调度 setTimeout，batch 结束后仅执行一次 `refreshViews`
 * - **最终一致**：三层策略互相独立、逐级收敛，即使不使用 batch 模式，
 *   单独的 L1+L2+L3 防抖也能有效减少日常编辑的冗余刷新
 *
 * @example
 * ```typescript
 * // LLM 批量创建 10 个笔记：最终只触发 1 次视图刷新（而非 10 次）
 * await withBatchRefresh(async () => {
 *   for (const note of notes) {
 *     await createNote(note);   // 每次写入的文件事件被缓冲
 *   }
 * });
 * // ← endBatchRefresh() → flush 缓冲事件 → 1 次 refreshViews
 * ```
 */

let batchDepth = 0;
let refreshNeeded = false;
const batchEndListeners = new Set<() => void>();

/**
 * 开始批量操作，暂停视图刷新和文件事件分发
 */
export function beginBatchRefresh(): void {
    batchDepth++;
}

/**
 * 结束批量操作
 * 先通知监听者（如 UnifiedFileWatcher）刷新缓冲的事件，
 * 然后如果期间有刷新请求则触发一次统一刷新
 */
export function endBatchRefresh(): void {
    if (batchDepth <= 0) { return; }
    batchDepth--;
    if (batchDepth === 0) {
        // 先通知监听者刷新缓冲的文件事件
        for (const listener of batchEndListeners) {
            try { listener(); } catch { /* ignore */ }
        }
        // 再触发一次统一的视图刷新
        if (refreshNeeded) {
            refreshNeeded = false;
            vscode.commands.executeCommand('issueManager.refreshViews');
        }
    }
}

/**
 * 是否正处于批量操作中
 */
export function isInBatchRefresh(): boolean {
    return batchDepth > 0;
}

/**
 * 标记需要刷新（在 batch 期间由 ViewCommandRegistry 调用）
 */
export function markRefreshNeeded(): void {
    if (batchDepth > 0) {
        refreshNeeded = true;
    }
}

/**
 * 注册 batch 结束监听器（用于 UnifiedFileWatcher 等需要在 batch 结束时刷新缓冲事件的服务）
 */
export function onBatchEnd(callback: () => void): vscode.Disposable {
    batchEndListeners.add(callback);
    return {
        dispose: () => { batchEndListeners.delete(callback); }
    };
}

/**
 * 在批量刷新模式下执行异步函数
 * 函数执行期间所有视图刷新和文件事件分发被暂停，完成后统一触发
 */
export async function withBatchRefresh<T>(fn: () => Promise<T>): Promise<T> {
    beginBatchRefresh();
    try {
        return await fn();
    } finally {
        endBatchRefresh();
    }
}
