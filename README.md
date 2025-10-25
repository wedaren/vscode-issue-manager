# 问题管理器 (Issue Manager)

一个强大的 VS Code 扩展，帮助您以树状结构高效管理和组织本地 Markdown 问题文件。通过智能创建、灵活关联和专注追踪功能，让您的知识管理更加有序和高效。

## ✨ 核心特性

### 🧠 智能问题创建
- **AI 增强**: 利用 LLM 智能优化问题标题，并从您的知识库中寻找相似问题。
- **统一体验**: 在一个界面中完成新问题创建和相关内容发现。
- **多选操作**: 支持同时创建多个新问题或打开多个已有问题。
- **Copilot 集成**: 在聊天过程中直接将讨论内容保存为结构化的 Markdown 问题。

### 📊 四视图管理体系
- **问题总览**: 以树状结构展示所有问题的层级和关联关系。
- **孤立问题**: 收件箱模式，自动收集所有未建立关联的新问题。
- **关注问题**: 过滤并展示您标记为“关注”的重要问题及其上下文。
- **最近问题**: 快速访问近期创建或修改过的问题，支持列表和按时间分组两种模式。

### 🔗 灵活关联与交互
- **拖拽组织**: 通过拖拽轻松建立问题间的父子或同级关系。
- **多重引用**: 同一问题可在树中多处引用，实现灵活分类。
- **复制文件名**: 在任意视图中右键点击问题，即可复制其文件名（如 `20250708-103000-000.md`），方便引用和查找。
- **编辑器联动**:
    - 从视图拖拽问题到编辑器，可自动生成 Markdown 链接。
    - 在视图中点击问题，在编辑器中打开。
    - 在编辑器中打开问题文件，视图会自动高亮对应节点。

## 🚀 快速开始

### 1. 配置问题目录
首次使用时，需要配置问题存储目录：

1. 打开 VS Code 设置 (`Cmd/Ctrl + ,`)
2. 搜索 `issueManager.issueDir`
3. 设置一个绝对路径，如：`/Users/yourname/Documents/Issues`

或者点击插件视图中的"立即配置"链接直接跳转到设置页面。

### 2. 创建第一个问题
- 使用快捷键 `Cmd+Shift+N` (macOS) 或 `Ctrl+Shift+N` (Windows/Linux)
- 或在命令面板中运行 `新建问题`
- 输入问题描述，AI 将为您优化标题并提供相关建议

### 3. 组织问题结构
- 从"孤立问题"视图拖拽问题到"问题总览"
- 建立父子关系，构建知识层级
- 使用"关注问题"追踪重要内容

## 📋 使用场景

### 👩‍💻 开发者
- 管理技术问题和解决方案
- 构建知识库和最佳实践
- 追踪项目相关的技术决策

### 📚 研究人员
- 组织研究课题和文献笔记
- 建立研究问题的层级结构
- 管理实验记录和发现

### 📝 写作者
- 管理写作素材和灵感
- 组织文章大纲和章节
- 追踪创作进度和待办事项

## ⚙️ 扩展设置

此扩展提供以下配置选项：

### 基本设置

| 配置项 | 类型 | 默认值 | 描述 |
|--------|------|--------|------|
| `issueManager.issueDir` | 字符串 | `""` | **必需** 问题文件存储的绝对路径 |
| `issueManager.createIssue.enableIntelligence` | 布尔值 | `true` | 启用/禁用 AI 智能创建功能 |
| `issueManager.createIssue.similarResultsCount` | 数字 | `5` | 相似问题建议数量 |
| `issueManager.createIssue.optimizedPhrasingsCount` | 数字 | `3` | AI 优化建议数量 |
| `issueManager.recentIssues.defaultMode` | 字符串 | `grouped` | 最近问题视图默认显示模式，可选值 `'grouped'`（分组）或 `'list'`（列表） |
| `issueManager.titleCache.rebuildIntervalHours` | 数字 | `24` | 标题缓存自动重建的过期时长（小时）。超过此间隔将于下次预加载时全量重建。设为 `0` 可禁用按时间的自动重建（但文件缺失仍会重建）。 |

### Git 自动同步设置

| 配置项 | 类型 | 默认值 | 描述 |
|--------|------|--------|------|
| `issueManager.sync.enableAutosync` | 布尔值 | `false` | 启用 Git 自动同步功能 |
| `issueManager.sync.autoCommitMessage` | 字符串 | `[Auto-Sync] Changes at {date}` | 自动提交消息模板，`{date}` 会被替换为当前时间 |
| `issueManager.sync.changeDebounceInterval` | 数字 | `300` | 文件变更后触发同步前的等待时间（秒），默认 5 分钟 |
| `issueManager.sync.periodicPullInterval` | 数字 | `15` | 后台周期性拉取远程更新的间隔（分钟），设为 0 可禁用 |
| `issueManager.sync.maxRetries` | 数字 | `3` | 同步失败时的最大自动重试次数，设为 0 可禁用重试 |
| `issueManager.sync.retryInitialDelay` | 数字 | `5` | 同步重试的初始延迟时间（秒），后续重试使用指数退避 |
| `issueManager.sync.enableNotifications` | 布尔值 | `true` | 启用同步失败时的桌面通知，禁用后仅在状态栏显示 |

