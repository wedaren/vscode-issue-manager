# 策略1 自动 Frontmatter 维护 - 完整实现

## 概述

策略1实现了自动的 frontmatter 维护机制，确保在文件创建、删除和编辑时，相关文件的 children_files 和 parent_file 字段保持一致。这解决了新文档无法正确展示在 TreeView 中的问题。

## 核心功能

### 1. 文件创建处理 (shouldRefreshForNewFile)

- **触发时机**: 当新 markdown 文件被创建时
- **处理逻辑**: 
  - 检查新文件是否与当前激活文件在同一结构树中
  - 自动将新文件添加到父文件的 children_files 数组
  - 自动设置新文件的 parent_file 字段
- **用户体验**: 新建文件后自动出现在 TreeView 中，无需手动编辑 frontmatter

### 2. 文件删除处理 (shouldRefreshForDeletedFile)

- **触发时机**: 当 markdown 文件被删除时
- **处理逻辑**:
  - 检查被删除文件是否在当前结构树中
  - 自动从其父文件的 children_files 数组中移除
  - 清理所有相关的引用关系
- **用户体验**: 删除文件后自动从 TreeView 中消失，相关文件的 frontmatter 自动更新

### 3. 文件编辑处理 (shouldRefreshForChangedFile)

- **触发时机**: 当用户手动编辑文件内容时
- **处理逻辑**:
  - 检测 frontmatter 的结构性变化
  - 同步 children_files 和 parent_file 之间的双向引用关系
  - 自动修正不一致的引用关系
- **用户体验**: 手动修改 frontmatter 后，系统自动同步相关文件，保持结构一致性

## 技术实现

### 文件系统监听器增强

```typescript
const fileWatcher = vscode.workspace.createFileSystemWatcher(
    pattern,
    false, // 监听创建
    false, // 监听变更
    false  // 监听删除
);
```

### 自动 Frontmatter 更新

- 使用 `js-yaml` 安全解析和修改 YAML frontmatter
- 通过 `vscode.WorkspaceEdit` API 进行安全的文件编辑
- 支持撤销操作，保持编辑器体验一致性

### 性能优化

- **缓存机制**: 使用 mtime 缓存 frontmatter 数据，避免重复 I/O
- **智能刷新**: 只在相关文件变更时刷新 TreeView
- **批量更新**: 一次操作中处理所有相关的引用关系

## 使用场景

### 场景 1: 创建新文档
1. 用户在 issue 目录下创建新的 markdown 文件
2. 系统检测到文件创建事件
3. 自动将新文件添加到当前激活文件的 children_files
4. 新文件的 parent_file 被自动设置
5. TreeView 自动刷新显示新文件

### 场景 2: 删除文档
1. 用户删除一个 markdown 文件
2. 系统检测到文件删除事件
3. 自动从父文件的 children_files 中移除该文件
4. TreeView 自动刷新，文件从结构中消失

### 场景 3: 手动编辑结构
1. 用户手动修改文件的 frontmatter（如改变 parent_file）
2. 系统检测到文件内容变化
3. 自动同步相关文件的引用关系
4. 确保双向引用的一致性
5. 用户收到自动同步的通知

## 错误处理

- **文件不存在**: 忽略对不存在文件的引用
- **无效 YAML**: 跳过无法解析的 frontmatter
- **权限问题**: 静默处理，不影响用户操作
- **循环引用**: 检测并防止无限循环

## 用户通知

系统会在以下情况显示友好的通知消息：

- 新文件被自动添加到结构中
- 文件被自动从结构中移除
- 手动编辑导致的自动同步操作

## 与现有功能的集成

策略1完全兼容现有的：
- TreeView 渲染逻辑
- Issue 导航功能
- 文件搜索功能
- 其他插件命令

## 下一步计划

- [ ] 添加单元测试覆盖关键路径
- [ ] 支持批量文件操作的优化
- [ ] 添加配置选项控制自动维护行为
- [ ] 优化大型项目的性能表现

## 总结

策略1的实现彻底解决了新文档无法正确展示的问题，同时提升了用户体验，减少了手动维护 frontmatter 的工作量。通过智能的自动化处理，确保了 issue 结构的一致性和可靠性。
