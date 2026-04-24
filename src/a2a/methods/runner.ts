/**
 * Task 执行器 — message/send 与 message/stream 共享的核心逻辑。
 *
 * 流程：
 *   1. 校验参数与角色
 *   2. 获取/创建 contextId 对应的对话文件
 *   3. 创建 task（submitted → working）并调用 callbacks.onStart
 *   4. 执行 executeConversation，流式 chunk 通过 callbacks.onChunk 透传
 *   5. 终态（completed/failed/canceled）更新 task.status
 *
 * `onStart` 在 task 进入 working 状态前触发，用于 SSE 发送初始 Task 事件。
 * `onChunk` 在 LLM 每个流式 chunk 到达时触发，用于 SSE 发送 artifact-update。
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Logger } from '../../core/utils/Logger';
import {
    createConversation,
    appendMessageToConversation,
    A2A_TASKS_SUBDIR,
} from '../../llmChat/llmChatDataManager';
import { ExecutionContext } from '../../llmChat/ExecutionContext';
import { executeConversation } from '../../llmChat/ConversationExecutor';
import { RoleTimerManager } from '../../llmChat/RoleTimerManager';
import { ImageStorageService } from '../../services/storage/ImageStorageService';
import { findExposedRole } from '../agentCard';
import { JsonRpcError } from '../jsonRpc';
import type { TaskStore, TaskRecord, TaskStreamEvent } from '../taskStore';
import {
    A2A_ERROR,
    JSONRPC_ERROR,
    isFileWithBytes,
} from '../types';
import type {
    A2ATask,
    A2AMessage,
    A2APart,
    A2ATaskState,
    A2ATextPart,
    A2AFilePart,
} from '../types';

const logger = Logger.getInstance();

// ─── 参数校验 ────────────────────────────────────────────────

export interface ValidatedSendParams {
    message: {
        role?: string;
        textParts: A2ATextPart[];
        fileParts: A2AFilePart[];
        messageId?: string;
        contextId?: string;
    };
}

export function validateSendParams(raw: unknown): ValidatedSendParams {
    if (!raw || typeof raw !== 'object') {
        throw new JsonRpcError(JSONRPC_ERROR.InvalidParams, 'params 必须是对象');
    }
    const obj = raw as Record<string, unknown>;
    const message = obj.message;
    if (!message || typeof message !== 'object') {
        throw new JsonRpcError(JSONRPC_ERROR.InvalidParams, 'params.message 必填');
    }
    const msg = message as Record<string, unknown>;
    if (!Array.isArray(msg.parts) || msg.parts.length === 0) {
        throw new JsonRpcError(JSONRPC_ERROR.InvalidParams, 'params.message.parts 必填且至少一个 part');
    }

    const textParts: A2ATextPart[] = [];
    const fileParts: A2AFilePart[] = [];
    for (const p of msg.parts) {
        if (!p || typeof p !== 'object') { continue; }
        const rec = p as Record<string, unknown>;
        if (typeof rec.text === 'string') {
            textParts.push({ text: rec.text });
        } else if (rec.file && typeof rec.file === 'object') {
            fileParts.push(p as A2AFilePart);
        }
        // 其它类型（DataPart 等）静默忽略
    }
    if (textParts.length === 0 && fileParts.length === 0) {
        throw new JsonRpcError(A2A_ERROR.ContentTypeNotSupported, 'message 中未找到可处理的 text 或 file part');
    }

    return {
        message: {
            role: typeof msg.role === 'string' ? msg.role : undefined,
            textParts,
            fileParts,
            messageId: typeof msg.messageId === 'string' ? msg.messageId : undefined,
            contextId: typeof msg.contextId === 'string' ? msg.contextId : undefined,
        },
    };
}

/**
 * 将入方向消息（text + file parts）构造为写入对话文件的单段文本：
 * 文本部分保留原样；每个 file part 保存到 ImageDir 后追加 `![name](ImageDir/xxx)` 引用，
 * messageBuilder 后续会把这些引用还原为 LLM 多模态 DataPart。
 */
