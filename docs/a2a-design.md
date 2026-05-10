# A2A 协议集成设计

> 版本: 0.2 | 日期: 2026-04-19 | 分支: feat/llm-chat-and-browser-tools
>
> **v0.2 决策锁定**（见 §6）：多 agent card / 失败写日志 / 端口持久化 / rate limit 延后 / `http://127.0.0.1:<port>`

## 1. 目标

把本扩展的 LLM 角色系统接入 [A2A Protocol](https://a2a-protocol.org/latest/)，分两阶段：

- **Phase 1（本设计覆盖）**：作为 **A2A Server**，把选定的角色暴露为标准 A2A agent，供外部 agent（其他 IDE / 云端编排器 / CLI 工具）调用。
- **Phase 2（本设计只给出接口承诺）**：作为 **A2A Client**，让角色通过工具调用把子任务委派给远程 A2A agent。

非目标：

- 不支持公网暴露（仅 loopback + token）。
- 不替代现有内部委派（`ask_group_member` / 群组模式），A2A 只处理跨进程/跨系统场景。
- 不承诺 A2A 全量能力（push notifications、resubscribe 放到 Phase 2 之后）。

## 2. 现状摸底

关键发现（影响设计的点）：

| 能力 | 位置 | 是否就绪 |
|------|------|---------|
| 角色抽象 `ChatRoleInfo` | [types.ts](src/llmChat/types.ts) | ✅ 天然对应 A2A Agent |
| 执行入口 `executeConversation()` | [LLMChatService.ts](src/llmChat/LLMChatService.ts) | ✅ 可作为 A2A task 单元 |
| 流式 chunk 回调 | [ExecutionContext.ts:35](src/llmChat/ExecutionContext.ts#L35) `onChunk` | ✅ 可直接映射 SSE |
| AbortSignal 贯通 | [ExecutionContext.ts:26](src/llmChat/ExecutionContext.ts#L26) | 🟡 字段已在，需验证工具调用层是否真正响应 |
| 对话文件并发保护 | [llmChatDataManager.ts:312-314](src/llmChat/llmChatDataManager.ts#L312-L314) | 🟡 有状态标记防御，但无内存级 Mutex，可能竞态 |
| 工具三层架构（内置/MCP/Skills） | [tools/](src/llmChat/tools/), [SkillManager.ts](src/llmChat/SkillManager.ts), [mcp/](src/llmChat/mcp/) | ✅ Phase 2 加 `a2a` 工具域即可 |

## 3. Phase 1：A2A Server

### 3.1 模块位置

新增独立模块，与 [llmChat/](src/llmChat/) 并列，避免污染现有代码：

```
src/a2a/
├── index.ts              # activate/deactivate 钩子
├── server.ts             # HTTP + JSON-RPC 2.0 路由
├── agentCard.ts          # 角色 → agent card 映射
├── methods/
│   ├── messageSend.ts    # message/send（同步）
│   ├── messageStream.ts  # message/stream（SSE）
│   ├── tasksGet.ts
│   └── tasksCancel.ts
├── taskStore.ts          # 内存任务状态表（taskId → state）
├── auth.ts               # bearer token 校验
└── types.ts              # A2A 协议类型（Task/Message/Part 等）
```

**依赖方向**：`a2a/` → `llmChat/`（单向）。`llmChat/` 不感知 A2A 存在。

### 3.2 传输与进程模型

**HTTP 服务**：扩展激活时用 Node `http` 模块起 server，监听 `127.0.0.1`。

**端口策略**（决策：持久化）：
- 配置项 `issueManager.a2a.port`（默认 `0` = 首次自动选端口）
- 首次分配后写回 `globalState.a2a.lastPort`，下次启动**优先尝试该端口**
- 端口被占用时降级为 OS 分配 + 弹通知提示用户
- 允许用户在设置里显式指定固定端口覆盖所有上述行为

**生命周期**：
- `activate()` 中：读配置 `issueManager.a2a.enabled`（默认 false），开启才起 server。
- `deactivate()` 中：`server.close()` + 所有活跃 task 发 abort。
- 配置变更（enable/disable、端口）时热重启。

**端口冲突处理**：`listen(0)` 让 OS 分配。不做固定端口，避免与用户其他工具冲突。

### 3.3 鉴权

**必须启用 Bearer Token**（无匿名模式）：

- token 由扩展首次启用时生成（32 字节 random hex），存入 `SecretStorage`。
- 暴露命令 `issueManager.a2a.rotateToken` 用于轮换。
- 所有 JSON-RPC 请求要求 `Authorization: Bearer <token>`；不匹配返回 401。
- Agent card 的 `securitySchemes` 声明为 `httpBearer`。

**不支持的**：OAuth、mTLS、API key query param（降低攻击面）。

### 3.4 角色 → Agent Card 映射

**暴露开关**：角色 frontmatter 新增字段：

```yaml
a2a:
  expose: true                    # 默认 false，显式声明才暴露
  id: "my-researcher"             # 对外 agent id（默认用 role id）
  name: "Researcher"              # 对外显示名（默认用 chat_role_name）
  description: "..."              # agent card description（默认读 markdown body 首段）
  skills:                         # A2A skill 声明（必填）
    - id: "web_research"
      name: "Web Research"
      description: "..."
      tags: ["research", "web"]
  inputModes: ["text/plain"]      # 默认
  outputModes: ["text/plain"]     # 默认
```

在 [types.ts](src/llmChat/types.ts) 的 `ChatRoleFrontmatter` 新增 `a2a?: A2AExposeConfig` 字段。

**端点路由**（决策：多 agent card）：
- `GET /agents/:roleId/.well-known/agent.json` — 每个 `expose: true` 的角色独立 agent card
- `GET /agents` — 列出当前暴露的所有 agent（便于人工发现 / registry 注册）
- 所有 JSON-RPC 方法挂在 `POST /agents/:roleId/rpc`（每个 agent 独立 RPC endpoint，A2A 规范兼容）

复制命令会针对当前角色生成独立 URL，如 `http://127.0.0.1:<port>/agents/my-researcher`。

### 3.5 JSON-RPC 方法映射

实现优先级：P0 必须做，P1 下个迭代：

| 方法 | 优先级 | 内部实现 |
|------|--------|---------|
| `message/send` | P0 | 创建新 conversation 文件 → `executeConversation()` 同步等 → 返回完整 message |
| `message/stream` | P0 | 同上，用 `onChunk` 推 SSE；task 终态后关闭连接 |
| `tasks/get` | P0 | 查 `taskStore` + 对话文件状态标记 |
| `tasks/cancel` | P0 | abort 对应 `AbortController` |
| `tasks/pushNotificationConfig/*` | P2 | 暂不支持 |
| `tasks/resubscribe` | P1 | 支持断线续传（重要，外部 agent 网络抖动） |

**taskId 策略**：`a2a-<nanoid(10)>`，独立于 conversation id。一个 task 对应一个 conversation 文件（新建，放在专用目录 `<issueDir>/.a2a-tasks/` 下，与用户日常对话隔离）。

**contextId**：A2A 的 `contextId` 映射到**持久 conversation id**。同一 contextId 的后续消息追加到同一对话文件，实现 A2A 的多轮会话语义。

### 3.6 并发与锁

**风险**：外部多个 agent 并发向同一 contextId 发消息会竞态写对话文件。

**方案**：`src/a2a/taskStore.ts` 内维护 `Map<contextId, Promise>` 做串行化 — 同 contextId 的请求排队执行。跨 contextId 并行。

**不改动**现有 [llmChatDataManager.ts](src/llmChat/llmChatDataManager.ts) 的写入逻辑，因为现有的状态标记防御（executing/queued 拒绝）已经是最后一道保险；A2A 层的 Mutex 是更高层的排队。

### 3.7 错误处理

映射到 A2A 标准错误码：

- `-32001 TaskNotFoundError`：taskStore miss
- `-32002 TaskNotCancelableError`：已是终态
- `-32005 ContentTypeNotSupportedError`：非文本 part（Phase 1 仅支持文本）
- `-32603 InternalError`：执行异常

## 4. Phase 2：A2A Client（接口承诺）

作为 [tools/](src/llmChat/tools/) 下新工具域 `a2a/`，与 `delegation` 并列：

- `a2a_discover(agentUrl)` — 拉取远程 agent card，缓存到 `<issueDir>/.a2a-registry.json`
- `a2a_call(agentUrl, skillId, message, { stream?: boolean })` — 远程调用，stream 模式把 chunk 喂回当前 `onChunk`

**角色配置**：frontmatter 新增 `a2a_remotes: string[]`（远程 agent URL 白名单）。未在白名单内的 URL 拒绝调用 — 防止 prompt injection 导致角色调用任意外部 agent。

**不需要**改动当前执行器，因为 tool 调用是现成机制。

## 5. 前置改造清单（Phase 1 开工前）

按依赖顺序：

1. ~~**验证 AbortSignal 链路**~~ ✅ **已完成（v0.2）**。
   - 追踪结果：ExecutionContext → ConversationExecutor → LLMService → terminal/delegation 工具 signal 链路完整。
   - 发现缺口：**MCP 工具链完全无 signal 透传**，长耗时 MCP 调用无法被 abort 中止。
   - 修复：[McpClientWrapper.invokeTool](src/llmChat/mcp/McpClientWrapper.ts#L96) 接收 signal 并传给 SDK `callTool({...}, undefined, { signal })`；[McpManager.invokeTool](src/llmChat/mcp/McpManager.ts#L139) 转发；[executeChatTool](src/llmChat/tools/index.ts#L46) 入口 `throwIfAborted()` + MCP 路径透传 signal + AbortError 穿透。
2. **ChatRoleFrontmatter 扩展** — 新增 `a2a` 字段 + 解析 + 运行时 `ChatRoleInfo.a2aExpose` 映射。（约 0.5 天）
3. **无业务侵入的 conversation 创建 API** — 抽一个 `createConversation(roleId, { dir?, meta? })` 出来（现在 conversation 创建散落在 commands 里），供 A2A server 调用。（约 1 天）
4. **任务隔离目录** — A2A 产生的对话文件放在 `<issueDir>/.a2a-tasks/`，避免污染用户对话列表；可能需要 [llmChatDataManager.ts](src/llmChat/llmChatDataManager.ts) 的扫描逻辑做忽略规则。（约 0.5 天）

完成这 4 项后再做 `src/a2a/` 实现本身（估 3-5 天到 P0 完成）。

## 6. 决策记录（v0.2 已锁定）

| # | 议题 | 决策 | 影响 |
|---|------|------|------|
| 1 | Agent card 模式 | **多 card** — 每个角色独立 URL `/agents/:roleId` | §3.4 §3.5 |
| 2 | 失败 task 是否写执行日志 | **写** — `trigger` 枚举加 `'a2a'` | [types.ts:381](src/llmChat/types.ts#L381) 需要扩展 |
| 3 | 端口是否持久化 | **持久化** — globalState 记录上次端口，下次优先复用；配置可显式指定 | §3.2 |
| 4 | Rate limit / token budget | **延后** — Phase 1 仅做 per-role 并发上限（默认 2） | M3 之后 |
| 5 | Agent card URL scheme | **`http://127.0.0.1:<port>`** — 不引入 `vscode://` 自启动 | §3.2 |

## 7. 里程碑

- **M0** (前置改造)：本文档 §5 的 4 项 — 2 天
- **M1** (A2A Server P0)：agent card + message/send + tasks/get + auth — 3 天
- **M2** (A2A Server 流式)：message/stream + tasks/cancel + resubscribe — 2 天
- **M3** (联调)：与 reference A2A client（如官方 Python SDK）互通测试 — 1 天
- **M4** (Phase 2 启动)：`a2a_discover` + `a2a_call` 工具 — 另起设计文档

合计 Phase 1 约 **8 个工作日**。
