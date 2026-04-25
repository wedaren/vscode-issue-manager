/**
 * A2A server 配置读取。
 *
 * 配置来源优先级：
 *   1. 用户配置项 `issueManager.a2a.*`（settings.json）
 *   2. globalState 缓存（仅 lastPort，用于下次启动优先复用）
 *
 * 端口策略（见 docs/a2a-design.md §3.2）：
 *   - 用户显式指定非 0 端口 → 强制使用该端口
 *   - 用户指定 0 或未设置 → 使用上次成功的端口；无则让 OS 分配
 */
import * as vscode from 'vscode';

export interface A2AConfig {
    enabled: boolean;
    /** 用户配置的端口，0 表示让 OS 分配 */
    configuredPort: number;
    /** 上次成功监听的端口（从 globalState 读取，若无则 0） */
    lastPort: number;
}

const CONFIG_SECTION = 'issueManager.a2a';
const GLOBAL_STATE_LAST_PORT = 'a2a.lastPort';

export function readA2AConfig(context: vscode.ExtensionContext): A2AConfig {
    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
    return {
        enabled: cfg.get<boolean>('enabled', false),
        configuredPort: cfg.get<number>('port', 0),
        lastPort: context.globalState.get<number>(GLOBAL_STATE_LAST_PORT, 0),
    };
}

export async function writeLastPort(context: vscode.ExtensionContext, port: number): Promise<void> {
    await context.globalState.update(GLOBAL_STATE_LAST_PORT, port);
}

/**
 * 决策实际绑定端口：
 * - configuredPort 非 0 → 用之
 * - configuredPort === 0 && lastPort !== 0 → 优先尝试 lastPort
 * - 否则返回 0（交给 OS 分配）
 */
export function resolveBindPort(config: A2AConfig): number {
    if (config.configuredPort > 0) { return config.configuredPort; }
    if (config.lastPort > 0) { return config.lastPort; }
    return 0;
}

/** 监听配置变更事件，回调提供 true 表示配置实际改变。 */
export function onConfigChange(listener: () => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration(CONFIG_SECTION)) {
            listener();
        }
    });
}