export async function buildUserMessageBody(params: ValidatedSendParams): Promise<string> {
    const textBody = params.message.textParts.map(p => p.text).join('\n').trim();
    const imageRefs: string[] = [];
    for (const fp of params.message.fileParts) {
        const saved = await saveIncomingFilePart(fp);
        if (saved) {
            imageRefs.push(`![${saved.name}](${saved.relativePath})`);
        } else {
            imageRefs.push('[附件无法保存]');
        }
    }
    if (imageRefs.length === 0) { return textBody; }
    return textBody ? `${textBody}\n\n${imageRefs.join('\n')}` : imageRefs.join('\n');
}

/** 仅处理 fileWithBytes + image/* MIME；其它形式记录 warning 并返回 undefined。 */
async function saveIncomingFilePart(fp: A2AFilePart): Promise<{ name: string; relativePath: string } | undefined> {
    if (!isFileWithBytes(fp.file)) {
        logger.warn('[A2A] 入方向 fileWithUri 暂未实现 fetch，已跳过该 part');
        return undefined;
    }
    const f = fp.file;
    const mimeType = f.mimeType ?? 'image/png';
    if (!mimeType.startsWith('image/')) {
        logger.warn(`[A2A] 跳过非图片 FilePart（mimeType=${mimeType}）`);
        return undefined;
    }
    const relativePath = await ImageStorageService.saveBase64(f.bytes, mimeType, f.name, 'a2a');
    if (!relativePath) {
        logger.warn(`[A2A] 保存 FilePart 失败（可能 imageDir 未配置）：${f.name ?? '<unnamed>'}`);
        return undefined;
    }
    return { name: f.name ?? path.basename(relativePath), relativePath };
}

// ─── 执行 hook ──────────────────────────────────────────────

export interface TaskRunHooks {
    /**
     * task 记录创建后、执行开始前**同步**触发。
     * 调用方应在此时订阅 record.events，以确保不遗漏任何事件。
     */
    onStart?: (record: TaskRecord) => void;
}

// ─── 核心执行器 ──────────────────────────────────────────────

/**
 * 执行一次 A2A task：同步等到终态（completed/failed/canceled），返回最终 task。
 *
 * 执行期间通过 `record.events` 推送状态变更与 artifact chunk，供 SSE 订阅者消费。
 * 调用方在 `onStart` 中订阅事件 — 该 hook 在任何事件 fire 之前同步执行。
 */
export async function runTask(
    agentId: string,
    store: TaskStore,
    params: ValidatedSendParams,
    hooks?: TaskRunHooks,
): Promise<A2ATask> {
    const role = findExposedRole(agentId);
    if (!role) {
        throw new JsonRpcError(JSONRPC_ERROR.InvalidParams, `agent "${agentId}" 不存在或未暴露`);
    }

    const userText = await buildUserMessageBody(params);
    const contextId = params.message.contextId ?? store.generateContextId();

    return store.withContextLock(contextId, async () => {
        const convoUri = await ensureConversation(store, contextId, role.id, userText);

        // 创建 task 记录（submitted）— 此时尚无订阅者
        const record = store.createTask(contextId);
        store.setConversationUri(record.task.id, convoUri);

        // onStart 必须同步订阅 events；任何异步都会漏掉首个事件
        hooks?.onStart?.(record);

        // 切到 working 状态并发射第一次 status-update
        store.updateStatus(record.task.id, 'TASK_STATE_WORKING');
        record.events.fire(statusUpdateEvent(record.task, false));
        await appendMessageToConversation(convoUri, 'user', userText);

        // 注册到 RoleTimerManager 的 executing 集合 — 让状态栏 / 树视图 spinner 能感知 A2A 任务
        const timerMgr = RoleTimerManager.getInstance();
        timerMgr.registerExecution(convoUri);
        let execSuccess = false;

        const artifactId = `artifact-${crypto.randomBytes(6).toString('hex')}`;
        let chunkCount = 0;

        try {
            const execCtx = await ExecutionContext.create({
                role,
                conversationUri: convoUri,
                signal: record.abortController.signal,
                trigger: 'a2a',
                autonomous: true,
                // A2A 外部调用默认强制开启日志（设计决策：失败也要可审计）
                logEnabled: true,
                toolTimeout: role.timerToolTimeout,
                onChunk: (chunk: string) => {
                    chunkCount++;
                    record.events.fire({
                        kind: 'artifact-update',
                        taskId: record.task.id,
                        contextId,
                        artifactId,
                        text: chunk,
                        append: chunkCount > 1,
                        lastChunk: false,
                    } satisfies TaskStreamEvent);
                },
            });

            const result = await executeConversation(convoUri, role, {
                trigger: 'a2a',
                ctx: execCtx,
            });

            const fullReply = result.toolPrologue
                ? `${result.toolPrologue}\n\n${result.text}`
                : result.text;
            await appendMessageToConversation(convoUri, 'assistant', fullReply);

            const agentMessage = await buildAgentMessage(record, contextId, result.text);
            store.updateStatus(record.task.id, 'TASK_STATE_COMPLETED', agentMessage);
            execSuccess = true;
        } catch (e) {
            const isAbort = record.abortController.signal.aborted;
            const state: A2ATaskState = isAbort ? 'TASK_STATE_CANCELED' : 'TASK_STATE_FAILED';
            const errMsg = e instanceof Error ? e.message : String(e);
            logger.warn(`[A2A] task ${record.task.id} ${state}: ${errMsg}`);
            const errorMessage = await buildAgentMessage(record, contextId, errMsg);
            store.updateStatus(record.task.id, state, errorMessage);
        } finally {
            timerMgr.unregisterExecution(convoUri, role.id, execSuccess);
        }

        // 最终事件：终态（final=true）— 订阅者据此关闭 SSE 连接
        record.events.fire(statusUpdateEvent(record.task, true));
        return record.task;
    });
}

