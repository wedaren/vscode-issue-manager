# vscode-issue-manager MCP server

把 `vscode-issue-manager` 扩展的核心能力(笔记 / 知识库 / 树关系)以 MCP 协议暴露,让任何支持 MCP 的客户端(Claude Desktop、Claude Code、Cursor、Continue、ACP Agent 等)直接调用。

## 启动

```bash
ISSUE_MANAGER_DIR=/path/to/your/issue-notes node ./dist/mcpServer/mcpServer/index.js
```

或通过 `--issue-dir` 参数:

```bash
node ./dist/mcpServer/mcpServer/index.js --issue-dir /path/to/your/issue-notes
```

发布到 npm 后,可直接 `npx vscode-issue-manager-mcp`。

## 客户端配置示例

### Claude Desktop / Claude Code

`~/.config/Claude/claude_desktop_config.json`:

```jsonc
{
  "mcpServers": {
    "issue-manager": {
      "command": "npx",
      "args": ["-y", "vscode-issue-manager-mcp"],
      "env": {
        "ISSUE_MANAGER_DIR": "/Users/me/issue-notes"
      }
    }
  }
}
```

启用破坏性工具(`delete_issue` / `batch_delete_issues`):

```jsonc
{
  "mcpServers": {
    "issue-manager": {
      "command": "npx",
      "args": ["-y", "vscode-issue-manager-mcp"],
      "env": {
        "ISSUE_MANAGER_DIR": "/Users/me/issue-notes",
        "MCP_ALLOW_DESTRUCTIVE": "1"
      }
    }
  }
}
```

### Cursor

`mcp.json` 格式相同,放在 Cursor 设置目录。

## 暴露的工具

19 个工具,分为两组。**`delete_issue` 和 `batch_delete_issues` 默认禁用**,需通过 `MCP_ALLOW_DESTRUCTIVE=1` 显式启用。

### Issue 笔记工具(14 个)

| 工具 | 用途 |
|---|---|
| `get_library_stats` | 笔记库概览,各类型计数 + 最近笔记 |
| `search_issues` | 多关键词搜索,支持类型过滤 / 范围 |
| `read_issue` | 读取 issue 全文,支持 offset/maxChars 分页 |
| `create_issue` | 创建笔记,自动挂到 tree.json 根级 |
| `create_issue_tree` | 一次创建带层级关系的多个笔记(上限 8 个节点) |
| `list_issue_tree` | 浏览树结构 |
| `update_issue` | 更新标题 / 描述 / 正文(支持 append) |
| `link_issue` | 建立父子关联 |
| `unlink_issue` | 解除关联(移到根级或完全移除) |
| `get_issue_relations` | 查询父 / 子 / 兄弟 / 祖先链 |
| `move_issue_node` | 移到指定父节点的指定位置 |
| `sort_issue_children` | 按 title/mtime/ctime 排序 |
| `delete_issue` | 删除文件 + 解除关联(默认禁用) |
| `batch_delete_issues` | 批量删除(默认禁用) |

### 知识库工具(5 个)

| 工具 | 用途 |
|---|---|
| `kb_ingest` | 导入 URL/text/file 到 raw/(file 模式仅允许 issueDir 内的路径) |
| `kb_compile` | 编译 raw/ 到 wiki/ |
| `kb_link_scan` | 扫描 wiki/ 链接完整性 |
| `kb_health_check` | 桩文章 / 过时 / 重复 / 覆盖率检查 |
| `kb_query` | 在 wiki/ 中关键词搜索 |

## 安全策略

- `delete_issue` / `batch_delete_issues`:默认禁用。需 `MCP_ALLOW_DESTRUCTIVE=1` 启用。
- `kb_ingest mode=file`:**仅允许读取 `ISSUE_MANAGER_DIR` 路径下的文件**。试图读取 issueDir 外的路径会返回错误。
- 其它工具均限定在 `ISSUE_MANAGER_DIR` 内的 `*.md` 文件。

## 与扩展并发使用的注意事项

MCP server 与 VS Code 扩展是**两个独立进程**,共用同一个 `issueDir`。Phase 1 不解决并发写冲突,**建议同一时间只有一方在频繁写入**:

- 编辑器开着 → 主要由扩展写,MCP server 主要做只读 / 偶发写
- 编辑器关闭 → MCP server 可以自由读写
- 重度并发场景(多客户端连续 `update_issue` / `create_issue_tree`)可能丢失最近写入

`tree.json` 同样不带文件锁。如果出现 tree 状态不一致,关闭所有客户端后再开任一方重新加载即可恢复。

## 协议复用

返回的 markdown 中链接采用 `[\`title\`](IssueDir/fileName.md)` 约定,**消费方应把 `IssueDir/` 替换为真实 issueDir 路径**(或忽略,只把它当文本展示)。这与扩展端工具输出格式一致,方便复用。

## 局限与后续

- 扩展进程内的工具(role / delegation / planning / todos / terminal / browsing / diagram)**未通过 MCP 暴露**——这些是 agent 内部协作机制,外部 Agent 自己有等价能力。
- service 层不带缓存(扩展端的 `_issueMarkdownCache` 不复用),每次走文件 IO。19000+ 文件的库 `get_library_stats` 耗时数秒;后续可加可选缓存。
- frontmatter `_typeIndex` 也不复用,统计/过滤都是全扫描。同上。
