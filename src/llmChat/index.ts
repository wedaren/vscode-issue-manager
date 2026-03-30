export { LLMChatRoleProvider, type LLMChatViewNode, ChatRoleNode, ChatConversationNode, ChatGroupNode, ChatExecutionLogNode, RecentConversationRootNode, RecentConversationItemNode, RecentRunItemNode, McpRootNode, McpServerNode, McpToolNode } from './LLMChatRoleProvider';
export { LLMChatService } from './LLMChatService';
export { ChatHistoryPanel } from './ChatHistoryPanel';
export { registerLLMChatCommands } from './llmChatCommands';
export { CHAT_TOOLS, executeChatTool, getToolsForRole, type ToolExecContext } from './chatTools';
export { RoleTimerManager } from './RoleTimerManager';
export { executeConversation, type ExecutionOptions, type ExecutionResult } from './ConversationExecutor';
export {
    getAllChromeChatConversations,
    createChromeChatConversation,
    deleteChromeChatConversation,
    renameChromeChatConversation,
    getChromeChatMessages,
    appendChromeChatMessage,
    appendUserMessageQueued,
    getOrCreateExecutionLog,
    getExecutionLogInfo,
    getRecentActivityEntries,
    getRecentConversationEntries,
    appendExecutionRunRecord,
    startLogRun,
    appendLogLine,
    getPlanStatus,
    type PlanCompletionStatus,
} from './llmChatDataManager';
export type { ChatRoleInfo, ChatConversationInfo, ChatMessage, ChatGroupInfo, ChatGroupMessage, ChromeChatInfo, ChatExecutionLogInfo, ExecutionRunRecord, ExecutionToolCall, RecentActivityEntry, RecentConversationEntry } from './types';
export { McpManager } from './mcp';
