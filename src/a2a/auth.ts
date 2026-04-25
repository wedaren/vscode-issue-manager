/**
 * A2A Bearer Token 鉴权。
 *
 * Token 存储在 VS Code SecretStorage（进程外加密），首次需要时自动生成。
 * 提供 verifyBearerToken() 供 HTTP 路由校验 Authorization 头。
 *
 * 轮换：用户调用 issueManager.a2a.rotateToken 命令触发 rotate()，
 * 生成新 token 并失效旧值；外部 agent 需要重新复制 token 才能继续访问。
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';

const SECRET_KEY = 'issueManager.a2a.bearerToken';

export class A2AAuth {
    constructor(private readonly context: vscode.ExtensionContext) {}

    /** 读取当前 token；若不存在则生成并持久化。 */
    async getToken(): Promise<string> {
        let token = await this.context.secrets.get(SECRET_KEY);
        if (!token) {
            token = generateToken();
            await this.context.secrets.store(SECRET_KEY, token);
        }
        return token;
    }

    /** 生成新 token 并覆盖旧值，返回新 token。 */
    async rotate(): Promise<string> {
        const token = generateToken();
        await this.context.secrets.store(SECRET_KEY, token);
        return token;
    }

    /**
     * 校验 Authorization 头。
     * 接受格式：`Authorization: Bearer <token>`
     * 使用 timingSafeEqual 防止 timing attack。
     */
    async verify(authHeader: string | undefined): Promise<boolean> {
        if (!authHeader) { return false; }
        const match = /^Bearer\s+(.+)$/i.exec(authHeader);
        if (!match) { return false; }
        const provided = match[1].trim();
        const expected = await this.getToken();

        // 等长才能进 timingSafeEqual；不等长直接 false（但仍进一次比较防止 timing 差异）
        const a = Buffer.from(provided);
        const b = Buffer.from(expected);
        if (a.length !== b.length) {
            // 防御性等长比较，避免"先判长度"这一泄漏
            crypto.timingSafeEqual(b, b);
            return false;
        }
        return crypto.timingSafeEqual(a, b);
    }
}

/** 32 字节 random，hex 编码。总长 64 字符。 */
function generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
}
