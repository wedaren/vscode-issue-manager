# 设计报告：LLM Chat 系统与浏览器交互工具

> 版本: 3.0.115 | 日期: 2026-03-09

## 1. 概述

本次迭代引入两大核心能力：

1. **LLM Chat 系统** — 在 VS Code 侧和 Chrome 侧面板提供多会话 LLM 对话能力，支持工具调用（tool-calling）
2. **浏览器交互工具** — 让 LLM 能直接操控 Chrome 浏览器页面：打开标签、填写表单、点击按钮、读取页面内容等

## 2. 架构设计

### 2.1 整体数据流

```
┌──────────────┐   WebSocket   ┌──────────────────────┐   VS Code LM API
│ Chrome Panel │ ◄──────────► │ChromeIntegrationServer│ ◄──────────────► Copilot Model
│  (LLMPanel)  │              │   (WebSocket Server)  │
└──────┬───────┘              └──────────┬───────────┘
       │                                 │
       │ chrome.runtime                  │ import
       │ .sendMessage()                  │
       ▼                                 ▼
┌──────────────┐              ┌──────────────────────┐
│ background.ts│              │   LLMService         │
│ (WS Client)  │              │  .streamWithTools()  │
└──────────────┘              └──────────┬───────────┘
                                         │
                                         ▼
                              ┌──────────────────────┐
                              │     chatTools.ts      │
                              │  CHAT_TOOLS 定义      │
                              │  executeChatTool()    │
                              └──────────────────────┘
```

### 2.2 LLM Chat 模块结构

```
src/llmChat/
├── types.ts              # 核心类型定义（ChatMessage, ChatRole, Conversation 等）
├── index.ts              # 模块入口，注册命令与面板
├── LLMChatService.ts     # 对话服务核心：消息构建、LLM 调用、工具调用循环
├── chatTools.ts          # 19 个工具的定义和执行逻辑
├── llmChatCommands.ts    # VS Code 命令注册（新建对话、切换角色等）
├── llmChatDataManager.ts # 数据持久化（issueMarkdown 文件存储对话记录）
├── ChatHistoryPanel.ts   # VS Code Webview：对话历史列表
├── ChatInputPanel.ts     # VS Code Webview：对话输入面板
└── LLMChatRoleProvider.ts# 角色管理（系统提示词配置）
```

### 2.3 工具调用流程

```
用户输入 "打开微博"
       │
       ▼
Chrome Panel → background.ts → WebSocket → ChromeIntegrationServer
       │
       ▼
ChromeIntegrationServer 构建消息 + 系统提示词
       │
       ▼
LLMService.streamWithTools(messages, CHAT_TOOLS, onChunk, onToolCall)
       │
       ▼
Model 返回 LanguageModelToolCallPart { name: 'web_search', input: { query: '...' } }
       │
       ▼
onToolCall('web_search', { query: '...' })
       │
       ▼
chatTools.ts → executeChatTool('web_search', ...)
       │
       ▼ WebSocket
background.ts → handleOpenTab() → chrome.tabs.create({ url: '...' })
       │
       ▼
结果回传 → LLM 继续生成下一轮响应
```

### 2.4 Chrome 面板对话持久化

对话记录不再依赖 `chrome.storage.local`，改为通过 WebSocket 存储到 VS Code 侧的 issueMarkdown 文件中：

- 每个对话对应一个 `.md` 文件，存储在 issueMarkdown 目录下
- 前置元数据（frontmatter）包含对话 ID、标题、创建时间
- 消息体以 `user:` / `assistant:` 标记分段存储
- 优势：数据与笔记系统统一管理，支持 Git 同步

## 3. 工具清单

> **注意**: 标签页管理（open_tab、list_tabs 等）和页面交互（click_element、fill_input 等）工具已在后续迭代中移除，浏览器操作能力不再作为内置工具提供。

### 3.1 搜索与抓取（2 个）

| 工具 | 描述 |
|------|------|
| `web_search` | 网络搜索 |
| `fetch_url` | 抓取指定 URL 内容 |

### 3.2 笔记管理（6 个）

| 工具 | 描述 |
|------|------|
| `search_issues` | 搜索笔记 |
| `read_issue` | 读取笔记内容 |
| `create_issue` | 创建单个笔记 |
| `create_issue_tree` | 创建层级笔记树 |
| `list_issue_tree` | 查看笔记树结构 |
| `update_issue` | 更新已有笔记 |

## 4. 关键设计决策

### 4.1 工具调用机制选择

**方案**: 使用 VS Code LanguageModel API 的原生 tool-calling

- `model.sendRequest(messages, { tools })` 传入工具 schema
- 模型返回 `LanguageModelToolCallPart`，由 `streamWithTools()` 循环处理
- 与 WebAgentService 共用同一套工具定义和执行逻辑

**替代方案（未采用）**: Prompt-based function calling — 在提示词中描述 JSON 格式让模型文本输出工具调用。未采用因为原生 API 更可靠且不需要解析文本。

### 4.2 工具默认启用

`toolsEnabled` 从默认 `false` 改为默认 `true`（`!== 'false'`），因为：
- Chrome 面板的核心价值在于浏览器交互，工具调用是实现这一价值的关键
- `streamWithTools` 在无工具调用时自动降级为纯文本响应，无额外开销
- 用户仍可通过 UI 开关手动禁用

## 5. 安全考虑

- 所有工具执行均有超时机制（10-20s），防止长时间阻塞
- 工具结果 preview 截断为 300 字符，防止 token 超限

## 6. 文件变更清单

### 新增文件（12 个）
- `src/llmChat/` 目录下 9 个文件 — LLM Chat 完整模块
- `src/webAgent/WebAgentService.ts` — Web Research Agent 服务
- `chrome-extension-wxt/components/WebAgentPanel.vue` — Agent 面板 UI
- `.claude/settings.json` — Claude Code 配置

### 修改文件（9 个）
- `chrome-extension-wxt/components/LLMPanel.vue` — 工具反馈 UI、toolsEnabled 默认值
- `chrome-extension-wxt/entrypoints/background.ts` — 8 个新 WebSocket handler
- `src/integration/ChromeIntegrationServer.ts` — 系统提示词、工具路由、调试日志
- `src/llm/LLMService.ts` — `streamWithTools()` 方法
- `src/llmChat/chatTools.ts` — 5 个新浏览器交互工具
- `src/llmChat/LLMChatService.ts` — VS Code 侧系统提示词
- `src/core/ViewRegistry.ts` / `interfaces.ts` — 视图注册
- `package.json` / `wxt.config.ts` — 依赖和配置
