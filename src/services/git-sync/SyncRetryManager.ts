import { RetryConfig } from './types';
import { getSyncMaxRetries, getSyncRetryInitialDelay } from '../../config';

/**
 * 同步重试管理器
 * 
 * 实现指数退避重试策略，用于处理临时性同步失败。
 * 主要处理以下场景：
 * - 网络连接错误
 * - 远程仓库暂时不可达
 * - SSH连接超时
 * 
 * 不会重试的场景：
 * - 合并冲突（需要手动解决）
 * - 认证失败（需要重新配置）
 * - Git配置错误（需要手动修复）
 */
export class SyncRetryManager {
    private retryCount: Map<string, number> = new Map();
    private retryTimers: Map<string, NodeJS.Timeout> = new Map();

    /**
     * 获取重试配置
     */
    private getRetryConfig(): RetryConfig {
        return {
            maxRetries: getSyncMaxRetries(),
            initialDelay: getSyncRetryInitialDelay() * 1000, // 转换为毫秒
            backoffMultiplier: 2,
            maxDelay: 300000 // 最大5分钟
        };
    }

    /**
     * 判断错误是否可以重试
     * 
     * @param error 错误对象或错误消息
     * @returns 如果错误可以重试返回true，否则返回false
     */
    public isRetryableError(error: unknown): boolean {
        const errorMessage = this.getErrorMessage(error).toLowerCase();
        
        // 可重试的错误类型
        const retryablePatterns = [
            'network',          // 网络错误
            'connection',       // 连接错误
            'timeout',          // 超时
            'econnreset',       // 连接重置
            'econnrefused',     // 连接被拒绝
            'ssh: connect',     // SSH连接错误
            'could not read from remote', // 无法读取远程
            '网络',
            '连接',
            '超时'
        ];

        // 不可重试的错误类型
        const nonRetryablePatterns = [
            'conflict',         // 合并冲突
            'merge',            // 合并错误
            'authentication',   // 认证错误
            'permission',       // 权限错误
            'access denied',    // 访问被拒绝
            'unauthorized',     // 未授权
            'rebase',          // 变基错误
            '冲突',
            '合并',
            '认证',
            '权限',
            '拒绝访问',
            '未授权',
            '变基'
        ];

        // 首先检查是否是不可重试的错误
        if (nonRetryablePatterns.some(pattern => errorMessage.includes(pattern))) {
            return false;
        }

        // 然后检查是否是可重试的错误
        return retryablePatterns.some(pattern => errorMessage.includes(pattern));
    }

    /**
     * 执行带重试的操作
     * 
     * @param operationId 操作标识符（用于跟踪重试次数）
     * @param operation 要执行的异步操作
     * @param onRetry 重试回调函数
     * @returns 操作结果
     */
    public async executeWithRetry<T>(
        operationId: string,
        operation: () => Promise<T>,
        onRetry?: (attempt: number, nextDelay: number) => void
    ): Promise<T> {
        const config = this.getRetryConfig();
        const currentRetries = this.retryCount.get(operationId) || 0;

        try {
            const result = await operation();
            // 操作成功，重置重试计数
            this.resetRetry(operationId);
            return result;
        } catch (error) {
            // 检查是否可以重试
            if (!this.isRetryableError(error) || currentRetries >= config.maxRetries) {
                // 不可重试或已达最大重试次数，清理并抛出错误
                this.resetRetry(operationId);
                throw error;
            }

            // 计算下次重试的延迟时间（指数退避）
            const attempt = currentRetries + 1;
            const delay = Math.min(
                config.initialDelay * Math.pow(config.backoffMultiplier, currentRetries),
                config.maxDelay
            );

            // 更新重试计数
            this.retryCount.set(operationId, attempt);

            // 通知调用者即将重试
            if (onRetry) {
                onRetry(attempt, delay / 1000); // 转换为秒
            }

            // 等待延迟后重试
            await this.delay(delay);

            // 递归重试
            return this.executeWithRetry(operationId, operation, onRetry);
        }
    }

    /**
     * 取消正在进行的重试
     * 
     * @param operationId 操作标识符
     */
    public cancelRetry(operationId: string): void {
        const timer = this.retryTimers.get(operationId);
        if (timer) {
            clearTimeout(timer);
            this.retryTimers.delete(operationId);
        }
        this.retryCount.delete(operationId);
    }

    /**
     * 重置重试状态
     * 
     * @param operationId 操作标识符
     */
    private resetRetry(operationId: string): void {
        this.retryCount.delete(operationId);
        const timer = this.retryTimers.get(operationId);
        if (timer) {
            clearTimeout(timer);
            this.retryTimers.delete(operationId);
        }
    }

    /**
     * 延迟指定时间
     * 
     * @param ms 延迟时间（毫秒）
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 获取错误消息
     * 
     * @param error 错误对象
     * @returns 错误消息字符串
     */
    private getErrorMessage(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        } else if (typeof error === 'string') {
            return error;
        }
        return String(error);
    }

    /**
     * 获取当前重试次数
     * 
     * @param operationId 操作标识符
     * @returns 当前重试次数
     */
    public getRetryCount(operationId: string): number {
        return this.retryCount.get(operationId) || 0;
    }

    /**
     * 清理所有重试状态
     */
    public cleanup(): void {
        // 取消所有定时器
        this.retryTimers.forEach(timer => clearTimeout(timer));
        this.retryTimers.clear();
        this.retryCount.clear();
    }
}
