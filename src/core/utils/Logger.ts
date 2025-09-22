import * as vscode from 'vscode';

/**
 * 日志级别枚举
 */
export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}

/**
 * 日志管理器
 * 
 * 提供结构化的日志记录功能，支持不同的日志级别
 * 和输出通道管理。替代直接使用console的方式，
 * 提供更好的调试和生产环境支持。
 * 
 * @example
 * ```typescript
 * const logger = Logger.getInstance();
 * logger.info('扩展初始化开始');
 * logger.error('初始化失败', error);
 * ```
 */
export class Logger {
    private static instance: Logger;
    private outputChannel: vscode.OutputChannel;
    private logLevel: LogLevel;

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Issue Manager');
        this.logLevel = LogLevel.INFO;
    }

    /**
     * 获取日志管理器单例实例
     */
    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    /**
     * 设置日志级别
     * 
     * @param level 要设置的日志级别
     */
    public setLogLevel(level: LogLevel): void {
        this.logLevel = level;
    }

    /**
     * 记录调试信息
     * 
     * @param message 日志消息
     * @param data 可选的附加数据
     */
    public debug(message: string, data?: unknown): void {
        this.log(LogLevel.DEBUG, message, data);
    }

    /**
     * 记录信息日志
     * 
     * @param message 日志消息
     * @param data 可选的附加数据
     */
    public info(message: string, data?: unknown): void {
        this.log(LogLevel.INFO, message, data);
    }

    /**
     * 记录警告日志
     * 
     * @param message 日志消息
     * @param data 可选的附加数据
     */
    public warn(message: string, data?: unknown): void {
        this.log(LogLevel.WARN, message, data);
    }

    /**
     * 记录错误日志
     * 
     * @param message 日志消息
     * @param error 错误对象或附加数据
     */
    public error(message: string, error?: unknown): void {
        this.log(LogLevel.ERROR, message, error);
    }

    /**
     * 显示输出通道
     */
    public show(): void {
        this.outputChannel.show();
    }

    /**
     * 内部日志记录方法
     * 
     * @param level 日志级别
     * @param message 日志消息
     * @param data 可选的附加数据
     */
    private log(level: LogLevel, message: string, data?: unknown): void {
        if (level < this.logLevel) {
            return;
        }

        const timestamp = new Date().toISOString();
        const levelText = LogLevel[level];
        const logMessage = `[${timestamp}] [${levelText}] ${message}`;

        // 输出到VS Code输出通道
        this.outputChannel.appendLine(logMessage);

        if (data) {
            this.outputChannel.appendLine(`  Data: ${JSON.stringify(data, null, 2)}`);
        }

        // 在开发模式下也输出到控制台
        if (vscode.env.machineId === 'someValue') { // 开发环境检测
            switch (level) {
                case LogLevel.DEBUG:
                    console.debug(logMessage, data);
                    break;
                case LogLevel.INFO:
                    console.info(logMessage, data);
                    break;
                case LogLevel.WARN:
                    console.warn(logMessage, data);
                    break;
                case LogLevel.ERROR:
                    console.error(logMessage, data);
                    break;
            }
        }
    }

    /**
     * 清理资源
     */
    public dispose(): void {
        this.outputChannel.dispose();
    }
}