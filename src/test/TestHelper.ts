import * as vscode from 'vscode';

/**
 * 测试辅助工具类，用于模拟配置和VS Code环境
 */
export class TestHelper {
    private static originalConfig: any;
    private static mockConfig: Map<string, any> = new Map();

    /**
     * 设置模拟配置值
     */
    static setMockConfig(key: string, value: any): void {
        this.mockConfig.set(key, value);
    }

    /**
     * 清除所有模拟配置
     */
    static clearMockConfig(): void {
        this.mockConfig.clear();
    }

    /**
     * 模拟VS Code配置
     */
    static mockVSCodeConfig(): void {
        if (!this.originalConfig) {
            this.originalConfig = vscode.workspace.getConfiguration;
        }

        vscode.workspace.getConfiguration = (section?: string) => {
            return {
                get: <T>(key: string, defaultValue?: T): T => {
                    const fullKey = section ? `${section}.${key}` : key;
                    if (this.mockConfig.has(fullKey)) {
                        return this.mockConfig.get(fullKey) as T;
                    }
                    return defaultValue as T;
                },
                has: (key: string): boolean => {
                    const fullKey = section ? `${section}.${key}` : key;
                    return this.mockConfig.has(fullKey);
                },
                inspect: () => ({}),
                update: async () => {}
            } as any;
        };
    }

    /**
     * 恢复原始VS Code配置
     */
    static restoreVSCodeConfig(): void {
        if (this.originalConfig) {
            vscode.workspace.getConfiguration = this.originalConfig;
            this.originalConfig = null;
        }
    }

    /**
     * 创建临时Git仓库用于测试
     */
    static async createTempGitRepo(baseDir: string): Promise<void> {
        const { simpleGit } = require('simple-git');
        const git = simpleGit(baseDir);
        
        await git.init();
        await git.addConfig('user.name', 'Test User');
        await git.addConfig('user.email', 'test@example.com');
        
        // 创建初始提交
        const fs = require('fs');
        const path = require('path');
        const initFile = path.join(baseDir, 'README.md');
        fs.writeFileSync(initFile, '# Test Repository\n');
        
        await git.add('.');
        await git.commit('Initial commit');
    }

    /**
     * 模拟文件变更
     */
    static simulateFileChange(filePath: string, content: string): void {
        const fs = require('fs');
        const path = require('path');
        
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        fs.writeFileSync(filePath, content);
    }

    /**
     * 等待指定时间
     */
    static async wait(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 模拟VS Code命令执行
     */
    static mockVSCodeCommands(): Map<string, (...args: any[]) => any> {
        const commandMap = new Map();
        const originalExecuteCommand = vscode.commands.executeCommand;
        
        vscode.commands.executeCommand = async (command: string, ...args: any[]) => {
            if (commandMap.has(command)) {
                return commandMap.get(command)(...args);
            }
            // 对于测试中不需要的命令，返回空的Promise
            return Promise.resolve();
        };
        
        return commandMap;
    }

    /**
     * 恢复VS Code命令执行
     */
    static restoreVSCodeCommands(originalExecuteCommand: any): void {
        vscode.commands.executeCommand = originalExecuteCommand;
    }
}

/**
 * 测试用的假Git操作类
 */
export class MockGitOperations {
    private static hasLocalChanges = false;
    private static hasConflicts = false;
    private static shouldThrowError = false;
    private static errorMessage = '';

    static setHasLocalChanges(value: boolean): void {
        this.hasLocalChanges = value;
    }

    static setHasConflicts(value: boolean): void {
        this.hasConflicts = value;
    }

    static setShouldThrowError(shouldThrow: boolean, message = 'Mock error'): void {
        this.shouldThrowError = shouldThrow;
        this.errorMessage = message;
    }

    static reset(): void {
        this.hasLocalChanges = false;
        this.hasConflicts = false;
        this.shouldThrowError = false;
        this.errorMessage = '';
    }

    // 可以被GitSyncService使用的模拟方法
    static async mockPullChanges(): Promise<void> {
        if (this.shouldThrowError) {
            throw new Error(this.errorMessage);
        }
        // 模拟成功的拉取操作
    }

    static async mockHasLocalChanges(): Promise<boolean> {
        if (this.shouldThrowError) {
            throw new Error(this.errorMessage);
        }
        return this.hasLocalChanges;
    }

    static async mockHasConflicts(): Promise<boolean> {
        if (this.shouldThrowError) {
            throw new Error(this.errorMessage);
        }
        return this.hasConflicts;
    }

    static async mockCommitAndPush(): Promise<void> {
        if (this.shouldThrowError) {
            throw new Error(this.errorMessage);
        }
        // 模拟成功的提交和推送
    }
}
