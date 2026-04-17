/**
 * ShellEnvironmentResolver — 一次性登录 shell 环境解析
 *
 * VSCode 扩展进程的 process.env 通常缺少用户在 .zshrc / .bash_profile 中配置的 PATH
 * （nvm、pyenv、rbenv、conda、cargo、homebrew 等）。
 *
 * 本模块在扩展激活时 spawn 一次登录 shell，捕获完整环境变量并缓存，
 * 供所有后续 child_process / MCP 调用使用。
 */
import { execSync } from 'child_process';
import { Logger } from './utils/Logger';

const logger = Logger.getInstance();

let _cachedEnv: Record<string, string> | undefined;
let _resolveAttempted = false;

/**
 * 通过 spawn 登录 shell 获取用户完整环境变量，缓存后返回。
 * 如果解析失败，回退到 process.env + 手动 PATH 补齐。
 *
 * 首次调用约 200-500ms（spawn 登录 shell），后续调用直接返回缓存。
 */
export function resolveShellEnvironment(): Record<string, string> {
    if (_cachedEnv) { return _cachedEnv; }
    if (_resolveAttempted) { return _buildFallbackEnv(); }

    _resolveAttempted = true;

    try {
        const shell = process.env.SHELL || '/bin/zsh';
        // -l = login shell：source .zprofile / .bash_profile（nvm/pyenv/homebrew 在此配置）
        // env -0 = null 字节分隔，安全处理含换行符的环境变量值
        const stdout = execSync(`${shell} -lc 'env -0'`, {
            encoding: 'utf8',
            timeout: 5000,
            maxBuffer: 2 * 1024 * 1024,
            // 不传 stdin，不传 env（继承 process.env 作为基础）
        });
        const env: Record<string, string> = {};
        for (const entry of stdout.split('\0')) {
            const idx = entry.indexOf('=');
            if (idx > 0) {
                env[entry.slice(0, idx)] = entry.slice(idx + 1);
            }
        }

        // 确保解析出来的 PATH 不为空
        if (!env.PATH) {
            logger.warn('[ShellEnvResolver] 登录 shell 返回的 PATH 为空，回退到 fallback');
            _cachedEnv = _buildFallbackEnv();
        } else {
            logger.info(`[ShellEnvResolver] 登录 shell 环境解析成功，PATH 包含 ${env.PATH.split(':').length} 个条目`);
            _cachedEnv = env;
        }
    } catch (err) {
        logger.warn('[ShellEnvResolver] 登录 shell 环境解析失败，使用 fallback PATH', err);
        _cachedEnv = _buildFallbackEnv();
    }

    return _cachedEnv;
}

/**
 * 回退方案：process.env + 手动补齐常用路径（nvm/homebrew/pipx/cargo 等）。
 * 当 spawn 登录 shell 失败时使用。
 */
function _buildFallbackEnv(): Record<string, string> {
    const env = { ...process.env } as Record<string, string>;
    const home = process.env.HOME || '';
    const extraPaths: string[] = [
        `${home}/.local/bin`,
        '/opt/homebrew/bin',
        '/usr/local/bin',
        `${home}/.cargo/bin`,
    ];

    // 尝试探测 nvm
    try {
        const fs = require('fs') as typeof import('fs');
        const nvmDir = process.env.NVM_DIR || `${home}/.nvm`;
        const versions: string[] = fs.readdirSync(`${nvmDir}/versions/node`);
        if (versions.length > 0) {
            extraPaths.unshift(`${nvmDir}/versions/node/${versions.sort().pop()}/bin`);
        }
    } catch { /* nvm 不存在 */ }

    // 尝试探测 pyenv
    try {
        const fs = require('fs') as typeof import('fs');
        const pyenvRoot = process.env.PYENV_ROOT || `${home}/.pyenv`;
        if (fs.existsSync(`${pyenvRoot}/shims`)) {
            extraPaths.push(`${pyenvRoot}/shims`);
        }
    } catch { /* pyenv 不存在 */ }

    env.PATH = [...extraPaths, env.PATH].filter(Boolean).join(':');
    return env;
}

/**
 * 重置缓存（用于测试或强制刷新）。
 */
export function resetShellEnvironmentCache(): void {
    _cachedEnv = undefined;
    _resolveAttempted = false;
}
