/**
 * A2A 模块入口。
 *
 * 由 extension.ts 调用 `activateA2A(context)` 注册：
 *   - A2AServer 实例（根据配置启动/停止）
 *   - 配置变更热重启
 *   - 3 个命令：copy endpoint / show status / rotate token（M1-2 接入）
 */
import * as vscode from 'vscode';
import { Logger } from '../core/utils/Logger';
import { A2AServer } from './server';
import { readA2AConfig, onConfigChange } from './config';
import { A2AAuth } from './auth';

const logger = Logger.getInstance();

export function activateA2A(context: vscode.ExtensionContext): void {
    const auth = new A2AAuth(context);
    const server = new A2AServer(context, auth);

    const syncState = async () => {
        const config = readA2AConfig(context);
        if (config.enabled && !server.port) {
            try { await server.start(config); }
            catch (e) { logger.error('[A2A] server 启动失败', e); }
        } else if (!config.enabled && server.port) {
            await server.stop();
        } else if (config.enabled && server.port) {
            // 已启动且仍启用：端口配置是否改变 → restart
            // 简化处理：配置事件触发时无条件重启，代价可接受（端口一般不频繁改）
            await server.restart(config);
        }
    };

    void syncState();

    context.subscriptions.push(onConfigChange(() => {
        void syncState();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('issueManager.a2a.copyEndpoint', async () => {
        if (!server.baseUrl) {
            void vscode.window.showWarningMessage('A2A server 未运行。请先在设置中启用 issueManager.a2a.enabled。');
            return;
        }
        await vscode.env.clipboard.writeText(server.baseUrl);
        void vscode.window.showInformationMessage(`已复制 A2A endpoint: ${server.baseUrl}`);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('issueManager.a2a.copyToken', async () => {
        const token = await auth.getToken();
        await vscode.env.clipboard.writeText(token);
        void vscode.window.showInformationMessage('已复制 A2A Bearer Token（外部 agent 请放入 Authorization: Bearer ... 头）。');
    }));

    context.subscriptions.push(vscode.commands.registerCommand('issueManager.a2a.rotateToken', async () => {
        const confirm = await vscode.window.showWarningMessage(
            '轮换 A2A Token 将立即失效当前 token，正在使用的外部 agent 需要重新复制 token。继续？',
            { modal: true },
            '轮换',
        );
        if (confirm !== '轮换') { return; }
        const token = await auth.rotate();
        await vscode.env.clipboard.writeText(token);
        void vscode.window.showInformationMessage('A2A Token 已轮换并复制到剪贴板。');
    }));

    context.subscriptions.push(vscode.commands.registerCommand('issueManager.a2a.showStatus', () => {
        const status = server.baseUrl
            ? `A2A server 运行中：${server.baseUrl}`
            : 'A2A server 未运行。';
        void vscode.window.showInformationMessage(status);
    }));

    // 扩展卸载时关闭 server
    context.subscriptions.push({
        dispose: () => { void server.stop(); },
    });
}