### 最近问题视图分组与展开说明

最近问题视图支持“列表模式”和“分组模式”两种展示方式。

- 当分组模式为默认或手动切换时，一级分组（如“今天”、“最近一周” 等）会自动展开，方便快速浏览。
- 子分组（如“本周”下的具体日期分组）默认折叠，避免界面过度冗长。
- 该行为无需额外配置，已内置于插件逻辑。

### 配置示例

在您的 `settings.json` 中添加：

```json
{
  "issueManager.issueDir": "/Users/yourname/Documents/MyIssues",
  "issueManager.createIssue.enableIntelligence": true,
  "issueManager.createIssue.similarResultsCount": 5,
  "issueManager.createIssue.optimizedPhrasingsCount": 3,
  "issueManager.recentIssues.defaultMode": "grouped",
  
  // Git 自动同步配置
  "issueManager.sync.enableAutosync": true,
  "issueManager.sync.autoCommitMessage": "[Auto-Sync] Changes at {date}",
  "issueManager.sync.changeDebounceInterval": 300,
  "issueManager.sync.periodicPullInterval": 15,
  "issueManager.sync.maxRetries": 3,
  "issueManager.sync.retryInitialDelay": 5,
  "issueManager.sync.enableNotifications": true
}
```

## 📁 数据存储与文件结构

所有插件数据都存储在问题目录下的 `.issueManager/` 隐藏文件夹中：

```text
你的问题目录/
├── .issueManager/
│   ├── tree.json          # 问题的树状结构和层级关系
│   ├── focused.json       # 关注问题的状态信息
│   ├── titleCache.json    # 问题标题缓存（提升性能）
│   └── .gitignore         # 版本控制配置
├── 20250101-120000-001.md # 问题文件（时间戳命名）
├── 20250102-143000-002.md
└── ...
```

这种设计确保了：

- **自包含性**: 整个知识库可以轻松复制和移动
- **可移植性**: 支持版本控制和多设备同步
- **透明性**: 所有数据都是可读的 JSON 和 Markdown 文件

## 🎯 核心优势

### 🔄 无缝集成

- 完全基于本地 Markdown 文件
- 与现有工作流程完美融合
- 支持任意文本编辑器查看和编辑

### 🎨 直观操作

- 清晰的视觉层级结构
- 拖拽式问题组织
- 实时同步和更新

### 🛡️ 数据安全

- 所有数据存储在本地
- 支持版本控制和备份
- 损坏文件自动恢复机制

### 🚀 性能优化

- 智能缓存机制
- 懒加载和按需更新
- 防抖处理避免频繁操作

## 📝 主要功能详解

### 智能问题创建流程

1. **输入**: 用户输入问题描述
2. **AI 处理**: LLM 优化标题并搜索相似内容
3. **统一选择**: 在一个界面中选择创建新问题或打开相关文件
4. **多选支持**: 可同时创建多个问题或打开多个相关文件

### 四视图协同工作

- **问题总览**: 主视图，展示完整的问题层级结构
- **孤立问题**: 收件箱，自动收集未分类的新问题
- **关注问题**: 过滤视图，专注于重要问题
- **最近问题**: 快速访问近期活动的问题

### 拖拽操作规则


- 拖拽到问题节点上：被拖拽的问题会作为目标节点的第一个子节点（最顶部），与“新建子问题”行为一致。
- 拖拽到间隙：创建同级关系，插入到指定位置。
- 拖拽到空白区域：被拖拽的问题会作为第一个顶层节点（最顶部）。
- 支持从编辑器拖拽 `.md` 文件到视图中。

## 🐛 已知问题

目前没有已知的重大问题。如果您遇到任何问题，请：

