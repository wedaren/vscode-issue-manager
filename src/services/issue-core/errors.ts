/**
 * issue-core 服务层的业务错误类型。
 * 上层(扩展端工具 / MCP server)在 catch 后转成各自协议的错误响应。
 */

export class IssueCoreError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "IssueCoreError";
    }
}

export class IssueNotFoundError extends IssueCoreError {
    constructor(public readonly fileName: string) {
        super(`Issue not found: ${fileName}`);
        this.name = "IssueNotFoundError";
    }
}

export class InvalidPathError extends IssueCoreError {
    constructor(public readonly providedPath: string, reason: string) {
        super(`Invalid path "${providedPath}": ${reason}`);
        this.name = "InvalidPathError";
    }
}

export class IssueDirNotConfiguredError extends IssueCoreError {
    constructor() {
        super("Issue directory is not configured");
        this.name = "IssueDirNotConfiguredError";
    }
}
