/**
 * MCP 管理器（单例）
 *
 * 管理所有 MCP server 连接，提供统一的工具查询和调用接口。
 * 替代原先对 vscode.lm.tools / vscode.lm.invokeTool 的依赖。
 */
import * as vscode from 'vscode';
import { McpClientWrapper } from './McpClientWrapper';
import * as mcpConfigStore from './mcpConfigStore';
import type { McpToolDescriptor, McpToolResult, McpServerStatus, McpServerConfig } from './mcpTypes';
import { Logger } from '../../core/utils/Logger';

const logger = Logger.getInstance();

export class McpManager implements vscode.Disposable {
    private static _instance: McpManager | undefined;
    private clients = new Map<string, McpClientWrapper>();
    private configListener: vscode.Disposable | undefined;
    private _initialized = false;

    private _onDidChangeTools = new vscode.EventEmitter<void>();
    readonly onDidChangeTools: vscode.Event<void> = this._onDidChangeTools.event;

    private constructor() {}

    static getInstance(): McpManager {
        if (!McpManager._instance) {
            McpManager._instance = new McpManager();
        }
        return McpManager._instance;
    }

    /** 初始化：读取配置，连接所有 enabled server */
    async initialize(context: vscode.ExtensionContext): Promise<void> {
        if (this._initialized) { return; }
        this._initialized = true;

        mcpConfigStore.initialize(context.globalStorageUri);

        // 监听配置变更
        this.configListener = mcpConfigStore.onDidChangeConfig(() => {
            void this.syncServers();
        });

        await this.syncServers();
    }

    /** 根据当前配置同步 server 连接 */
    private async syncServers(): Promise<void> {
        const configs = mcpConfigStore.loadConfig().servers;
        const desiredIds = new Set(
            Object.entries(configs)
                .filter(([, cfg]) => cfg.enabled !== false)
                .map(([id]) => id),
        );

        // 断开已移除或已禁用的 server
        for (const [id, wrapper] of this.clients) {
            if (!desiredIds.has(id)) {
                wrapper.dispose();
                this.clients.delete(id);
                logger.info(`[MCP] server "${id}" 已断开（配置移除或禁用）`);
            }
        }

        // 连接新增的 server
        const connectPromises: Promise<void>[] = [];
        for (const id of desiredIds) {
            if (!this.clients.has(id)) {
                const cfg = configs[id];
                connectPromises.push(this.connectServer(id, cfg));
            }
        }

        if (connectPromises.length > 0) {
            await Promise.allSettled(connectPromises);
        }

        this._onDidChangeTools.fire();
    }

    /** 连接单个 server（失败不抛出，仅记录） */
    private async connectServer(id: string, config: McpServerConfig): Promise<void> {
        const wrapper = new McpClientWrapper(id, config);
        this.clients.set(id, wrapper);
        try {
            await wrapper.connect();
        } catch {
            // 错误已在 wrapper 中记录，这里保持 map 中的 wrapper 以便 UI 显示状态
        }
    }

    // ─── 工具查询 API ────────────────────────────────────────

    /** 获取所有已连接 server 的工具 */
    getAllTools(): McpToolDescriptor[] {
        const result: McpToolDescriptor[] = [];
        for (const wrapper of this.clients.values()) {
            if (wrapper.connected) {
                result.push(...wrapper.tools);
            }
        }
        return result;
    }

    /**
     * 按 server 名称列表筛选工具（匹配角色的 mcpServers 配置）。
     * 支持 "*" 通配符表示引入所有。
     */
    getToolsByServers(serverNames: string[]): McpToolDescriptor[] {
        if (!serverNames || serverNames.length === 0) { return []; }
        if (serverNames.includes('*')) { return this.getAllTools(); }

        const result: McpToolDescriptor[] = [];
        for (const name of serverNames) {
            const wrapper = this.clients.get(name);
            if (wrapper?.connected) {
                result.push(...wrapper.tools);
            }
        }
        return result;
    }

    /** 获取 server → 工具列表的映射（供 UI 展示） */
    getServersWithTools(): Map<string, McpToolDescriptor[]> {
        const result = new Map<string, McpToolDescriptor[]>();
        for (const [id, wrapper] of this.clients) {
            result.set(id, wrapper.connected ? [...wrapper.tools] : []);
        }
        return result;
    }

    // ─── 工具调用 API ────────────────────────────────────────

    /**
     * 调用工具（传入完整的 qualified name，如 "mcp_memory_search"）。
     * 内部解析 serverId + originalName 后委派给对应的 wrapper。
     */
    async invokeTool(qualifiedName: string, input: Record<string, unknown>): Promise<McpToolResult> {
        // 解析 mcp_{serverId}_{toolName}
        const match = qualifiedName.match(/^mcp_([^_]+)_(.+)$/);
        if (!match) {
            return { success: false, content: `无法解析工具名: ${qualifiedName}` };
        }
        const [, serverId, toolName] = match;

        const wrapper = this.clients.get(serverId);
        if (!wrapper) {
            return { success: false, content: `MCP server "${serverId}" 未配置` };
        }
        if (!wrapper.connected) {
            return { success: false, content: `MCP server "${serverId}" 未连接` };
        }

        return wrapper.invokeTool(toolName, input);
    }

    /** 判断一个工具名是否属于 MCP 工具 */
    isMcpTool(toolName: string): boolean {
        return /^mcp_[^_]+_.+$/.test(toolName) &&
            this.getAllTools().some(t => t.name === toolName);
    }

    // ─── Server 管理 API ────────────────────────────────────

    /** 获取所有 server 状态 */
    getServerStatuses(): McpServerStatus[] {
        const configs = mcpConfigStore.getServers();
        return configs.map(cfg => {
            const wrapper = this.clients.get(cfg.id);
            return {
                name: cfg.id,
                connected: wrapper?.connected ?? false,
                toolCount: wrapper?.tools.length ?? 0,
                error: wrapper?.error,
            };
        });
    }

    /** 重启指定 server，返回是否连接成功 */
    async restartServer(serverId: string): Promise<{ connected: boolean; error?: string }> {
        const existing = this.clients.get(serverId);
        if (existing) {
            existing.dispose();
            this.clients.delete(serverId);
        }

        const configs = mcpConfigStore.loadConfig().servers;
        const cfg = configs[serverId];
        if (cfg && cfg.enabled !== false) {
            await this.connectServer(serverId, cfg);
        }

        this._onDidChangeTools.fire();

        const wrapper = this.clients.get(serverId);
        return {
            connected: wrapper?.connected ?? false,
            error: wrapper?.error,
        };
    }

    /** 重启所有 server */
    async restartAll(): Promise<void> {
        for (const wrapper of this.clients.values()) {
            wrapper.dispose();
        }
        this.clients.clear();
        await this.syncServers();
    }

    // ─── 生命周期 ─────────────────────────────────────────

    dispose(): void {
        for (const wrapper of this.clients.values()) {
            wrapper.dispose();
        }
        this.clients.clear();
        this.configListener?.dispose();
        this._onDidChangeTools.dispose();
        mcpConfigStore.dispose();
        McpManager._instance = undefined;
    }
}