1. 检查 `issueManager.issueDir` 配置是否正确
2. 确保指定的目录具有读写权限
3. 查看 VS Code 开发者控制台的错误信息
4. 在 [GitHub Issues](https://github.com/wedaren/vscode-issue-manager/issues) 中报告问题

## 🔧 开发和贡献

本项目采用 TypeScript 开发，使用现代的 VS Code 扩展 API。

### 开发环境设置

```bash
# 克隆项目
git clone https://github.com/wedaren/vscode-issue-manager.git

# 安装依赖
npm install

# 开发模式（启用文件监听）
npm run watch

# 编译
npm run compile

# 运行测试
npm run test
```

## 📎 剪贴板快速创建问题（新功能）

插件现在支持通过快捷键从系统剪贴板快速新建问题：

- 快捷键（macOS）: `Cmd+J` 紧接 `Cmd+B`。
- 快捷键（Windows/Linux）: `Ctrl+J` 紧接 `Ctrl+B`。

行为：
- 当剪贴板内容的第一行为 Markdown 一级标题（以 `# ` 开头）时，插件会直接将剪贴板内容（包括标题）写入新的 Markdown 问题文件。
- 当剪贴板内容没有 H1 标题时，插件会调用内置的 LLM（Copilot）生成一个简洁精确的 H1 标题并插入到内容前面，然后写入新文件。
- 如果剪贴板为空，命令不会创建文件并会弹出信息提示。
- 如果 LLM 调用失败或未返回可用标题，插件会使用占位标题 `# Untitled Issue` 创建文件，并向用户弹窗提示需要手动修改。

注意：要使用 LLM 生成功能，您需要在 VS Code 中安装并登录支持的 Copilot 模型（本扩展通过 VS Code 的 language model API 调用）。

## 🔄 Git 自动同步

本扩展提供强大的 Git 自动同步功能，帮助您在多设备间无缝同步问题文件。

### 核心特性

#### 🤖 智能自动化
- **文件变更检测**：自动监听 Markdown 文件和配置文件的变化
- **防抖处理**：文件变更后等待 5 分钟（可配置）才触发同步，避免频繁提交
- **周期性拉取**：每 15 分钟（可配置）自动从远程拉取更新
- **自动重试**：网络错误时自动重试最多 3 次（可配置），使用指数退避策略

#### 🔔 增强的通知系统
- **状态栏显示**：实时显示同步状态，错误时使用醒目的警告背景色
- **桌面通知**：同步失败时显示带操作按钮的通知（可配置）
- **详细日志**：所有同步操作记录在"Git自动同步"输出通道中
- **智能提示**：根据错误类型提供不同的操作选项

#### 🛡️ 可靠的错误处理
- **智能重试**：自动判断哪些错误可以重试（如网络错误），哪些需要手动处理（如冲突）
- **冲突检测**：检测到合并冲突时自动暂停同步，显示详细的解决指引
- **错误诊断**：记录完整的错误堆栈和上下文信息，方便诊断问题
- **优雅降级**：周期性拉取失败不会进入冲突模式，不影响正常使用

### 使用步骤

1. **初始化 Git 仓库**
   ```bash
   cd /path/to/your/issues
   git init
   git remote add origin <your-repo-url>
   ```

2. **配置自动同步**
   - 打开 VS Code 设置
   - 启用 `issueManager.sync.enableAutosync`
   - 根据需要调整其他同步参数

3. **开始使用**
   - 编辑问题文件，保存后会自动触发同步
   - 点击状态栏的同步图标可以手动触发同步
   - 查看"Git自动同步"输出通道了解详细日志

### 状态栏图标说明

- `$(sync) Git同步` - 已同步，本地和远程保持一致
- `$(sync~spin) 同步中...` - 正在执行同步操作
- `$(cloud-upload) 待同步` - 检测到本地更改，等待同步
- `$(warning) 同步失败` - 同步失败（使用警告背景色），点击查看详情

### 处理同步冲突

当多设备同时编辑同一文件时，可能会产生合并冲突。此时：

1. 扩展会显示详细的冲突解决对话框
2. 自动化功能会暂停，避免覆盖您的工作
3. 按照对话框中的步骤解决冲突：
   - 打开问题目录，找到有冲突标记的文件
   - 编辑文件，删除冲突标记（`<<<<<<< HEAD`）
   - 保存文件后，点击状态栏图标手动同步

4. 冲突解决后，自动同步功能会自动恢复

### 故障排除

#### 同步失败
- 查看"Git自动同步"输出通道，了解失败原因
- 检查网络连接和 Git 远程仓库配置
- 如果是网络问题，扩展会自动重试

#### SSH 连接错误
- 确保 SSH 密钥已正确配置
- 测试 SSH 连接：`ssh -T git@github.com`
- 查看输出通道中的详细错误信息

#### 认证失败
- 检查 Git 凭据是否正确
- 对于 HTTPS，可能需要更新 Git 凭据
- 对于 SSH，确保公钥已添加到远程仓库

### 项目结构

```text
src/
├── extension.ts           # 扩展入口点
├── config.ts             # 配置管理
├── data/                 # 数据管理
│   ├── treeManager.ts    # 树结构数据管理
│   └── focusedManager.ts # 关注状态管理
├── views/                # 视图提供者
│   ├── IssueOverviewProvider.ts
│   ├── IsolatedIssuesProvider.ts
│   ├── FocusedIssuesProvider.ts
│   ├── RecentIssuesProvider.ts
│   └── IssueDragAndDropController.ts
├── llm/                  # LLM 集成
│   ├── LLMService.ts
│   └── RecordContentTool.ts
└── utils/                # 工具函数
    ├── fileUtils.ts
    ├── markdown.ts
    └── debounce.ts
```

## 📄 许可证

本项目采用 MIT 许可证。详见 [LICENSE](LICENSE) 文件。

## 🔗 相关链接

- [GitHub 仓库](https://github.com/wedaren/vscode-issue-manager)
- [VS Code 市场](https://marketplace.visualstudio.com/items?itemName=wedaren.issue-manager)
- [问题反馈](https://github.com/wedaren/vscode-issue-manager/issues)
- [VS Code 扩展指南](https://code.visualstudio.com/api/references/extension-guidelines)

---

**享受高效的问题管理体验！** 🎉
