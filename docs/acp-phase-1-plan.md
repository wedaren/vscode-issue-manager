# ACP 阶段 1 规划:业务逻辑解耦 + 独立 MCP server

> 本文档是规划,不是实施。目标:让外部 ACP Agent(Claude Agent、Codex、Gemini CLI 等)
> 通过 MCP 协议调用本扩展的 issue / 知识库核心能力,与现有 VS Code 扩展并存且不破坏。

## 背景与目标

`vscode-issue-manager` 内置完整 LLM agent loop([ConversationExecutor.ts](../src/llmChat/ConversationExecutor.ts))、18+ 工具([tools/](../src/llmChat/tools/) 目录共 5119 行)、MCP 客户端([mcp/](../src/llmChat/mcp/))。
目前所有"业务工具"与"VS Code 适配层"和"agent 内部协作机制"深度交织在一个进程里。

**阶段 1 的明确边界**:

- 入:把 issue / 知识库相关工具抽象为可独立使用的 service 层
- 入:暴露独立 stdio MCP server,让外部 Agent 可以直接 `kb_query`、`search_issues`、`create_issue` 等
- 不入:不动 ACP 协议层(那是阶段 2)
- 不入:不动 agent 内部协作工具(委派、群组、角色管理)
- 不入:不重写 LLMChat,扩展内的 `executeChatTool` 仍走原路径

---

## 1. 范围界定

### 1.1 进 MCP server 的工具(对外提供)

这些工具是"任何外部 Agent 都可能想调用的笔记/知识库能力",vscode 依赖较浅,业务逻辑清晰。

