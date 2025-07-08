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

| 配置项 | 类型 | 默认值 | 描述 |
|--------|------|--------|------|
| `issueManager.issueDir` | 字符串 | `""` | **必需** 问题文件存储的绝对路径 |
| `issueManager.createIssue.enableIntelligence` | 布尔值 | `true` | 启用/禁用 AI 智能创建功能 |
| `issueManager.createIssue.similarResultsCount` | 数字 | `5` | 相似问题建议数量 |
| `issueManager.createIssue.optimizedPhrasingsCount` | 数字 | `3` | AI 优化建议数量 |

### 配置示例

在您的 `settings.json` 中添加：

```json
{
  "issueManager.issueDir": "/Users/yourname/Documents/MyIssues",
  "issueManager.createIssue.enableIntelligence": true,
  "issueManager.createIssue.similarResultsCount": 5,
  "issueManager.createIssue.optimizedPhrasingsCount": 3
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

- 拖拽到问题上：创建父子关系
- 拖拽到间隙：创建同级关系
- 拖拽到空白区域：创建顶层问题
- 支持从编辑器拖拽 `.md` 文件到视图中

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