function statusUpdateEvent(task: A2ATask, final: boolean): TaskStreamEvent {
    return {
        kind: 'status-update',
        taskId: task.id,
        contextId: task.contextId,
        task,
        final,
    };
}

// ─── 辅助 ────────────────────────────────────────────────────

async function ensureConversation(
    store: TaskStore,
    contextId: string,
    roleId: string,
    userText: string,
): Promise<vscode.Uri> {
    let convoUri = store.getConvoForContext(contextId);
    if (convoUri) { return convoUri; }

    const titleHint = userText.length > 40 ? userText.slice(0, 40) + '…' : userText;
    const created = await createConversation(roleId, {
        title: `[A2A] ${titleHint}`,
        subdir: A2A_TASKS_SUBDIR,
        extraFrontmatter: { a2a_context_id: contextId },
    });
    if (!created) {
        throw new JsonRpcError(JSONRPC_ERROR.InternalError, '创建对话文件失败');
    }
    convoUri = created;
    store.setConvoForContext(contextId, convoUri);
    return convoUri;
}

/**
 * 构造出方向 A2A agent message：
 * - 首个 part 始终是原文本 TextPart（保留 `![](ImageDir/...)` 引用，远端有 markdown 渲染能力的可直接显示）
 * - 扫描 text 中的 ImageDir/ 图片引用，每个附加一个 inline base64 FilePart，
 *   让没有本地文件系统访问的远端 agent 也能真正拿到图像数据
 */
async function buildAgentMessage(record: TaskRecord, contextId: string, text: string): Promise<A2AMessage> {
    const parts: A2APart[] = [{ text } satisfies A2ATextPart];
    const seen = new Set<string>();
    for (const match of text.matchAll(/!\[[^\]]*\]\((ImageDir\/[^)\s]+)\)/g)) {
        const relPath = match[1];
        if (seen.has(relPath)) { continue; }
        seen.add(relPath);
        const filePart = await readImageAsFilePart(relPath);
        if (filePart) { parts.push(filePart); }
    }
    return {
        role: 'ROLE_AGENT',
        parts,
        messageId: crypto.randomUUID(),
        taskId: record.task.id,
        contextId,
    };
}

async function readImageAsFilePart(relPath: string): Promise<A2AFilePart | undefined> {
    const uri = ImageStorageService.resolve(relPath);
    if (!uri) { return undefined; }
    try {
        const buf = await fs.promises.readFile(uri.fsPath);
        return {
            file: {
                name: path.basename(uri.fsPath),
                mimeType: guessImageMime(uri.fsPath),
                bytes: buf.toString('base64'),
            },
        };
    } catch (e) {
        logger.warn(`[A2A] 读取图片失败，跳过 FilePart：${relPath}`, e);
        return undefined;
    }
}

function guessImageMime(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case '.png':  return 'image/png';
        case '.jpg':
        case '.jpeg': return 'image/jpeg';
        case '.gif':  return 'image/gif';
        case '.webp': return 'image/webp';
        case '.svg':  return 'image/svg+xml';
        default:      return 'application/octet-stream';
    }
}
