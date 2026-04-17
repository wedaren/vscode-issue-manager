/**
 * 单个 MCP Server 连接封装
 *
 * 通过 @modelcontextprotocol/sdk 的 Client + StdioClientTransport
 * 管理一个 MCP server 进程的生命周期：连接、列工具、调工具、断开。
 */
import * as vscode from 'vscode';
import { Client } from '@modelcontextprotocol/sdk/client';
// SDK 的 "./*" wildcard export 将 client/stdio.js → dist/cjs/client/stdio.js
// 注意必须带 .js 后缀，因为 wildcard 映射 "./dist/cjs/*" 不自动补扩展名
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpServerConfig, McpToolDescriptor, McpToolResult } from './mcpTypes';
import { Logger } from '../../core/utils/Logger';
import { resolveShellEnvironment } from '../../core/ShellEnvironmentResolver';

const logger = Logger.getInstance();

export class McpClientWrapper implements vscode.Disposable {
    private client: Client | undefined;
    private transport: InstanceType<typeof StdioClientTransport> | undefined;
    private _connected = false;
    private _tools: McpToolDescriptor[] = [];
    private _error: string | undefined;

    constructor(
        readonly serverId: string,
        private readonly config: McpServerConfig,
    ) {}

    get connected(): boolean { return this._connected; }
    get tools(): McpToolDescriptor[] { return this._tools; }
    get error(): string | undefined { return this._error; }

    /** 连接 server 并发现工具 */
    async connect(): Promise<void> {
        this._error = undefined;
        try {
            // 使用 ShellEnvironmentResolver 获取完整的用户 shell 环境（含 nvm/pyenv/homebrew 等 PATH）
            const baseEnv = resolveShellEnvironment();

            this.transport = new StdioClientTransport({
                command: this.config.command,
                args: this.config.args,
                env: this.config.env ? { ...baseEnv, ...this.config.env } : baseEnv,
                stderr: 'pipe',
            });

            this.client = new Client({ name: 'vscode-issue-manager', version: '1.0.0' });

            // 监听连接关闭
            this.transport.onclose = () => {
                if (this._connected) {
                    logger.warn(`[MCP] server "${this.serverId}" 连接意外关闭`);
                    this._connected = false;
                }
            };
            this.transport.onerror = (error: Error) => {
                logger.error(`[MCP] server "${this.serverId}" transport 错误`, error);
                this._error = error.message;
            };

            await this.client.connect(this.transport);
            this._connected = true;

            // 发现工具
            await this.refreshTools();

            logger.info(`[MCP] server "${this.serverId}" 已连接，发现 ${this._tools.length} 个工具`);
        } catch (e) {
            this._connected = false;
            this._error = e instanceof Error ? e.message : String(e);
            logger.error(`[MCP] server "${this.serverId}" 连接失败: ${this._error}`);
            throw e;
        }
    }

    /** 刷新工具列表 */
    async refreshTools(): Promise<void> {
        if (!this.client || !this._connected) { return; }
        try {
            const result = await this.client.listTools();
            this._tools = (result.tools || []).map(t => ({
                name: `mcp_${this.serverId}_${t.name}`,
                description: t.description || '',
                inputSchema: (t.inputSchema || {}) as Record<string, unknown>,
                serverId: this.serverId,
                originalName: t.name,
            }));
        } catch (e) {
            logger.error(`[MCP] server "${this.serverId}" listTools 失败`, e);
            this._tools = [];
        }
    }

    /** 调用工具（传入原始工具名） */
    async invokeTool(toolName: string, input: Record<string, unknown>): Promise<McpToolResult> {
        if (!this.client || !this._connected) {
            return { success: false, content: `MCP server "${this.serverId}" 未连接` };
        }
        try {
            const result = await this.client.callTool({ name: toolName, arguments: input });
            const content = Array.isArray(result.content)
                ? result.content
                    .map((c: { type: string; text?: string }) => c.type === 'text' && c.text ? c.text : '')
                    .filter(Boolean)
                    .join('\n')
                : String(result.content ?? '');
            return { success: !result.isError, content };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return { success: false, content: `调用工具 ${toolName} 失败: ${msg}` };
        }
    }

    dispose(): void {
        this._connected = false;
        this._tools = [];
        // 先关 client（发送 shutdown），再关 transport（杀进程）
        const client = this.client;
        const transport = this.transport;
        this.client = undefined;
        this.transport = undefined;
        void (async () => {
            try { await client?.close(); } catch { /* ignore */ }
            try { await transport?.close(); } catch { /* ignore */ }
        })();
    }
}
