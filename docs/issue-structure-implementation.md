# 问题结构视图功能实现说明

## 功能概述

"问题结构"视图是一个动态的、只读的视图，旨在实时展示当前活动文档基于其 Frontmatter 的物理链接结构。这个功能基于以下需求规范实现：

- 当用户打开包含 `root_file` Frontmatter 字段的 Markdown 文件时，视图被激活并自动刷新
- 从根文件开始，递归读取 `children_files` 列表，动态构建完整的树状结构
- 不依赖 `tree.json`，是每次激活时的实时计算结果
- 严格为只读模式，支持点击节点打开对应文件
- 包含循环引用检测和错误处理机制

## 技术实现

### 核心组件

#### 1. Frontmatter 解析器 (`src/utils/markdown.ts`)

新增了 frontmatter 解析功能：

```typescript
// 解析 frontmatter 数据结构
export interface FrontmatterData {
    root_file?: string;
    parent_file?: string | null;
    children_files?: string[];
    [key: string]: any; // 支持其他字段
}

// 解析 frontmatter 内容
export function parseFrontmatter(content: string): FrontmatterData | null

// 从文件 URI 获取 frontmatter
export async function getFrontmatter(fileUri: vscode.Uri): Promise<FrontmatterData | null>
```

#### 2. 问题结构视图提供者 (`src/views/IssueStructureProvider.ts`)

实现了完整的树视图功能：

```typescript
export class IssueStructureProvider implements vscode.TreeDataProvider<IssueStructureNode> {
    // 核心功能
    private async buildStructureFromActiveFile(frontmatter: FrontmatterData)
    private async buildNodeRecursively(fileName: string, visited: Set<string>)
    private onActiveEditorChanged(editor: vscode.TextEditor | undefined)
}
```

### 关键特性

#### 1. 循环引用检测

使用 `visited` Set 来跟踪已访问的文件，防止无限递归：

```typescript
// 检测循环引用
if (visited.has(fileName)) {
    return {
        id: fileName,
        title: `循环引用: ${fileName}`,
        hasError: true,
        errorMessage: '检测到循环引用'
    };
}
```

#### 2. 性能优化：节点缓存机制

为了优化具有共享子节点（DAG 结构）的问题结构性能，实现了智能节点缓存机制：

```typescript
// 缓存节点信息，包含修改时间用于失效检查
interface CachedNodeInfo {
    node: IssueStructureNode;
    lastModified: number; // 文件最后修改时间戳
}

// 在构建结构时使用持久化缓存
const rootNode = await this.buildNodeRecursively(frontmatter.root_file, visited, this.nodeCache);

// 缓存失效检查
if (nodeCache.has(fileName)) {
    const cachedInfo = nodeCache.get(fileName)!;
    if (cachedInfo.lastModified === currentModTime) {
        // 缓存未过期，返回缓存节点
        return { ...cachedInfo.node };
    } else {
        // 缓存已过期，删除缓存并重新构建
        nodeCache.delete(fileName);
    }
}
```

**缓存优化的特性：**
- **智能失效**：基于文件修改时间自动检测缓存是否过期
- **文件监听**：监听文件系统变化，主动清除相关缓存
- **避免重复计算**：对于未修改的文件，避免重复解析和构建
- **支持 DAG 结构**：处理文档间的复杂关系
- **减少 I/O 操作**：减少文件系统访问次数
- **状态正确性**：确保当前文件状态的正确更新

**缓存失效策略：**
1. **自动失效**：文件修改时间变化时自动失效
2. **文件监听失效**：通过 FileSystemWatcher 监听文件变化
3. **手动刷新失效**：用户手动刷新时清空所有缓存
4. **相关性失效**：文件变化时检查是否影响当前视图

#### 3. 错误处理

- **文件不存在**：显示"幽灵"节点并带警告图标
- **循环引用**：显示错误图标并中断该分支渲染
- **无效 frontmatter**：显示引导信息


#### 5. 当前文件高亮

当前激活的文件在树中会有特殊的图标标识：


### 配置更新

#### package.json 更新

1. **新增视图定义**：
```json
{
  "id": "issueManager.views.structure",
  "name": "问题结构",
  "icon": "resources/icon.svg"
}
```

2. **新增命令**：
```json
{
  "command": "issueManager.structure.refresh",
  "title": "刷新",
  "icon": "$(refresh)"
}
```

3. **新增菜单项**：
```json
{
  "command": "issueManager.structure.refresh",
  "when": "view == issueManager.views.structure",
  "group": "navigation@1"
}
```

#### 扩展注册 (`src/extension.ts`)

```typescript
// 注册问题结构视图
const issueStructureProvider = new IssueStructureProvider(context);
const structureView = vscode.window.createTreeView('issueManager.views.structure', {
    treeDataProvider: issueStructureProvider
});
context.subscriptions.push(structureView);
context.subscriptions.push(issueStructureProvider);

// 注册刷新命令
context.subscriptions.push(vscode.commands.registerCommand('issueManager.structure.refresh', () => {
    issueStructureProvider.refresh();
}));
```

## 测试文档

在 `test-docs/` 目录下创建了完整的测试用例：

### 1. 正常层级结构
- `test-structure-root.md` - 根文档
- `test-structure-child1.md` - 叶子节点
- `test-structure-child2.md` - 有子节点的中间节点
- `test-structure-grandchild.md` - 三级节点

### 2. 循环引用测试
- `test-cycle-root.md` - 循环引用根文档
- `test-cycle-child.md` - 故意引用父文档创建循环

### 3. 缺失文件测试
- `test-missing-root.md` - 引用不存在的文件
- `test-missing-child.md` - 存在的子文档

## 单元测试

在 `src/test/frontmatter.test.ts` 中添加了 frontmatter 解析功能的单元测试：

- 测试有效 frontmatter 解析
- 测试无 frontmatter 内容处理
- 测试无效 YAML 处理
- 测试空 frontmatter 处理
- 测试包含额外字段的 frontmatter

## 使用方法

1. 在 VS Code 中安装并激活问题管理插件
2. 配置问题目录指向包含结构化文档的目录
3. 打开任意包含 `root_file` frontmatter 的 Markdown 文件
4. 查看侧边栏中的"问题结构"视图
5. 点击任意节点可以打开对应文件
6. 使用工具栏中的刷新按钮手动刷新视图

## 依赖

- `js-yaml`: 用于解析 YAML frontmatter
- VS Code TreeDataProvider API
- 现有的问题管理插件基础架构

## 未来改进

- 支持更多 frontmatter 字段的结构关系
- 添加结构验证和修复建议
- 支持结构导出和可视化
- 添加结构统计信息显示