| 工具名 | 来源文件 | 为什么适合 |
|---|---|---|
| `get_library_stats` | [issueTools.ts:279](../src/llmChat/tools/issueTools.ts#L279) | 只读概览,外部 Agent 接入时第一个会问的"这个笔记库里有什么" |
| `search_issues` | [issueTools.ts:330](../src/llmChat/tools/issueTools.ts#L330) | 标准的语义/关键词检索能力,所有 Agent 通用 |
| `read_issue` | [issueTools.ts:363](../src/llmChat/tools/issueTools.ts#L363) | 读取笔记原文,带分页;典型 RAG 数据源 |
| `create_issue` | [issueTools.ts:421](../src/llmChat/tools/issueTools.ts#L421) | 让外部 Agent 把研究产物写回到用户的知识库 |
| `update_issue` | [issueTools.ts:588](../src/llmChat/tools/issueTools.ts#L588) | 增量补充已有笔记 |
| `create_issue_tree` | [issueTools.ts:459](../src/llmChat/tools/issueTools.ts#L459) | 一次性写入结构化报告/大纲,典型 deep research 输出 |
| `list_issue_tree` | [issueTools.ts:552](../src/llmChat/tools/issueTools.ts#L552) | 浏览结构 |
| `link_issue` / `unlink_issue` / `get_issue_relations` / `move_issue_node` / `sort_issue_children` | [issueTools.ts](../src/llmChat/tools/issueTools.ts) | 关系操作,作为知识图谱基本能力 |
| `delete_issue` / `batch_delete_issues` | [issueTools.ts:983](../src/llmChat/tools/issueTools.ts#L983) | 必须暴露,但需要在 MCP server 一侧做"破坏性操作"的额外保护(见 §5) |
| `kb_ingest` | [knowledgeBaseTools.ts:190](../src/llmChat/tools/knowledgeBaseTools.ts#L190) | 把 URL/文本/文件归档为 raw 素材,核心导入接口 |
| `kb_compile` | [knowledgeBaseTools.ts:270](../src/llmChat/tools/knowledgeBaseTools.ts#L270) | 触发知识编译,虽然带 LLM 指令文本,但纯数据返回,外部 Agent 可消费 |
| `kb_link_scan` | [knowledgeBaseTools.ts:361](../src/llmChat/tools/knowledgeBaseTools.ts#L361) | 知识库健康度,只读 |
| `kb_health_check` | [knowledgeBaseTools.ts:443](../src/llmChat/tools/knowledgeBaseTools.ts#L443) | 知识库统计,只读 |
| `kb_query` | [knowledgeBaseTools.ts:521](../src/llmChat/tools/knowledgeBaseTools.ts#L521) | wiki/ 语义搜索,典型 RAG 查询入口 |

合计 19 个工具,覆盖"搜/读/写/关联/知识库"完整闭环。

### 1.2 不进 MCP server 的工具

| 工具名 / 工具集 | 文件 | 不进的理由 |
|---|---|---|
| `read_todos` / `write_todos` / `update_todo` | [todoTools.ts](../src/llmChat/tools/todoTools.ts) | 对话级 todo,依赖 `context.conversationUri` 这个"当前对话上下文";外部 Agent 没有这个概念 |
| `delegate_to_role` / `continue_delegation` / `list_chat_roles` / `get_delegation_status` | [delegationTools.ts](../src/llmChat/tools/delegationTools.ts) | 这是本扩展内部的 agent orchestration,外部 Agent 自己已经是 orchestrator,没必要嵌套 |
| `ask_group_member` / `ask_all_group_members` | [groupTools.ts](../src/llmChat/tools/groupTools.ts) | 同上,内部协作机制 |
| `list_available_tools` / `create_chat_role` / `update_role_config` / `evaluate_role` / `read_role_execution_logs` | [roleManagementTools.ts](../src/llmChat/tools/roleManagementTools.ts) | 元能力:管理本扩展内部的角色定义。对外部 Agent 无意义 |
| `activate_skill` | [skillTools.ts](../src/llmChat/tools/skillTools.ts) | 依赖 `SkillManager` 单例,且渐进式披露的 skill 概念是本扩展内部 agent loop 的特性 |
| `create_plan` / `read_plan` / `check_step` / `add_step` / `update_progress_note` / `queue_continuation` | [planningTools.ts](../src/llmChat/tools/planningTools.ts) | 对话级执行计划,外部 Agent 自己有 plan 机制 |
| `read_file` / `search_files` / `run_command` | [terminalTools.ts](../src/llmChat/tools/terminalTools.ts) | 通用工具,几乎所有 ACP Agent 自带等价物 (`Read`、`Grep`、`Bash`),重复暴露反而增加权限模型复杂度 |
| `fetch_url` | [browsingTools.ts](../src/llmChat/tools/browsingTools.ts) | 通用工具,外部 Agent 都有 `WebFetch` |
| `render_diagram` / `verify_diagram` | [diagramTools.ts](../src/llmChat/tools/diagramTools.ts) | 强耦合 `ImageStorageService`(扩展端的 webview 资源管理) |
| `write_memory` (memoryTools) | [memoryTools.ts](../src/llmChat/tools/memoryTools.ts) | 注释已说明该工具集已废弃,记忆由 `knowledge_base` 统一管理 |

### 1.3 边界模糊、需要用户决策

| 工具 | tradeoff |
|---|---|
| `create_issue_tree` | 写入操作,且实现里有 `await new Promise(r => setTimeout(r, 1100))` 的等待逻辑,执行时间可能超过 10 秒。MCP 同步调用模式下外部 Agent 体感会差。**选项 A**:进 MCP,但限制 nodes 数量上限(如 ≤ 8);**选项 B**:不进 MCP,只让外部 Agent 用循环 `create_issue`+`link_issue` 组合 |
| `delete_issue` / `batch_delete_issues` | 不可逆。**选项 A**:进 MCP,但由 MCP server 一侧加 `--allow-destructive` 启动参数门控;**选项 B**:不进 MCP,只允许从扩展内调用 |
| `kb_ingest` 的 `mode: 'file'` 分支 | 读取本地任意路径文件,有越权风险。**选项 A**:MCP server 一侧在该模式上加路径白名单(只允许 issueDir 内);**选项 B**:MCP 版只暴露 `mode: 'url'` 和 `mode: 'text'` |
| `update_issue` 的 `append=true` 模式 | 追加写没有锁,并发写可能丢数据。本扩展内单进程问题不大,MCP 多客户端下需要考虑。**选项**:阶段 1 暂不处理并发,在 README 上写明"假设单 issueDir 单 writer" |
| 是否暴露 `get_library_stats` 中"系统类型"如 `chat_role`、`chat_conversation` | 这些是本扩展内部产生的"agent 系统文件",外部 Agent 看到会困惑。**选项 A**:MCP 版默认过滤掉;**选项 B**:仍返回但加注释 |

---

## 2. 解耦设计

### 2.1 现状梳理:vscode 依赖在哪儿

调研结果(grep `vscode\.` 计数):

- [issueTools.ts](../src/llmChat/tools/issueTools.ts):23 处,主要是 `vscode.Uri.joinPath`、`vscode.workspace.fs.{readFile,stat,delete}`、`vscode.commands.executeCommand('issueManager.refreshViews')`
- [knowledgeBaseTools.ts](../src/llmChat/tools/knowledgeBaseTools.ts):8 处,全是 `vscode.workspace.fs.readFile` / `vscode.Uri.file`
- [todoTools.ts](../src/llmChat/tools/todoTools.ts):4 处
- 数据层 [IssueMarkdowns.ts](../src/data/IssueMarkdowns.ts):重度依赖 `vscode.workspace.fs`、`vscode.workspace.findFiles`、`vscode.EventEmitter`、`vscode.window.showErrorMessage`,以及 `vscode.workspace.getConfiguration` 通过 [config.ts](../src/config.ts) 读 `issueManager.issueDir`
- 数据层 [issueTreeManager.ts](../src/data/issueTreeManager.ts):同上,且包含 `_createIssueNode` 内部直接构造 `vscode.Uri`、`onIssueTreeUpdateEmitter`

**关键观察**:数据层并不只是"用 vscode 的 fs API 读写文件"那么简单。它还有:

1. 进程内缓存 `_issueMarkdownCache` 和 `_typeIndex`,由 `UnifiedFileWatcher` 在文件变化时刷新
2. 标题更新事件 `onTitleUpdateEmitter`,被 TreeView 订阅
3. `vscode.commands.executeCommand('issueManager.refreshViews')` 用于刷新视图

MCP server 进程是独立的 node 进程,**不会共享上面这套机制**。所以解耦目标不是"把数据层抽出来给 MCP server 直接用",而是 **重新写一套薄的 service 层,用纯 node fs API 读写同一个 issueDir**,扩展端的旧路径继续用旧实现(保持视图刷新等行为不变)。

### 2.2 service 层目录结构

提议位置:`src/services/issue-core/`(注意:已有 `src/services/` 目录,但内含的是 `EditorContextService`、`RSSService` 等"扩展进程内服务",这些用 `vscode` API 是预期的。我们新增的 `issue-core` 子目录是**不能依赖 vscode**的、双进程共享的核心)。

```
src/services/issue-core/
  index.ts                    // 导出 IssueCoreServices(组合所有 service)
  types.ts                    // FrontmatterData、IssueMarkdown、IssueNode、TreeData(从 data 层迁移类型,纯 type)
  Storage.ts                  // 抽象接口:readFile/writeFile/stat/list/delete/findFiles
  IssueRepository.ts          // CRUD + frontmatter 解析(替代 IssueMarkdowns 的纯逻辑部分)
  IssueTreeRepository.ts      // tree.json 读写、节点增删改查(替代 issueTreeManager 的纯逻辑部分)
  IssueQuery.ts               // search/list/stats(executeSearchIssues、executeGetLibraryStats 的纯实现)
  KnowledgeBase.ts            // kb_ingest/kb_query/kb_link_scan/kb_health_check/kb_compile 的纯实现
  errors.ts                   // 业务错误类型
```

平台适配器(分别实现 `Storage` 接口):

```
src/services/issue-core/storage/
  VscodeStorage.ts            // 用 vscode.workspace.fs 实现(扩展端用)
  NodeFsStorage.ts            // 用 node:fs/promises 实现(MCP server 用)
```

### 2.3 关键 service 接口签名(粗略)

```typescript
// Storage.ts —— 抽象接口,不依赖 vscode
export interface Storage {
  readText(absPath: string): Promise<string>;
  writeText(absPath: string, content: string): Promise<void>;
  stat(absPath: string): Promise<{ mtime: number; ctime: number }>;
  listMarkdownFiles(dir: string): Promise<string[]>; // 仅 dir 根目录的 *.md
  delete(absPath: string): Promise<void>;
  exists(absPath: string): Promise<boolean>;
}
```

```typescript
// IssueRepository.ts
export class IssueRepository {
  constructor(private storage: Storage, private issueDir: string) {}
  getAll(opts?: { sortBy?: 'mtime'|'ctime' }): Promise<IssueMarkdown[]>;
  get(fileName: string): Promise<IssueMarkdown | null>;
  getContent(fileName: string): Promise<string>;
  create(opts: { frontmatter?: Partial<FrontmatterData>; body: string }): Promise<{ fileName: string; absPath: string }>;
  updateFrontmatter(fileName: string, patch: Partial<FrontmatterData>): Promise<boolean>;
  updateBody(fileName: string, body: string, opts?: { append?: boolean }): Promise<boolean>;
  delete(fileName: string): Promise<boolean>;
}
```

```typescript
// IssueTreeRepository.ts
export class IssueTreeRepository {
  constructor(private storage: Storage, private issueDir: string) {}
  read(): Promise<TreeData>;
  write(data: TreeData): Promise<void>;
  createNodes(fileNames: string[], parentId?: string): Promise<IssueNode[]>;
  moveNode(nodeId: string, newParentId: string | null, index: number): Promise<void>;
  removeNode(nodeId: string, opts?: { recursiveFiles?: boolean }): Promise<{ removedFiles: string[] }>;
  getRelations(fileName: string): Promise<{ ancestors: IssueNode[]; parent: IssueNode|null; siblings: IssueNode[]; children: IssueNode[] }>;
  // 等等
}
```

```typescript
// IssueQuery.ts
export class IssueQuery {
  constructor(private repo: IssueRepository) {}
  searchByKeyword(query: string, opts?: { limit?: number; type?: string; scope?: 'all'|'title'|'body' }): Promise<SearchResult[]>;
  listByType(type: string, limit: number): Promise<IssueMarkdown[]>;
  getStats(opts?: { recentLimit?: number }): Promise<LibraryStats>;
}
```

```typescript
// KnowledgeBase.ts
export class KnowledgeBaseService {
  constructor(private repo: IssueRepository) {}
  ingest(opts: { mode: 'url'|'text'|'file'; source: string; category: string; title: string }): Promise<{ fileName: string }>;
  compile(targetFile?: string): Promise<CompileReport>;
  linkScan(): Promise<LinkScanReport>;
  healthCheck(): Promise<HealthReport>;
  query(query: string, opts?: { category?: string; limit?: number }): Promise<KbSearchResult[]>;
}
```

```typescript
// index.ts —— 组合根
export class IssueCoreServices {
  readonly issues: IssueRepository;
  readonly tree: IssueTreeRepository;
  readonly query: IssueQuery;
  readonly kb: KnowledgeBaseService;
  constructor(storage: Storage, issueDir: string) {
    this.issues = new IssueRepository(storage, issueDir);
    this.tree = new IssueTreeRepository(storage, issueDir);
    this.query = new IssueQuery(this.issues);
    this.kb = new KnowledgeBaseService(this.issues);
  }
}
```

### 2.4 不要过度抽象的部分

以下东西**保留在原位置**,不为 MCP server 抽:

- **缓存与事件** (`_issueMarkdownCache`、`onTitleUpdateEmitter`、`UnifiedFileWatcher`):这是扩展端为 TreeView/StatusBar 服务的进程内机制,MCP server 不需要(每次调用走文件 IO 即可,延迟可接受)
- **frontmatter 类型倒排索引** (`_typeIndex`):同上,扩展端预计算可节省 TreeView 首次渲染时间;MCP server 一侧每次扫一遍 markdown 也是毫秒级
- **`vscode.commands.executeCommand('issueManager.refreshViews')`**:只在扩展端 adapter 里调,service 层不知道这件事
- **`Logger`**:扩展端用 `Logger.getInstance()`(内部连 `vscode.OutputChannel`);MCP server 一侧注入一个写 stderr 的简易 logger 即可。可以让 service 层接受一个可选的 `logger?: { info, warn, error }` 接口

### 2.5 现有工具文件的改造方式

以 `executeSearchIssues` 为例:

**改造前**(混合):
- 直接 `await getAllIssueMarkdowns({})`(数据层,内含 vscode)
- 直接调 `runKeywordSearch`(自带 vscode 依赖,因为 `getIssueMarkdownContent` 走 vscode)

**改造后**(扩展端):
- `executeSearchIssues` 仍在 [issueTools.ts](../src/llmChat/tools/issueTools.ts),但内部调 `services.query.searchByKeyword(...)`
- `services` 在 [extension.ts](../src/extension.ts) 启动时构造一次:`new IssueCoreServices(new VscodeStorage(), issueDir)`
- 工具函数只做:取 services 实例 → 调 service → 把结果包装成 `ToolCallResult`(加 emoji、`issueLink`、`vscode.commands.executeCommand('issueManager.refreshViews')`)

**MCP server 端**:
- `services = new IssueCoreServices(new NodeFsStorage(), issueDir)`
- MCP tool handler:接收 input → 调 service → 包装成 MCP `CallToolResult`(纯文本,无 emoji 链接转换的 `IssueDir/` 约定可以保留,因为外部 Agent 只是把它当文本展示)

### 2.6 配置注入

扩展端 [config.ts:10](../src/config.ts#L10) `getIssueDir()` 通过 `vscode.workspace.getConfiguration` 读取。MCP server 一侧不能用这个,需要:

- MCP server 启动时通过 **环境变量** `ISSUE_MANAGER_DIR` 或**命令行参数** `--issue-dir <path>` 接收
- 推荐环境变量,这样 Claude Agent / Cursor 的 `mcp.json` 里写起来标准
- 如果两者都没提供,启动失败并打印明确错误

### 2.7 对 frontmatter 解析的处理

[IssueMarkdowns.ts](../src/data/IssueMarkdowns.ts) 中 `extractFrontmatterAndBody`、`extractIssueTitleFromFrontmatter`、`extractFrontmatterLines`、术语定位等纯函数都**不依赖 vscode**(只用 `js-yaml` 和 `yaml` 包)。

阶段 1 把这些纯函数**原地移到** `src/services/issue-core/frontmatter.ts`,然后让 [IssueMarkdowns.ts](../src/data/IssueMarkdowns.ts) re-export 保持向后兼容。零行为变更。

---

## 3. MCP server 实现方案

### 3.1 入口与目录

```
src/mcpServer/
  index.ts                    // CLI 入口:解析 --issue-dir、启动 stdio transport、注册工具
  server.ts                   // 创建 Server 实例、绑定 listTools/callTool handler
  tools/
    issueTools.ts             // search_issues, read_issue, create_issue, ...(MCP 工具描述 + handler)
    knowledgeBaseTools.ts     // kb_*(MCP 工具描述 + handler)
  toMcpResult.ts              // 把 ToolCallResult 转 MCP CallToolResult 的小工具
  README.md                   // 给外部 Agent 用户的 MCP 配置说明
```

### 3.2 启动方式

使用 [@modelcontextprotocol/sdk](../node_modules/@modelcontextprotocol/sdk) 的 server 端 API:

```typescript
// index.ts(伪代码,不超过 5 行示意)
import { Server } from '@modelcontextprotocol/sdk/server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
const server = createIssueManagerMcpServer({ issueDir });
await server.connect(new StdioServerTransport());
```

stdio transport 是 ACP Agent 客户端最广泛支持的,无需端口管理。

### 3.3 注册为可执行入口

在 [package.json](../package.json) 里增加:

```jsonc
{
  "bin": {
    "vscode-issue-manager-mcp": "./dist/mcpServer/index.js"
  },
  "scripts": {
    "compile": "webpack",
    "compile:mcp": "tsc -p tsconfig.mcp.json",
    "build:all": "npm run compile && npm run compile:mcp"
  }
}
```

再加 `tsconfig.mcp.json`:`rootDir: src`,`outDir: dist/mcpServer`,`module: commonjs`,只 include `src/mcpServer/**` 和 `src/services/issue-core/**`。**关键约束**:不要 include `src/llmChat/**` 或任何依赖 `vscode` 的代码——这样 tsc 在 MCP server 入口走到任何 vscode import 都会报错,作为护栏防止抽离不彻底。

### 3.4 是否复用 webpack?

**不复用**。

- 当前 [webpack.config.js](../webpack.config.js) 把 `vscode` 声明为 external,扩展产物里 `import * as vscode from 'vscode'` 由 VS Code 运行时提供
- MCP server 是**独立 node 进程**,不存在 `vscode` 模块,任何走到 vscode 的代码会立刻 throw
- 所以 MCP server 必须是一份**完全没有 vscode import 的代码**,用单独的 tsc 编译,且 service 层必须真的不依赖 vscode

**实施提示**:可以加 ESLint 规则 `no-restricted-imports`,在 `src/services/issue-core/**` 和 `src/mcpServer/**` 下禁止 import `vscode`,这是阶段 1 最重要的一道护栏。

### 3.5 外部 Agent 配置示例

放在 `src/mcpServer/README.md`,给用户复制即可:

**Claude Desktop / Claude Code:**

```jsonc
// ~/.config/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "issue-manager": {
      "command": "npx",
      "args": ["-y", "vscode-issue-manager-mcp"],
      "env": {
        "ISSUE_MANAGER_DIR": "/Users/wedaren/repositoryDestinationOfGithub/issue-notes"
      }
    }
  }
}
```

**Cursor / 其他支持 MCP 的客户端**:格式类似,key 路径不同。

### 3.6 工具元数据生成

每个 MCP 工具的 schema 定义最好**复用扩展端的 `LanguageModelChatTool` schema**(因为 schema 很长且都是手写)。

但 `LanguageModelChatTool` 是 vscode 类型,MCP server 不能 import。简单做法:把每个 tool 的 schema 提炼为纯 JSON 对象 `const SEARCH_ISSUES_SCHEMA = { name, description, inputSchema }`,放到 `src/services/issue-core/toolSchemas.ts`(纯数据,不依赖 vscode),然后:

- 扩展端的 [issueTools.ts](../src/llmChat/tools/issueTools.ts) 改为 `BASE_ISSUE_TOOLS = [SEARCH_ISSUES_SCHEMA as vscode.LanguageModelChatTool, ...]`
- MCP server 端的 tools/issueTools.ts 直接 `import { SEARCH_ISSUES_SCHEMA } from '...'`

零分歧、零重复。

### 3.7 错误与日志

- service 层抛 `IssueCoreError` 子类(如 `IssueNotFoundError`、`InvalidPathError`)
- MCP handler catch 后转成 `{ isError: true, content: [{ type: 'text', text: msg }] }`
- 日志走 stderr(stdio MCP 严禁污染 stdout)
- 启动信息(版本、issueDir、工具数)输出到 stderr,方便客户端 debug

---

## 4. 工程改造步骤

按依赖顺序排列,每步 0.5-2 小时,改完即可独立验证。

### 步骤 1:抽离 frontmatter 纯函数(0.5h)

- **改什么**:新建 `src/services/issue-core/frontmatter.ts`,把 [IssueMarkdowns.ts](../src/data/IssueMarkdowns.ts) 中 `extractFrontmatterAndBody`、`extractFrontmatterLines`、`extractIssueTitleFromFrontmatter`、`buildTermLocationMapFromYaml`、`isValidObject`、`normalizeYamlScalar` 等纯函数直接搬过去(**不能依赖 vscode**,只能依赖 `js-yaml` 和 `yaml`)
- 在原 [IssueMarkdowns.ts](../src/data/IssueMarkdowns.ts) 改为 `export { ... } from '../services/issue-core/frontmatter'` 保持 API 不变
- 新建 `src/services/issue-core/types.ts`,把 `FrontmatterData`、`TermDefinition`、`PersistedIssueNode` 等纯 type 搬过来
- **验证**:`npm run compile` 通过,扩展功能不受影响(因为只是文件重组)

### 步骤 2:定义 Storage 抽象 + 两个实现(1h)

- 新建 `src/services/issue-core/Storage.ts` 接口
- 新建 `src/services/issue-core/storage/VscodeStorage.ts`(用 `vscode.workspace.fs`)
- 新建 `src/services/issue-core/storage/NodeFsStorage.ts`(用 `node:fs/promises`)
- VscodeStorage 不在 service 层目录内,而是在子目录 `storage/`:确保 service 层主体不 import vscode
- 加 ESLint 规则:`src/services/issue-core/*.ts`(根级)不允许 import vscode
- **验证**:`tsc --noEmit` 通过

### 步骤 3:实现 IssueRepository(1.5h)

- 新建 `src/services/issue-core/IssueRepository.ts`
- 把 [IssueMarkdowns.ts](../src/data/IssueMarkdowns.ts) 中 `getIssueMarkdown`、`getAllIssueMarkdowns`、`createIssueMarkdown`、`updateIssueMarkdownFrontmatter`、`updateIssueMarkdownBody`、`getIssueMarkdownContent` 的核心 IO 逻辑用 Storage 接口重写
- **不复用缓存**(`_issueMarkdownCache`),每次走 storage(对于 MCP server 是文件 IO,对扩展端是 vscode FS API);如果性能有问题,后续在 service 层加可选缓存
- **临时双轨**:[IssueMarkdowns.ts](../src/data/IssueMarkdowns.ts) 保持不动,新 service 与旧函数并存。扩展端先不改,继续用旧的(因为旧的有缓存和事件)
- **验证**:写一个最小 node 脚本 `scripts/smoke-issue-repo.ts`,用 NodeFsStorage 跑一遍 `getAll`/`create`/`get`/`update`/`delete`,对照真实 issueDir 执行成功

### 步骤 4:实现 IssueTreeRepository(1.5h)

- 同步骤 3,把 [issueTreeManager.ts](../src/data/issueTreeManager.ts) 的核心逻辑(`readTree`、`writeTree`、`createIssueNodes`、`moveNode`、`removeNode`、`findNodeById` 等纯函数 + tree.json IO)搬到 service
- 保留:`onIssueTreeUpdateEmitter` 仍留在原文件,扩展端用;service 层不发事件
- **验证**:同步骤 3,smoke test 跑一遍

### 步骤 5:实现 IssueQuery + KnowledgeBaseService(2h)

- IssueQuery:把 `executeGetLibraryStats`、`executeSearchIssues`、`runKeywordSearch`、`listIssuesByType` 中"读数据 + 算结果"的纯逻辑搬过来,**结果返回结构化数据**(不带 markdown 渲染)
- KnowledgeBaseService:把 `executeKbIngest`、`executeKbCompile`、`executeKbLinkScan`、`executeKbHealthCheck`、`executeKbQuery` 中"读 raw/wiki + 算"的纯逻辑搬过来
- 注意 `executeKbIngest` 的 `mode: 'url'` 用 `https.get`,这部分代码就是纯 node,直接复制(扩展端的实现也是用 node `https`)
- 注意 `executeKbIngest` 的 `mode: 'file'` 路径白名单:在 service 层加 `if (!absPath.startsWith(issueDir))` 校验
- **验证**:smoke test

### 步骤 6:把扩展端工具迁移到 service(1.5h)

- 改 [issueTools.ts](../src/llmChat/tools/issueTools.ts)、[knowledgeBaseTools.ts](../src/llmChat/tools/knowledgeBaseTools.ts):每个 `executeXxx` 函数内部把"读数据+算逻辑"的部分换成调 `services.{issues,tree,query,kb}.xxx(...)`
- 保留:`vscode.commands.executeCommand('issueManager.refreshViews')`、`issueLink` 链接拼接、emoji 等"扩展端展现层"的东西
- `services` 单例在 [extension.ts](../src/extension.ts) 启动时构造,注入或通过 `getIssueCoreServices()` 获取
- **验证**:`npm run compile` + 手动验证扩展功能(随便跑几个工具调用)
- **关键**:此步**完全不破坏现有功能**,只是把工具内部实现替换成调 service。MCP server 还没接入

### 步骤 7:搭 MCP server 骨架(1.5h)

- 新建 `src/mcpServer/{index.ts, server.ts, toMcpResult.ts}`
- 新建 `tsconfig.mcp.json`,只 include `src/mcpServer` 和 `src/services/issue-core`
- `package.json` 加 `bin` 字段、`compile:mcp` script
- 实现:解析 `ISSUE_MANAGER_DIR` 环境变量、构造 `IssueCoreServices(new NodeFsStorage(), issueDir)`、注册一个 dummy `ping` 工具
- **验证**:`npm run compile:mcp` 产出 `dist/mcpServer/index.js`;手动 `node dist/mcpServer/index.js`,用 MCP inspector(或 echo JSON-RPC)验证 stdio 工具列表

### 步骤 8:接入 issue 类工具(1.5h)

- 在 `src/services/issue-core/toolSchemas.ts` 把 19 个工具的 schema 提取为纯 JSON
- 扩展端 [issueTools.ts](../src/llmChat/tools/issueTools.ts) 和 [knowledgeBaseTools.ts](../src/llmChat/tools/knowledgeBaseTools.ts) 改为从 `toolSchemas.ts` 引用
- MCP server 端 `src/mcpServer/tools/issueTools.ts`:注册 14 个 issue 类工具(MCP 工具 = schema + handler,handler 调 `services.xxx`)
- **验证**:用 Claude Desktop 配置 MCP 跑一次 `search_issues` / `read_issue` / `create_issue`,看到结果

### 步骤 9:接入 knowledge base 类工具(1h)

- MCP server 端 `src/mcpServer/tools/knowledgeBaseTools.ts`:注册 5 个 kb 工具
- 注意 `kb_ingest` 的 file 模式路径白名单
- **验证**:`kb_query` 跑通

### 步骤 10:文档与发布(1h)

- 写 `src/mcpServer/README.md`:配置示例(Claude Desktop / Cursor / Continue),环境变量说明,工具列表
- 主 [README.md](../README.md) 加一节"作为 MCP server 使用"
- `package.json` 检查 `files` 字段是否包含 `dist/mcpServer/`,以便 npm 发布后 `npx vscode-issue-manager-mcp` 能跑

**总计**:13.0 小时(约 2 人天)。

---

## 5. 风险与未决问题

### 5.1 实施风险

| 风险 | 缓解 |
|---|---|
| 数据层中"缓存 + 事件"耦合比看起来深(`getAllIssueMarkdowns` 走 `_cacheReady` 热路径) | service 层不复用缓存,扩展端工具仍走 service 后失去缓存优化。**对策**:对 `getAll` 类操作,扩展端 IssueRepository 实现可以接受可选的 `cacheProvider`,优先查缓存命中。第一版可以先不优化,实测有性能问题再加 |
| `createIssueMarkdown` 内部用了 `generateFileName`(基于时间戳),并发调用容易撞名(原代码已加 `setTimeout 1100ms`) | service 层把 `generateFileName` 也搬过来;并发由调用方处理。MCP server 是单 stdio session 串行处理,不会自相撞;扩展端原本也是这个限制 |
| `tree.json` 由两个进程同时写(扩展 + MCP server),会丢更新 | 阶段 1 不解决。在 README 明确写"建议关闭 VS Code 时再用 MCP server,或反之"。阶段 2 加文件锁或 IPC |
| MCP SDK 版本(1.28.0)的 server 端 API 与 client 端是否一致 | 已确认 `node_modules/@modelcontextprotocol/sdk/dist/esm/server/` 存在 `Server`、`StdioServerTransport`,可用 |
| ESLint `no-restricted-imports` 规则配置是否会误伤现有代码 | 只对 `src/services/issue-core/*.ts`(不含 storage/ 子目录)和 `src/mcpServer/**` 生效,不影响其他目录 |
| `delete_issue` 暴露给外部 Agent 后,用户被误删风险高 | 加启动开关 `MCP_ALLOW_DESTRUCTIVE=1`;默认关闭时 server 端不注册 delete 类工具 |

### 5.2 用户决策事项

1. **`create_issue_tree` 是否进 MCP**(§1.3):倾向"进,但 nodes 上限 8";请确认
2. **`delete_issue` / `batch_delete_issues` 是否进 MCP**:倾向"进,默认关闭,环境变量 opt-in";请确认
3. **`kb_ingest mode=file` 的路径白名单**:仅 issueDir 内 vs 完全不暴露;倾向前者
4. **MCP server 包发布形式**:作为同一个 npm 包的 `bin`(用户 `npx vscode-issue-manager-mcp`)vs 独立 npm 包 `vscode-issue-manager-mcp-server`;倾向前者(单包简单)
5. **API schema 是否在阶段 1 就拆到 `toolSchemas.ts`**:增加少量工作但显著降低未来分歧风险;倾向"是"
6. **是否同时支持环境变量和命令行 `--issue-dir`**:倾向"环境变量为主,命令行为辅"(命令行覆盖环境变量),便于不同客户端配置
7. **结果格式**:扩展端工具返回带 emoji+`IssueDir/` 链接的 markdown;MCP 端是否也保留这个格式?倾向**保留**(外部 Agent 直接当文本展示,链接看不见也无伤大雅;移除会增加 service 层 API 复杂度)

---

## 6. 工程量估算

| 步骤 | 估算 |
|---|---|
| 1. 抽离 frontmatter 纯函数 | 0.5h |
| 2. Storage 抽象 + 两实现 | 1.0h |
| 3. IssueRepository | 1.5h |
| 4. IssueTreeRepository | 1.5h |
| 5. IssueQuery + KnowledgeBase | 2.0h |
| 6. 扩展端工具迁移 | 1.5h |
| 7. MCP server 骨架 | 1.5h |
| 8. 接入 issue 工具 | 1.5h |
| 9. 接入 KB 工具 | 1.0h |
| 10. 文档与发布 | 1.0h |
| **总计** | **13.0h ≈ 2 人天** |

**关键路径**:步骤 2 → 3 → 4 → 5(service 层串行),其中 3 + 4 可以并行(各自只依赖步骤 2 的 Storage)。

**风险缓冲**:建议加 30% buffer = **2.5-3 人天**实际预期。

**最早可对外公布**:步骤 8 完成后(约 1.5 人天),即可让外部 Agent 通过 MCP 调用 14 个 issue 类工具;步骤 9 完成 5 个 kb 工具是增量收益。

---

## 附录:与阶段 2 的衔接

阶段 1 完成后,扩展端和 MCP server 端都共享同一份 `IssueCoreServices`,但走两条独立路径(扩展端用 vscode.lm 调 LLM,MCP server 没有 LLM)。这为阶段 2 留好了底盘:

- 阶段 2 可以新增 `src/acpAgent/` 目录,把扩展端的 [ConversationExecutor.ts](../src/llmChat/ConversationExecutor.ts) 包装成一个 ACP Agent server,让外部客户端不仅能"调工具"(MCP)还能"用 LLM 跑 agent loop"(ACP)。这是后话。
- 阶段 1 的 service 层和 toolSchemas 是阶段 2 的复用基础,不会浪费。
