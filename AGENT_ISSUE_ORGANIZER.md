# Issue Node 关系整理 Agent

## 概述

这是一个专门用于整理和维护 IssueNode 关系的自定义 Agent，位于 `.github/agents/issue-organizer.agent.md`。

## 功能特性

### 1. 分析功能
- **节点统计**：统计总节点数、唯一文件数、多重引用情况
- **层级分析**：分析树的深度和结构复杂度
- **引用分析**：识别同一文件的多个引用及其位置
- **问题检测**：自动检测无效引用、孤立节点、过深层级等问题

### 2. 整理功能
- **清理重复引用**：识别并清理过度的多重引用
- **优化层级结构**：扁平化过深的节点结构
- **整理孤立节点**：帮助组织没有子节点的叶子节点
- **移除无效引用**：清理引用不存在文件的节点

### 3. 安全保障
- **自动备份**：修改前自动创建 tree.json 备份
- **逐步确认**：批量操作前先展示计划并征求确认
- **可逆操作**：优先使用可逆的操作方式
- **保留文件**：只操作节点引用，不删除实际的 .md 文件

## 使用方法

### 基本调用

在与 AI 助手对话时，可以通过以下方式调用此 Agent：

#### 1. 完整分析和整理
```
请帮我分析并整理问题节点关系
```

#### 2. 仅分析不执行
```
分析当前的节点关系，给出建议但不要执行任何修改
```

#### 3. 针对特定问题
```
找出所有引用文件 "20250101-120000-000.md" 的节点
```

#### 4. 清理特定类型问题
```
清理所有无效的节点引用
```

## 工作流程

该 Agent 遵循以下标准工作流程：

```
1. 分析 → 2. 建议 → 3. 确认 → 4. 执行 → 5. 验证
```

### 详细步骤

1. **分析阶段**
   - 读取 `.issueManager/tree.json`
   - 统计节点和引用信息
   - 识别潜在问题

2. **建议阶段**
   - 生成分析报告
   - 提出具体的整理方案
   - 说明每个操作的影响

3. **确认阶段**
   - 向用户展示计划
   - 等待用户确认或调整
   - 创建备份文件

4. **执行阶段**
   - 按照确认的方案执行操作
   - 修改 tree.json
   - 记录执行的操作

5. **验证阶段**
   - 检查 tree.json 格式正确性
   - 触发视图刷新
   - 生成整理报告

## 使用场景

### 场景 1：清理过度引用

**问题描述**：发现某个文件被引用了 8 次，关系混乱

**使用方式**：
```
我发现文件 "feature-plan.md" 被引用了很多次，
请帮我分析这些引用，并建议如何整理
```

**预期结果**：
- Agent 列出所有引用及其位置
- 分析每个引用的上下文
- 建议保留哪些引用
- 征得确认后执行清理

### 场景 2：整理孤立节点

**问题描述**：有很多孤立的叶子节点需要整理

**使用方式**：
```
我的问题树中有很多孤立的叶子节点，
请帮我整理这些节点，建议合适的分组方式
```

**预期结果**：
- 列出所有孤立节点
- 按主题或时间分组
- 建议建立关联关系
- 执行关联操作

### 场景 3：扁平化深层结构

**问题描述**：某个分支的层级深度过深（>5 层）

**使用方式**：
```
我的某个项目分支层级太深了，
请帮我分析并提出重组方案
```

**预期结果**：
- 识别深层结构
- 提出扁平化方案
- 保持逻辑关系
- 使用"移动到"功能执行

## 技术实现

### 核心依赖

Agent 依赖以下模块和功能：

- `src/data/issueTreeManager.ts`：树结构管理
- `src/commands/moveTo.ts`：移动节点功能
- `src/commands/attachTo.ts`：关联节点功能

### 关键数据结构

```typescript
// IssueNode 节点结构
interface IssueNode {
    id: string;           // 唯一标识符
    filePath: string;     // 相对于 issueDir 的文件路径
    children: IssueNode[]; // 子节点数组
    expanded?: boolean;   // 展开状态
}

// TreeData 树结构
interface TreeData {
    version: string;
    lastModified: string;
    rootNodes: IssueNode[];
}
```

### 核心算法

#### 1. 多重引用检测
```typescript
const filePathMap = new Map<string, IssueNode[]>();
walkTree(tree.rootNodes, node => {
    const nodes = filePathMap.get(node.filePath) || [];
    nodes.push(node);
    filePathMap.set(node.filePath, nodes);
});

// 找出被多次引用的文件
const multipleRefs = Array.from(filePathMap.entries())
    .filter(([_, nodes]) => nodes.length > 1);
```

#### 2. 层级深度分析
```typescript
function getMaxDepth(nodes: IssueNode[], currentDepth = 0): number {
    let maxDepth = currentDepth;
    for (const node of nodes) {
        if (node.children && node.children.length > 0) {
            const childDepth = getMaxDepth(node.children, currentDepth + 1);
            maxDepth = Math.max(maxDepth, childDepth);
        }
    }
    return maxDepth;
}
```

## 注意事项

### 安全性

1. **始终备份**：修改前创建时间戳备份
   ```bash
   cp .issueManager/tree.json .issueManager/tree.json.backup.20260131_172600
   ```

2. **只修改引用**：永远不删除 `.md` 文件

3. **保留关注**：不影响 `focused.json` 中的关注列表

### 性能考虑

- 对于大型树（>1000 节点），操作分批进行
- 使用缓存避免重复读取文件
- 批量操作使用事务方式（一次性写入）

### 兼容性

- 兼容现有的"移动到"和"关联到"功能
- 不影响其他视图（孤立问题、关注问题、最近问题）
- 保持与 VSCode 命令的集成

## 扩展功能（未来）

以下功能可以在未来版本中添加：

1. **智能分组建议**
   - 基于文件内容的相似度分析
   - 基于时间的自动分组
   - 基于标签的分类建议

2. **可视化分析**
   - 生成节点关系图
   - 显示引用热力图
   - 展示层级结构图

3. **自动化规则**
   - 设置自动清理规则
   - 定期检测和报告
   - 批量操作模板

4. **导出导入**
   - 导出整理方案
   - 分享最佳实践
   - 导入预设方案

## 相关文档

- [问题管理插件需求文档.md](../../问题管理插件需求文档.md)
- [plan-associateTo.prompt.md](../../plan-associateTo.prompt.md)
- [src/commands/moveTo.ts](../../src/commands/moveTo.ts)
- [src/commands/attachTo.ts](../../src/commands/attachTo.ts)

## 反馈和贡献

如果在使用过程中遇到问题或有改进建议，请通过以下方式反馈：

1. 在项目 Issue 中提出
2. 直接修改 Agent 配置文件
3. 提交 Pull Request

---

**版本**：v1.0.0  
**创建时间**：2026-01-31  
**最后更新**：2026-01-31
