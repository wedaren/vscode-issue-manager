/**
 * MCP Server 管理命令
 */
import * as vscode from 'vscode';
import { McpManager } from './McpManager';
import * as mcpConfigStore from './mcpConfigStore';
import { McpServerNode } from '../LLMChatRoleProvider';

export function registerMcpCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.mcp.manage', cmdManage),
        vscode.commands.registerCommand('issueManager.mcp.addServer', cmdAddServer),
        vscode.commands.registerCommand('issueManager.mcp.removeServer', cmdRemoveServer),
        vscode.commands.registerCommand('issueManager.mcp.restartServer', cmdRestartServer),
        vscode.commands.registerCommand('issueManager.mcp.restartAll', cmdRestartAll),
        vscode.commands.registerCommand('issueManager.mcp.openConfig', cmdOpenConfig),
    );
}

// ─── 主入口：管理面板 ──────────────────────────────────────

async function cmdManage(): Promise<void> {
    const manager = McpManager.getInstance();
    const statuses = manager.getServerStatuses();

    type ActionItem = vscode.QuickPickItem & { action: string };
    const items: ActionItem[] = [];

    // 已配置的 server 列表
    if (statuses.length > 0) {
        items.push({ label: 'MCP Server', kind: vscode.QuickPickItemKind.Separator, action: '' });
        for (const s of statuses) {
            const icon = s.connected ? '$(check)' : s.error ? '$(error)' : '$(circle-slash)';
            const desc = s.connected ? `${s.toolCount} 个工具` : (s.error || '未连接');
            items.push({ label: `${icon} ${s.name}`, description: desc, action: `detail:${s.name}` });
        }
        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator, action: '' });
    }

    // 操作项
    items.push(
        { label: '$(add) 添加 Server', action: 'add' },
        { label: '$(trash) 移除 Server', action: 'remove' },
        { label: '$(refresh) 重启所有 Server', action: 'restartAll' },
        { label: '$(edit) 打开配置文件', action: 'openConfig' },
    );

    const pick = await vscode.window.showQuickPick(items, { title: 'MCP Server 管理', placeHolder: '选择操作' });
    if (!pick) { return; }

    switch (pick.action) {
        case 'add': return cmdAddServer();
        case 'remove': return cmdRemoveServer();
        case 'restartAll': return cmdRestartAll();
        case 'openConfig': return cmdOpenConfig();
        default:
            if (pick.action.startsWith('detail:')) {
                const serverId = pick.action.slice('detail:'.length);
                return cmdServerDetail(serverId);
            }
    }
}

// ─── Server 详情 ───────────────────────────────────────────

async function cmdServerDetail(serverId: string): Promise<void> {
    const manager = McpManager.getInstance();
    const statuses = manager.getServerStatuses();
    const status = statuses.find(s => s.name === serverId);
    if (!status) { return; }

    const tools = manager.getServersWithTools().get(serverId) || [];
    const toolList = tools.length > 0
        ? tools.map(t => `  - ${t.originalName}: ${t.description}`).join('\n')
        : '  （无工具）';

    type ActionItem = vscode.QuickPickItem & { action: string };
    const items: ActionItem[] = [
        { label: '$(info) 状态', description: status.connected ? '已连接' : (status.error || '未连接'), action: '' },
        { label: '$(tools) 工具', description: `${status.toolCount} 个`, detail: toolList, action: '' },
        { label: '', kind: vscode.QuickPickItemKind.Separator, action: '' },
        { label: '$(refresh) 重启此 Server', action: 'restart' },
        { label: '$(trash) 移除此 Server', action: 'remove' },
    ];

    const pick = await vscode.window.showQuickPick(items, { title: `MCP: ${serverId}`, placeHolder: '选择操作' });
    if (!pick) { return; }

    if (pick.action === 'restart') {
        const result = await manager.restartServer(serverId);
        if (result.connected) {
            vscode.window.showInformationMessage(`MCP server "${serverId}" 已连接`);
        } else {
            vscode.window.showErrorMessage(`MCP server "${serverId}" 连接失败: ${result.error || '未知错误'}`);
        }
    } else if (pick.action === 'remove') {
        await mcpConfigStore.removeServer(serverId);
        vscode.window.showInformationMessage(`已移除 MCP server "${serverId}"`);
    }
}

// ─── 添加 Server ──────────────────────────────────────────

