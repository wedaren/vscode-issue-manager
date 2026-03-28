/**
 * MCP 配置持久化
 *
 * 将 MCP server 配置存储在 globalStorageUri/mcp.json，跨 workspace 生效。
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { McpConfigFile, McpServerConfig } from './mcpTypes';
import { Logger } from '../../core/utils/Logger';

const logger = Logger.getInstance();

let configFilePath: string | undefined;

const _onDidChangeConfig = new vscode.EventEmitter<void>();
export const onDidChangeConfig: vscode.Event<void> = _onDidChangeConfig.event;

/** 初始化配置存储（传入 globalStorageUri） */
export function initialize(globalStorageUri: vscode.Uri): void {
    const dir = globalStorageUri.fsPath;
    fs.mkdirSync(dir, { recursive: true });
    configFilePath = path.join(dir, 'mcp.json');
}

/** 读取完整配置 */
export function loadConfig(): McpConfigFile {
    if (!configFilePath) { return { servers: {} }; }
    try {
        if (!fs.existsSync(configFilePath)) { return { servers: {} }; }
        const raw = fs.readFileSync(configFilePath, 'utf-8');
        const parsed = JSON.parse(raw) as McpConfigFile;
        if (!parsed.servers || typeof parsed.servers !== 'object') {
            return { servers: {} };
        }
        return parsed;
    } catch (e) {
        logger.warn('[McpConfigStore] 读取 mcp.json 失败，使用默认空配置', e);
        return { servers: {} };
    }
}

/** 保存完整配置 */
export async function saveConfig(config: McpConfigFile): Promise<void> {
    if (!configFilePath) { return; }
    fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2), 'utf-8');
    _onDidChangeConfig.fire();
}

/** 添加 server（名称重复则覆盖） */
export async function addServer(name: string, server: McpServerConfig): Promise<void> {
    const config = loadConfig();
    config.servers[name] = server;
    await saveConfig(config);
}

/** 删除 server */
export async function removeServer(name: string): Promise<void> {
    const config = loadConfig();
    delete config.servers[name];
    await saveConfig(config);
}

/** 更新 server 部分字段 */
export async function updateServer(name: string, updates: Partial<McpServerConfig>): Promise<void> {
    const config = loadConfig();
    const existing = config.servers[name];
    if (!existing) { return; }
    config.servers[name] = { ...existing, ...updates };
    await saveConfig(config);
}

/** 获取所有 server 配置（含名称） */
export function getServers(): Array<McpServerConfig & { id: string }> {
    const config = loadConfig();
    return Object.entries(config.servers).map(([id, cfg]) => ({ id, ...cfg }));
}

/** 获取配置文件路径（供"打开配置文件"命令使用） */
export function getConfigFilePath(): string | undefined {
    return configFilePath;
}

export function dispose(): void {
    _onDidChangeConfig.dispose();
}
