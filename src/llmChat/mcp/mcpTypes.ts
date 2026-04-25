/**
 * MCP 模块类型定义
 */

/** 持久化的 MCP server 配置（mcp.json 中的一条记录） */
export interface McpServerConfig {
    /** 启动 server 的命令 */
    command: string;
    /** 命令参数 */
    args?: string[];
    /** 环境变量 */
    env?: Record<string, string>;
    /** 是否启用（默认 true） */
    enabled?: boolean;
}

/** mcp.json 文件结构 */
export interface McpConfigFile {
    servers: Record<string, McpServerConfig>;
}

/** 运行时工具描述（统一格式，供角色工具组装使用） */
export interface McpToolDescriptor {
    /** 完整工具名：mcp_{serverId}_{toolName} */
    name: string;
    /** 工具描述 */
    description: string;
    /** JSON Schema 输入参数 */
    inputSchema: Record<string, unknown>;
    /** 所属 server ID */
    serverId: string;
    /** server 上的原始工具名 */
    originalName: string;
}

/** 工具调用结果 */
export interface McpToolResult {
    success: boolean;
    content: string;
}

/** Server 运行状态（供 UI 展示） */
export interface McpServerStatus {
    name: string;
    connected: boolean;
    toolCount: number;
    error?: string;
}
