import * as vscode from 'vscode';

/**
 * 基础命令注册器
 * 
 * 为所有命令注册器提供通用功能和基础设施，
 * 包括上下文管理和错误处理机制。
 * 
 * @abstract
 */
export abstract class BaseCommandRegistry {
    protected readonly context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * 注册命令的通用方法
     * 
     * 提供统一的命令注册接口，包含错误处理和日志记录
     * 
     * @param commandId 命令标识符
     * @param callback 命令回调函数
     * @param errorContext 错误上下文描述
     */
    protected registerCommand(
        commandId: string, 
        callback: (...args: any[]) => any, 
        errorContext: string = commandId
    ): void {
        try {
            const disposable = vscode.commands.registerCommand(commandId, async (...args) => {
                try {
                    await callback(...args);
                } catch (error) {
                    console.error(`命令 ${commandId} 执行失败:`, error);
                    vscode.window.showErrorMessage(`${errorContext} 操作失败: ${error instanceof Error ? error.message : '未知错误'}`);
                }
            });
            
            this.context.subscriptions.push(disposable);
            console.log(`  ✓ 注册命令: ${commandId}`);
            
        } catch (error) {
            console.error(`注册命令 ${commandId} 失败:`, error);
            throw new Error(`命令注册失败: ${commandId}`);
        }
    }

    /**
     * 注册此类别的所有命令
     * 
     * 子类必须实现此方法来注册具体的命令
     * 
     * @abstract
     */
    public abstract registerCommands(): void;
}