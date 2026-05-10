/**
 * 模型认证错误注册表
 *
 * 内存中追踪哪些模型 ID 发生过 401/403 认证失败，
 * 通过 EventEmitter 通知树视图刷新以显示 ⚠️ 警告图标。
 */
import * as vscode from 'vscode';

export class ModelAuthErrorRegistry {
    private static readonly _errors = new Set<string>();
    private static readonly _emitter = new vscode.EventEmitter<void>();

    /** 任意模型错误状态变更时触发 */
    static readonly onDidChange: vscode.Event<void> = ModelAuthErrorRegistry._emitter.event;

    /**
     * 标记指定模型 ID 有认证错误。
     * @param modelId - 模型 ID（如 'deepseek/deepseek-chat-v3-5'）
     */
    static markError(modelId: string): void {
        if (!modelId || ModelAuthErrorRegistry._errors.has(modelId)) { return; }
        ModelAuthErrorRegistry._errors.add(modelId);
        ModelAuthErrorRegistry._emitter.fire();
    }

    /**
     * 清除指定模型 ID 的认证错误状态。
     * @param modelId - 模型 ID
     */
    static clearError(modelId: string): void {
        if (!ModelAuthErrorRegistry._errors.has(modelId)) { return; }
        ModelAuthErrorRegistry._errors.delete(modelId);
        ModelAuthErrorRegistry._emitter.fire();
    }

    /**
     * 查询指定模型 ID 是否有认证错误。
     * @param modelId - 模型 ID
     * @returns 是否存在未清除的认证错误
     */
    static hasError(modelId: string): boolean {
        return ModelAuthErrorRegistry._errors.has(modelId);
    }
}
