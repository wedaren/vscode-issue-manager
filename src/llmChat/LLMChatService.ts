/**
 * LLM 聊天服务
 *
 * 管理聊天会话生命周期、调用 LLM 并将消息持久化到 issueMarkdown。
 */
import * as vscode from 'vscode';
import {
    getChatRoleById,
    createConversation,
    appendMessageToConversation,
    getConversationConfig,
} from './llmChatDataManager';
import type { ChatRoleInfo } from './types';
import { Logger } from '../core/utils/Logger';
import { executeConversation as execConversation } from './ConversationExecutor';
import { ExecutionContext } from './ExecutionContext';

const logger = Logger.getInstance();

export class LLMChatService {
    private static instance: LLMChatService;

    /** 当前活跃的对话 URI */
    private _activeConversationUri: vscode.Uri | undefined;
    /** 当前活跃对话关联的角色 */
    private _activeRole: ChatRoleInfo | undefined;

    private _onDidSendMessage = new vscode.EventEmitter<{ uri: vscode.Uri; role: 'user' | 'assistant'; content: string; roleName?: string }>();
    readonly onDidSendMessage = this._onDidSendMessage.event;

    private constructor() {}

    static getInstance(): LLMChatService {
        if (!LLMChatService.instance) {
            LLMChatService.instance = new LLMChatService();
        }
        return LLMChatService.instance;
    }

    get activeConversationUri(): vscode.Uri | undefined {
        return this._activeConversationUri;
    }

    get activeRole(): ChatRoleInfo | undefined {
        return this._activeRole;
    }

    /** 设置当前活跃对话 */
    async setActiveConversation(uri: vscode.Uri, roleId: string): Promise<void> {
        this._activeConversationUri = uri;
        this._activeRole = await getChatRoleById(roleId);
        logger.info(`[LLMChat] 设置活跃对话: ${uri.fsPath}, 角色: ${this._activeRole?.name ?? roleId}`);
    }

    /** 为指定角色创建新对话并设为活跃 */
    async startNewConversation(roleId: string): Promise<vscode.Uri | null> {
        const uri = await createConversation(roleId);
        if (!uri) {
            vscode.window.showErrorMessage('创建对话失败');
            return null;
        }
        await this.setActiveConversation(uri, roleId);
        return uri;
    }

    /**
     * 向当前活跃对话发送用户消息，并获取 LLM 回复。
     * 通过 ConversationExecutor 统一执行引擎处理（含工具调用、token 门禁、日志）。
     */
    async sendMessage(
        userMessage: string,
        options?: { signal?: AbortSignal },
    ): Promise<string | null> {
        const uri = this._activeConversationUri;
        if (!uri) {
            vscode.window.showWarningMessage('请先选择或新建一个对话');
            return null;
        }

        await appendMessageToConversation(uri, 'user', userMessage);
        this._onDidSendMessage.fire({ uri, role: 'user', content: userMessage });

        try {
            const convoConfig = await getConversationConfig(uri);
            const ctx = await ExecutionContext.create({
                role: this._activeRole!,
                conversationUri: uri,
                signal: options?.signal,
                trigger: 'direct',
                autonomous: convoConfig?.autonomous ?? this._activeRole!.autonomous ?? false,
                logEnabled: convoConfig?.logEnabled ?? this._activeRole!.logEnabled ?? false,
                toolTimeout: this._activeRole!.timerToolTimeout,
            });
            const result = await execConversation(uri, this._activeRole!, { trigger: 'direct', ctx });

            const fullReply = result.toolPrologue
                ? result.toolPrologue + '\n\n' + result.text
                : result.text;
            await appendMessageToConversation(uri, 'assistant', fullReply);
            this._onDidSendMessage.fire({ uri, role: 'assistant', content: result.text });

            return result.text;
        } catch (e) {
            if (options?.signal?.aborted) { return null; }
            const errMsg = e instanceof Error ? e.message : String(e);
            logger.error('[LLMChat] 发送消息失败', e);
            vscode.window.showErrorMessage(`LLM 回复失败: ${errMsg}`);
            return null;
        }
    }

    /**
     * 流式发送消息并回调每个 chunk（支持工具调用）。
     * 通过 ConversationExecutor 统一执行引擎处理。
     */
    async sendMessageStream(
        userMessage: string,
        onChunk: (chunk: string) => void,
        options?: {
            signal?: AbortSignal;
            /** 工具调用状态回调 */
            onToolStatus?: (status: { toolName: string; phase: 'calling' | 'done'; result?: string }) => void;
        },
    ): Promise<string | null> {
        const uri = this._activeConversationUri;
        if (!uri) {
            vscode.window.showWarningMessage('请先选择或新建一个对话');
            return null;
        }

        await appendMessageToConversation(uri, 'user', userMessage);
        this._onDidSendMessage.fire({ uri, role: 'user', content: userMessage });

        try {
            const convoConfig = await getConversationConfig(uri);
            const ctx = await ExecutionContext.create({
                role: this._activeRole!,
                conversationUri: uri,
                signal: options?.signal,
                trigger: 'direct',
                autonomous: convoConfig?.autonomous ?? this._activeRole!.autonomous ?? false,
                logEnabled: convoConfig?.logEnabled ?? this._activeRole!.logEnabled ?? false,
                toolTimeout: this._activeRole!.timerToolTimeout,
                onChunk,
                onToolStatus: options?.onToolStatus,
            });
            const result = await execConversation(uri, this._activeRole!, { trigger: 'direct', ctx });

            // 写入回复
            const fullReply = result.toolPrologue
                ? result.toolPrologue + '\n\n' + result.text
                : result.text;
            await appendMessageToConversation(uri, 'assistant', fullReply);
            this._onDidSendMessage.fire({ uri, role: 'assistant', content: result.text });

            return result.text;
        } catch (e) {
            if (options?.signal?.aborted) { return null; }
            const errMsg = e instanceof Error ? e.message : String(e);
            logger.error('[LLMChat] 流式发送失败', e);
            vscode.window.showErrorMessage(`LLM 回复失败: ${errMsg}`);
            return null;
        }
    }

    dispose(): void {
        this._onDidSendMessage.dispose();
    }
}

