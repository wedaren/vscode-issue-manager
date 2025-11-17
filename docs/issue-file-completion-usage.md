# Issue 文件智能补全功能

## 功能说明

在编辑 issue 目录下的 Markdown 文件时，支持按 `Ctrl+Space` 快速补全引用其他 issue 文档。

**特点**：
- 数据来源于问题总览树（tree.json），而非简单的文件列表
- 显示格式与 `issueManager.searchIssuesInFocused` 命令完全一致
- 包含完整的父节点路径，方便识别文件位置
- 按修改时间排序，最近修改的优先显示

## 使用方法

### 1. 基础补全
在 Markdown 文件中输入文本后，按 `Ctrl+Space`（macOS: `Cmd+Space`）：

```markdown
参考 bug      ← 按 Ctrl+Space
```

系统会显示包含 "bug" 的所有 issue 文件，选择后自动插入相对路径。

### 2. Wiki 风格链接
使用 `[[` 触发 wiki 风格链接补全：

```markdown
见 [[readme   ← 自动触发补全
```

选择文件后自动补全为：
```markdown
见 [[README 文件标题]]
```

### 3. 过滤规则

系统会自动提取"空格到光标之间的内容"作为过滤关键字：

| 输入 | 过滤关键字 |
|------|-----------|
| `参考 文档 bug` | `bug` |
| `见 [[readme` | `readme` |
| `链接: (doc)` | `doc` |
| `path/to/file` | `path/to/file` |

### 4. 匹配规则

只要节点标题、父节点路径或文件名中**包含**关键字就会显示，结果按修改时间排序（最近修改的优先）。

**匹配字段**：
- 节点标题（从 titleCache 获取）
- 父节点路径（完整的树路径）
- 文件名

示例（假设有树结构：`项目A / Bug修复 / 登录问题.md`）：
- 输入 `bug` 会匹配：
  - 标题包含 "Bug" 的节点
  - 路径包含 "Bug修复" 的节点
- 输入 `登录` 会匹配：
  - 标题为 "登录问题" 的节点
  - 路径中包含 "登录" 的任何节点

**显示格式**（与 searchIssues 一致）：
```
登录问题                    ← 节点标题
 / 项目A / Bug修复          ← 父节点路径
```

## 配置选项

在 VS Code 设置中可以自定义行为：

### 插入格式 (`issueManager.completion.insertMode`)
- `relativePath` (默认) - 插入相对路径：`./path/to/file.md`
- `markdownLink` - 插入 Markdown 链接：`[标题](./path/to/file.md)`
- `filename` - 仅插入文件名：`file.md`

### 其他配置
```json
{
  // 最大显示数量
  "issueManager.completion.maxItems": 200,
  
  // 触发前缀（支持多个）
  "issueManager.completion.triggers": ["[["],
  
  // 关键字最大长度
  "issueManager.completion.maxFilterLength": 200
}
```

## 示例场景

### 场景 1：引用相关 issue
```markdown
这个问题与 bug-2025-11    ← Ctrl+Space
```
选择后：
```markdown
这个问题与 ../bugs/bug-2025-11-15-login-error.md
```

### 场景 2：创建内部链接
```markdown
详见 [[架构设计    ← 自动触发
```
选择后：
```markdown
详见 [[架构设计文档]]
```

### 场景 3：快速查找
直接按 `Ctrl+Space`（不输入关键字）显示所有文件，按修改时间排序。

## 性能说明

- **首次加载**：扩展激活时异步预加载文件索引，不影响启动速度
- **实时更新**：自动监听文件变化，保持索引最新
- **缓存优化**：复用标题缓存，避免重复读取文件
- **数量限制**：默认最多显示 200 个结果，可配置

## 快捷键

| 操作 | Windows/Linux | macOS |
|------|--------------|-------|
| 触发补全 | `Ctrl+Space` | `Cmd+Space` |

注意：如果与系统快捷键冲突，可在 VS Code 快捷键设置中修改 `editor.action.triggerSuggest` 命令的绑定。

## 常见问题

**Q: 为什么没有显示补全？**
- 确保当前文件是 Markdown 格式
- 确保文件位于配置的 `issueManager.issueDir` 目录下
- 检查是否有其他扩展占用了补全快捷键

**Q: 补全列表为空？**
- 可能是过滤关键字太严格，尝试删除部分关键字
- 确保 issue 目录下有 .md 文件
- 检查扩展输出面板的日志

**Q: 如何禁用此功能？**
- 目前没有专门的开关，但可以通过设置 `issueManager.completion.triggers` 为空数组来避免自动触发
- 或者在非 issue 目录下编辑文档

## 技术细节

详细的技术实现和架构设计，请参阅：
- [完整实现文档](./docs/issue-file-completion-feature.md)
- [源代码](./src/providers/IssueFileCompletionProvider.ts)
