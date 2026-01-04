# Git 分支功能使用说明

## 功能概述

Git 分支功能以 TreeView 形式可视化展示 Git 分支拓扑，支持分支管理及 Issue 关联。

## 视图结构

### 一级节点 - 分支列表
- 显示所有分支（本地和远程）
- 按最后提交时间降序排列
- 分支名称格式：
  - 当前分支：`HEAD → <分支名>`
  - 普通分支：`<分支名>`
  - 多分支指向同一提交：`<分支1>, <分支2>, ...`
- 显示最后提交时间：`(last commit: YYYY-MM-DD)`

### 二级节点 - 父分支
- 每个分支下显示其父分支
- 父分支通过以下方式确定：
  1. Git 配置中的上游分支
  2. merge-base 分析找到的最近共同祖先

## 可用操作

### 工具栏操作
- **刷新**：刷新 Git 分支视图
- **创建分支**：创建新分支

### 分支节点右键菜单
- **检出分支**：切换到选中的分支
- **创建分支**：基于选中的分支创建新分支
- **删除分支**：删除选中的分支（本地分支）
- **关联 Issue**：将分支关联到一个 Issue
- **取消关联**：取消分支与 Issue 的关联

## Issue 关联功能

### 关联 Issue
1. 在分支节点上右键点击
2. 选择"关联 Issue"
3. 快速创建或选择一个 Issue

### 打开关联的 Issue
- 点击已关联 Issue 的分支节点，自动打开关联的 Issue 文件

## UI 示例

```
Git 分支
├── origin/master, origin/HEAD (last commit: 2026-01-02)
├── HEAD → main, fix/ui (last commit: 2026-01-03)
│   ├── feature/login (last commit: 2026-01-02)
│   └── feature/ui (last commit: 2026-01-01)
├── fix/ui, HEAD → main (last commit: 2026-01-03)
│   ├── feature/login (last commit: 2026-01-02)
│   └── feature/ui (last commit: 2026-01-01)
└── develop (last commit: 2025-12-30)
    └── feature/payment (last commit: 2026-01-02)
```

## 注意事项

1. **Git 仓库要求**：此功能需要工作区打开的是 Git 仓库
2. **性能考虑**：在分支很多的仓库中，父分支查找可能需要一些时间
3. **数据持久化**：分支与 Issue 的关联关系存储在 VS Code 全局状态中

## 技术实现

### 文件结构
- `src/git/GitBranchManager.ts`：Git 分支管理器，负责读取分支信息
- `src/git/GitBranchTreeProvider.ts`：TreeView 数据提供者
- `src/git/GitBranchCommandHandler.ts`：命令处理器

### 使用的库
- `simple-git`：Git 操作库

### 命令列表
- `issueManager.gitBranch.refresh`：刷新视图
- `issueManager.gitBranch.checkout`：检出分支
- `issueManager.gitBranch.create`：创建分支
- `issueManager.gitBranch.delete`：删除分支
- `issueManager.gitBranch.associateIssue`：关联 Issue
- `issueManager.gitBranch.disassociate`：取消关联
- `issueManager.gitBranch.openAssociatedIssue`：打开关联的 Issue