async function cmdAddServer(): Promise<void> {
    const name = await vscode.window.showInputBox({
        title: '添加 MCP Server（1/3）',
        prompt: 'Server 名称（用作工具名前缀，如 memory、fetch）',
        placeHolder: '例如: memory',
        validateInput: (v) => {
            if (!v.trim()) { return '名称不能为空'; }
            if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(v.trim())) { return '名称只能包含字母、数字、_、-，且以字母开头'; }
            return undefined;
        },
    });
    if (!name) { return; }

    const command = await vscode.window.showInputBox({
        title: '添加 MCP Server（2/3）',
        prompt: '启动命令',
        placeHolder: '例如: npx',
    });
    if (!command) { return; }

    const argsStr = await vscode.window.showInputBox({
        title: '添加 MCP Server（3/3）',
        prompt: '命令参数（空格分隔，可留空）',
        placeHolder: '例如: -y @anthropic/mcp-memory',
    });
    if (argsStr === undefined) { return; }

    const args = argsStr.trim() ? argsStr.trim().split(/\s+/) : undefined;
    await mcpConfigStore.addServer(name.trim(), { command: command.trim(), args, enabled: true });

    vscode.window.showInformationMessage(`已添加 MCP server "${name.trim()}"，正在连接…`);
}

// ─── 移除 Server ──────────────────────────────────────────

async function cmdRemoveServer(node?: McpServerNode): Promise<void> {
    let serverId: string | undefined;

    if (node instanceof McpServerNode) {
        serverId = node.status.name;
    } else {
        const servers = mcpConfigStore.getServers();
        if (servers.length === 0) {
            vscode.window.showInformationMessage('当前没有已配置的 MCP server');
            return;
        }
        const pick = await vscode.window.showQuickPick(
            servers.map(s => ({ label: s.id, description: `${s.command} ${(s.args || []).join(' ')}` })),
            { title: '移除 MCP Server', placeHolder: '选择要移除的 server' },
        );
        if (!pick) { return; }
        serverId = pick.label;
    }

    await mcpConfigStore.removeServer(serverId);
    vscode.window.showInformationMessage(`已移除 MCP server "${serverId}"`);
}

// ─── 重启 Server ──────────────────────────────────────────

async function cmdRestartServer(node?: McpServerNode): Promise<void> {
    const manager = McpManager.getInstance();
    let serverId: string | undefined;

    if (node instanceof McpServerNode) {
        serverId = node.status.name;
    } else {
        const statuses = manager.getServerStatuses();
        if (statuses.length === 0) {
            vscode.window.showInformationMessage('当前没有已配置的 MCP server');
            return;
        }
        const pick = await vscode.window.showQuickPick(
            statuses.map(s => ({
                label: s.name,
                description: s.connected ? `已连接 (${s.toolCount} 工具)` : (s.error || '未连接'),
            })),
            { title: '重启 MCP Server', placeHolder: '选择要重启的 server' },
        );
        if (!pick) { return; }
        serverId = pick.label;
    }

    const result = await manager.restartServer(serverId);
    if (result.connected) {
        vscode.window.showInformationMessage(`MCP server "${serverId}" 已连接`);
    } else {
        const action = await vscode.window.showErrorMessage(
            `MCP server "${serverId}" 连接失败: ${result.error || '未知错误'}`,
            '打开配置', '重试',
        );
        if (action === '打开配置') { void cmdOpenConfig(); }
        else if (action === '重试') { void cmdRestartServer(node); }
    }
}

// ─── 重启所有 Server ──────────────────────────────────────

async function cmdRestartAll(): Promise<void> {
    const manager = McpManager.getInstance();
    await manager.restartAll();
    const statuses = manager.getServerStatuses();
    const connected = statuses.filter(s => s.connected).length;
    if (statuses.length === 0) {
        vscode.window.showInformationMessage('当前没有已配置的 MCP server');
    } else if (connected === statuses.length) {
        vscode.window.showInformationMessage(`已重启全部 ${statuses.length} 个 MCP server`);
    } else {
        const failed = statuses.filter(s => !s.connected).map(s => s.name);
        vscode.window.showWarningMessage(`${connected}/${statuses.length} 已连接，失败: ${failed.join(', ')}`);
    }
}

// ─── 打开配置文件 ─────────────────────────────────────────

async function cmdOpenConfig(): Promise<void> {
    const filePath = mcpConfigStore.getConfigFilePath();
    if (!filePath) {
        vscode.window.showErrorMessage('MCP 配置尚未初始化');
        return;
    }

    // 确保文件存在（首次打开时自动创建）
    const fs = require('fs') as typeof import('fs');
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify({ servers: {} }, null, 2), 'utf-8');
    }

    const doc = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(doc);
}
