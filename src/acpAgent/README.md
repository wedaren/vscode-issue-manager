# vscode-issue-manager ACP Agent (Phase 2 PoC)

**实验性 PoC**——把 issue/笔记库变成一个 [Agent Client Protocol (ACP)](https://agentclientprotocol.com) 兼容的 Agent,让任何 ACP Client(Zed、自定义 Web/移动 Client 等)远程调用对话。

## PoC 范围

✅ **已实现**:
- `initialize` / `session/new` / `session/prompt` 三个核心方法
- `session/update` notification 推流(`agent_message_chunk`、`tool_call`、`tool_call_complete`)
- 5 个 issue-core 工具暴露给 LLM:`search_issues`、`read_issue`、`create_issue`、`kb_query`、`get_library_stats`
- OpenAI-compatible LLM streaming(支持 DeepSeek、OpenAI、Ollama、任何 OpenAI-compatible 服务)
- 多轮对话历史保留(in-memory)

❌ **不在 PoC 范围**(下个迭代):
- `session/cancel`(允许用户中止)
- `session/load` / `session/set_mode`
- Plan updates(LLM 计划展示)
- `session/request_permission`(危险工具确认)
- Client capabilities: `fs/*`、`terminal/*`
- HTTP / WebSocket transport(目前仅 stdio)
- 持久化 session(进程重启丢失对话)

## 快速验证

### 1. 编译

```bash
npm run compile:acp
```

### 2. 协议层冒烟测试(无需 LLM credentials)

只验证 `initialize` + `session/new` 走通:

```bash
ISSUE_MANAGER_DIR=/path/to/issue-notes \
ACP_AGENT_API_URL=http://localhost:9999/v1/chat/completions \
ACP_AGENT_MODEL=fake \
  node ./dist/acpAgent/acpAgent/smokeTest.js
```

### 3. 端到端 prompt 测试(需要 LLM API key)

例如 DeepSeek:

```bash
ISSUE_MANAGER_DIR=/path/to/issue-notes \
ACP_AGENT_API_URL=https://api.deepseek.com/v1/chat/completions \
ACP_AGENT_API_KEY=sk-... \
ACP_AGENT_MODEL=deepseek-chat \
SMOKE_PROMPT="帮我整理一下最近三天关于 ACP 的笔记" \
  node ./dist/acpAgent/acpAgent/smokeTest.js
```

输出应包含:
- `[notification]` 行:agent_message_chunk(LLM 流式文本)、tool_call(LLM 决定调工具)、tool_call_complete(工具结果)
- 最后:`[client] session/prompt → {"stopReason":"end_turn"}`

## 配置

启动通过环境变量:

| 变量 | 必需 | 说明 |
|---|---|---|
| `ISSUE_MANAGER_DIR` | ✓ | 笔记目录绝对路径 |
| `ACP_AGENT_API_URL` | ✓ | OpenAI-compatible chat completions 完整 URL |
| `ACP_AGENT_MODEL` | ✓ | 模型名 |
| `ACP_AGENT_API_KEY` | 可选 | Bearer token(本地 Ollama 等不需要) |

## 协议形状(便于实现 ACP Client 时参考)

### initialize

请求 → 响应:

```jsonc
{ "jsonrpc": "2.0", "id": 1, "method": "initialize",
  "params": { "protocolVersion": 1, "clientCapabilities": {},
              "clientInfo": { "name": "...", "title": "...", "version": "..." } } }

→ { "jsonrpc": "2.0", "id": 1,
    "result": { "protocolVersion": 1,
                "agentCapabilities": { "loadSession": false, "promptCapabilities": {...} },
                "agentInfo": { "name": "vscode-issue-manager-acp", "version": "0.1.0" },
                "authMethods": [] } }
```

### session/new

```jsonc
{ "jsonrpc": "2.0", "id": 2, "method": "session/new",
  "params": { "cwd": "/path", "mcpServers": [] } }

→ { "jsonrpc": "2.0", "id": 2,
    "result": { "sessionId": "uuid", "configOptions": null, "modes": null } }
```

### session/prompt + session/update

```jsonc
{ "jsonrpc": "2.0", "id": 3, "method": "session/prompt",
  "params": { "sessionId": "uuid", "prompt": [{ "type": "text", "text": "..." }] } }
```

服务端在处理期间多次 push notification:

```jsonc
// 流式文本
{ "jsonrpc": "2.0", "method": "session/update",
  "params": { "sessionId": "uuid",
              "update": { "type": "agent_message_chunk",
                          "content": { "type": "text", "text": "部分文本" } } } }

// 工具调用开始
{ "jsonrpc": "2.0", "method": "session/update",
  "params": { "sessionId": "uuid",
              "update": { "type": "tool_call", "toolCallId": "...",
                          "toolName": "search_issues",
                          "toolInput": { "query": "ACP" } } } }

// 工具调用完成
{ "jsonrpc": "2.0", "method": "session/update",
  "params": { "sessionId": "uuid",
              "update": { "type": "tool_call_complete", "toolCallId": "...",
                          "result": [{ "type": "text", "text": "工具输出" }] } } }
```

最终响应:

```jsonc
→ { "jsonrpc": "2.0", "id": 3, "result": { "stopReason": "end_turn" } }
```

## 已知限制 / 待解决

- **stopReason 字段语义**:本 PoC 用了 `"end_turn"` / `"max_turn_requests"` / `"cancelled"`,与 ACP 官方文档一致。但具体字段名(如 `tool_use` 还是 `tool_calls`)可能需要等真实 ACP Client 测试时校准。
- **wire format 字段名校准**:`session/update` 的 `update.type` 在 ACP 官方实现里可能有些地方写作 `"content"` 而不是 `"agent_message_chunk"`。本 PoC 选了语义清晰的命名,接 Zed 等真实 Client 时可能要适配。
- **无 LLM 配置共享**:不能直接读取 VS Code 扩展存的 API keys。需要单独通过环境变量提供。
- **无 cancel 机制**:`session/cancel` 通知不响应,长 prompt 跑起来打不断。

## 与 MCP server 的区别

|  | MCP server (`vscode-issue-manager-mcp`) | ACP Agent (`vscode-issue-manager-acp`) |
|---|---|---|
| 角色 | 暴露**工具**给外部 Agent | 是一个完整 **Agent** |
| 包含 LLM? | 否 | 是 |
| Client 例子 | Claude Desktop, Cursor, Continue | Zed external agent, 移动端 Client |
| 何时用 | 客户端已有 LLM,只需要扩展工具 | 客户端只想"发任务",由 Agent 全权决定 |

两者**不是替代关系,是互补关系**。MCP server 已经稳定;ACP Agent 是 PoC,等真实 Client 测试反馈后再加固。

## 与扩展的关系

ACP Agent 是**独立 node 进程**,跟 VS Code 扩展并存。它通过 [`IssueCoreServices`](../services/issue-core/) 直接访问笔记目录,与扩展共用同一份业务代码,但走 `NodeFsStorage`(纯 node fs)而非 `VscodeStorage`。

并发写冲突:与 MCP server 同样的注意事项——多进程写同一 issueDir 没文件锁,建议同一时间只一方频繁写入。
