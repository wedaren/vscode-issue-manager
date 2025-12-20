# VS Code Markdown 层级结构功能指南

## 概述

本功能基于 Markdown 文件的 Frontmatter 元数据字段，实现了一套虚拟的层级树结构管理系统。文件的物理位置可以在任意目录，但通过 Frontmatter 中的 `issue_root`、`issue_parent` 和 `issue_children` 字段，可以构建出逻辑上的层级关系。

## 核心概念

### 1. 物理层 vs 逻辑层

- **物理层**: 文件在磁盘上的实际位置和文件夹结构
- **逻辑层**: 通过 Frontmatter 字段定义的父子关系和层级结构

两者完全独立，文件可以在物理上位于不同文件夹，但在逻辑上形成层级关系。

### 2. Frontmatter 字段

在 Markdown 文件的开头，使用 YAML 格式定义以下字段：

```yaml
---
issue_root: root-file.md
issue_parent: parent-file.md
issue_children:
  - child1.md
  - child2.md
---
```

#### 字段说明

| 字段名 | 类型 | 作用 | 示例 |
|--------|------|------|------|
| `issue_root` | string | 标识所属项目的根节点文件路径 | `project-root.md` |
| `issue_parent` | string \| null | 标识直接上级文件的路径 | `parent-file.md` |
| `issue_children` | array | 有序的子节点文件路径列表 | `['child1.md', 'child2.md']` |

**注意**: 所有路径都是相对于 `issueDir` 配置的目录。

## 功能特性

### 1. 逻辑层级树视图

在 VS Code 侧边栏的"逻辑层级树"视图中，可以看到基于 Frontmatter 字段构建的层级结构：

- 根节点（`issue_root` 指向自己的文件）会显示在顶层
- 子节点按 `issue_children` 数组中的顺序显示
- 支持折叠/展开操作
- 点击节点可以打开对应的文件

### 2. 解除层级关联

当需要从层级结构中移除某个节点时，可以使用"解除 Issue 层级关联"命令。

#### 使用方式

1. 在编辑器中打开 Markdown 文件
2. 右键点击编辑器，选择"解除 Issue 层级关联"
3. 选择解除方式：

**选项 A: 仅解除当前节点（保留子节点）**
- 当前文件的所有 `issue_` 字段将被删除
- 父文件的 `issue_children` 中会删除当前文件
- 当前文件的子文件会独立化（成为新的根节点）

```
原结构:
  Root
  └── Current (要解除)
      ├── Child1
      └── Child2

解除后:
  Root
  Child1 (新根节点)
  Child2 (新根节点)
```

**选项 B: 解除当前节点及其所有子节点（递归清理）**
- 当前文件及其所有后代文件的 `issue_` 字段都将被删除
- 父文件的 `issue_children` 中会删除当前文件
- 整个分支从层级结构中移除

```
原结构:
  Root
  └── Current (要解除)
      ├── Child1
      └── Child2

解除后:
  Root
  (Current、Child1、Child2 的 issue_ 字段都被删除)
```

### 3. 自动路径同步

当文件被重命名或移动时，系统会自动更新所有引用：

- 监听文件重命名事件
- 扫描所有文件，找到引用了旧路径的文件
- 自动更新 `issue_root`、`issue_parent`、`issue_children` 中的路径
- 路径统一使用 POSIX 风格（`/` 而不是 `\`）

**示例**:
```
重命名: old-file.md → new-file.md

自动更新所有包含 "old-file.md" 引用的文件:
- issue_parent: old-file.md → new-file.md
- issue_children: [old-file.md, ...] → [new-file.md, ...]
```

## 使用场景

### 场景 1: 创建项目层级

```yaml
# project-root.md
---
issue_root: project-root.md
issue_children:
  - task1.md
  - task2.md
---
```

```yaml
# task1.md
---
issue_root: project-root.md
issue_parent: project-root.md
issue_children:
  - subtask1-1.md
  - subtask1-2.md
---
```

### 场景 2: 重组结构

如果需要将某个任务移动到另一个项目：

1. 手动编辑 task1.md 的 `issue_parent` 和 `issue_root`
2. 更新原父节点和新父节点的 `issue_children`

或者使用"解除关联"命令，然后重新建立关联。

### 场景 3: 独立文件

不设置任何 `issue_` 字段的文件将不会出现在逻辑层级树中，它们保持独立状态。

## 安全保障

### 1. 非破坏性编辑

- 使用 `js-yaml` 库解析和生成 YAML
- 保留原有的 YAML 注释和格式
- 只修改 `issue_` 前缀字段，不影响其他字段

### 2. 原子操作

- 批量更新使用事务式机制
- 要么全部成功，要么全部失败
- 防止出现数据不一致的情况

### 3. 操作预览

- 解除关联前会显示将要修改的文件数量
- 递归删除会要求用户确认

### 4. 只修改逻辑关系

- **严禁删除物理磁盘文件**
- 所有"删除"操作仅针对 Frontmatter 中的逻辑关系
- 文件本身和文件内容始终保持完整

## 配置

确保在 VS Code 设置中配置了 `issueManager.issueDir`:

```json
{
  "issueManager.issueDir": "/path/to/your/notes"
}
```

所有 `issue_` 字段中的路径都是相对于此目录的相对路径。

## 常见问题

### Q: 如何创建新的层级结构？

A: 手动编辑 Markdown 文件的 Frontmatter，添加 `issue_root`、`issue_parent` 和 `issue_children` 字段。

### Q: 解除关联后可以恢复吗？

A: 不能自动恢复。建议使用 Git 版本控制来保存历史记录。

### Q: 文件移动后路径会自动更新吗？

A: 是的。当文件被重命名或移动时，系统会自动扫描并更新所有引用。

### Q: 可以有多个根节点吗？

A: 可以。每个 `issue_root` 指向自己的文件都会成为一个根节点。

### Q: 循环引用怎么办？

A: 系统会在遍历时检测循环引用并停止。建议避免创建循环引用。

## 技术细节

### Frontmatter 处理

- 使用 `js-yaml` 解析和序列化
- 支持标准 YAML 语法
- 保留注释和格式

### 路径处理

- 内部统一使用 POSIX 风格路径（`/`）
- 使用 `path.relative()` 计算相对路径
- 自动规范化路径格式

### 性能优化

- 批量操作使用并发处理
- 内存缓存减少文件读取
- 增量更新而非全量重建

## 反馈和支持

如有问题或建议，请访问项目的 GitHub 仓库提交 Issue。
