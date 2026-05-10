/**
 * 工具系统入口 — 薄转发层
 *
 * 实现已迁移至 src/llmChat/tools/ 目录。
 * 此文件保留仅为保持外部消费者的导入路径不变。
 */
export {
    CHAT_TOOLS,
    executeChatTool,
    getToolsForRole,
    type ToolExecContext,
    type ToolCallResult,
    type ToolRiskLevel,
} from './tools/index';
