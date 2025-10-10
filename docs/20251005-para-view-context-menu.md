# PARA 视图右键菜单功能说明

## 功能概述

为 PARA 视图中的顶级节点添加右键菜单,支持删除和移动操作。子节点保持只读状态,不显示这些菜单项。

## 实现时间

2025年10月5日

## 功能特性

### 1. 节点权限控制

#### 顶级节点
- **定义**: 直接添加到 PARA 分类的问题节点
- **contextValue**: `paraIssue-{category}`
- **权限**: 可以删除和移动
- **菜单项**:
  - 从分类中移除
  - 移动到其他分类(3个选项)

#### 子节点
- **定义**: 跟随父节点自动显示的子问题
- **contextValue**: `paraIssueChild-{category}`
- **权限**: 只读,无删除/移动菜单
- **说明**: 子节点的分类由父节点决定,不能单独操作

### 2. 删除功能

**命令**: `issueManager.para.removeFromCategory`

**流程**:
1. 显示确认对话框
2. 确认后从 PARA 分类中移除节点ID
3. 文件本身不删除,仍然保留在问题目录中
4. 自动刷新所有视图
5. 显示成功提示消息

**菜单位置**: `modification@1` 分组

### 3. 移动功能

**命令**:
- `issueManager.para.moveToProjects`
- `issueManager.para.moveToAreas`
- `issueManager.para.moveToResources`
- `issueManager.para.moveToArchives`

**流程**:
1. 检查目标分类是否与当前分类相同
2. 从源分类中移除节点ID
3. 添加到目标分类
4. 自动刷新所有视图
5. 显示移动成功提示

**菜单配置**:
- Projects 节点显示: 移动到 Areas/Resources/Archives
- Areas 节点显示: 移动到 Projects/Resources/Archives
- Resources 节点显示: 移动到 Projects/Areas/Archives
- Archives 节点显示: 移动到 Projects/Areas/Resources

**菜单位置**: `para@1` 到 `para@3` 分组

## 技术实现

### 数据结构修改

#### ParaViewNode 类型

```typescript
type ParaViewNode = 
  | { type: 'category'; category: ParaCategory }
  | { 
      type: 'issue'; 
      id: string; 
      category: ParaCategory; 
      treeNode: IssueTreeNode; 
      isTopLevel: boolean  // 新增字段
    };
```

### 核心方法

#### getChildren 方法

```typescript
// 分类节点的子节点(顶级节点)
if (element.type === 'category') {
  for (const id of issueIds) {
    nodes.push({
      type: 'issue',
      id,
      category: element.category,
      treeNode,
      isTopLevel: true  // 顶级节点
    });
  }
}

// 问题节点的子节点(子节点)
if (element.type === 'issue') {
  return children.map(child => ({
    type: 'issue',
    id: child.id,
    category: element.category,
    treeNode: child,
    isTopLevel: false  // 子节点
  }));
}
```

#### createIssueTreeItem 方法

```typescript
// 根据 isTopLevel 设置不同的 contextValue
if (isTopLevel) {
  item.contextValue = `paraIssue-${category}`;
} else {
  item.contextValue = `paraIssueChild-${category}`;
}
```

#### removeFromParaCategory 方法

```typescript
private async removeFromParaCategory(issueId: string, category: ParaCategory): Promise<void> {
  // 确认对话框
  const confirm = await vscode.window.showWarningMessage(
    `确定要从 ${categoryLabel} 中移除此问题吗？`,
    { modal: false },
    '确定'
  );
  
  if (confirm === '确定') {
    await removeIssueFromCategory(category, issueId);
    await vscode.commands.executeCommand('issueManager.refreshAllViews');
    vscode.window.showInformationMessage(`已从 ${categoryLabel} 中移除`);
  }
}
```

#### moveParaIssue 方法

```typescript
private async moveParaIssue(
  issueId: string, 
  fromCategory: ParaCategory, 
  toCategory: ParaCategory
): Promise<void> {
  // 检查是否相同
  if (fromCategory === toCategory) {
    vscode.window.showInformationMessage('该问题已在目标分类中');
    return;
  }
  
  // 原子性操作
  await removeIssueFromCategory(fromCategory, issueId);
  await addIssueToCategory(toCategory, issueId);
  
  await vscode.commands.executeCommand('issueManager.refreshAllViews');
  vscode.window.showInformationMessage(`已从 ${fromLabel} 移动到 ${toLabel}`);
}
```

### 菜单配置

#### package.json

```json
{
  "commands": [
    {
      "command": "issueManager.para.removeFromCategory",
      "title": "从分类中移除",
      "icon": "$(close)"
    },
    {
      "command": "issueManager.para.moveToProjects",
      "title": "移动到 Projects"
    }
    // ... 其他移动命令
  ],
  "menus": {
    "view/item/context": [
      {
        "command": "issueManager.para.removeFromCategory",
        "when": "view == 'issueManager.views.para' && viewItem =~ /^paraIssue-/",
        "group": "modification@1"
      },
      {
        "command": "issueManager.para.moveToAreas",
        "when": "view == 'issueManager.views.para' && viewItem == 'paraIssue-projects'",
        "group": "para@1"
      }
      // ... 其他菜单配置
    ]
  }
}
```

**关键点**:
- `viewItem =~ /^paraIssue-/`: 使用正则表达式只匹配顶级节点
- 不匹配 `paraIssueChild-*`: 子节点不显示菜单
- 精确匹配分类: `viewItem == 'paraIssue-projects'`

## 使用场景

### 场景 1: 清理不需要的项目

1. 在 PARA 视图的 Projects 分类中
2. 找到已完成的项目
3. 右键点击 → "移动到 Archives"
4. 项目移动到归档,Projects 分类保持整洁

### 场景 2: 调整分类归属

1. 发现某个问题被错误分类
2. 在 PARA 视图中找到该问题
3. 右键点击 → "移动到 X"
4. 问题移动到正确的分类

### 场景 3: 移除临时问题

1. 某些问题只是临时添加到 PARA
2. 现在不需要在 PARA 中跟踪了
3. 右键点击 → "从分类中移除"
4. 问题从 PARA 移除,但文件仍然保留

### 场景 4: 子节点只读保护

1. 在 Projects 中添加了一个带子问题的项目
2. 子问题自动显示在父问题下
3. 右键点击子问题 → 无删除/移动菜单
4. 确保子问题不会被意外操作

## 代码修改清单

### 1. ParaViewProvider.ts
- 修改 `ParaViewNode` 类型,添加 `isTopLevel` 字段
- 更新 `getTreeItem` 方法,传递 `isTopLevel` 参数
- 更新 `getChildren` 方法:
  - 分类下的节点设置 `isTopLevel: true`
  - 问题的子节点设置 `isTopLevel: false`
- 更新 `createIssueTreeItem` 方法:
  - 添加 `isTopLevel` 参数
  - 根据 `isTopLevel` 设置不同的 `contextValue`
- 更新 `getParent` 方法,返回节点时设置 `isTopLevel`

### 2. CommandRegistry.ts
- 注册 5 个新命令:
  - `removeFromCategory`: 从分类中移除
  - `moveToProjects/Areas/Resources/Archives`: 移动到指定分类
- 添加辅助方法:
  - `removeFromParaCategory`: 处理移除逻辑
  - `moveParaIssue`: 处理移动逻辑
- 参数处理:使用 ParaViewNode 类型判断

### 3. package.json
- 添加 5 个命令定义
- 添加菜单配置:
  - 移除菜单:匹配所有顶级节点
  - 移动菜单:针对每个分类配置不同的移动选项
  - 使用正则表达式确保只匹配顶级节点

## 用户体验优化

### 视觉反馈
1. **确认对话框**: 移除操作前确认,防止误操作
2. **成功提示**: 操作完成后显示清晰的提示消息
3. **自动刷新**: 所有视图自动更新,无需手动刷新

### 错误处理
1. **相同分类检测**: 移动到当前分类时友好提示
2. **异常捕获**: 所有操作都有 try-catch 包裹
3. **详细日志**: 记录操作详情,便于调试

### 权限控制
1. **顶级节点**: 完整的删除和移动权限
2. **子节点**: 只读状态,无菜单项,防止混乱
3. **清晰区分**: 不同的 contextValue 确保菜单精确显示

## 测试建议

### 功能测试
- [ ] 顶级节点显示删除和移动菜单
- [ ] 子节点不显示删除和移动菜单
- [ ] 移除操作显示确认对话框
- [ ] 移除后问题从分类中消失,文件仍存在
- [ ] 移动操作自动刷新视图
- [ ] 移动到当前分类显示友好提示
- [ ] 所有 4 个分类的移动功能正常工作

### 边界测试
- [ ] 移除最后一个问题后分类显示为空
- [ ] 快速连续操作的稳定性
- [ ] 移除带子节点的问题,子节点也消失
- [ ] 移动带子节点的问题,子节点跟随移动

### 集成测试
- [ ] 与拖拽功能配合良好
- [ ] 与"在 X 中查看"功能配合良好
- [ ] 与问题总览的添加功能配合良好
- [ ] 刷新后状态保持正确

## 后续优化建议

### 可能的增强功能
1. **批量操作**: 支持多选节点后批量移除或移动
2. **撤销功能**: 提供撤销移除/移动的功能
3. **移动历史**: 记录问题的移动历史
4. **快捷键**: 为常用操作添加快捷键
5. **拖拽移动**: 支持在 PARA 视图内拖拽移动

### 性能优化
1. **操作队列**: 对连续操作进行批处理
2. **局部刷新**: 只刷新受影响的视图部分
3. **乐观更新**: UI 立即更新,后台异步保存

## 相关文档

- [PARA 视图实现总结](./para-view-implementation.md)
- [PARA 视图"在分类中查看"功能](./para-view-in-category-feature.md)
- [问题总览视图说明](../README.md#问题总览)

## 提交记录

- Commit: b028bfe
- Branch: feature/para-view
- Date: 2025-10-05
- Message: feat: PARA 视图支持右键删除和移动功能(仅限顶级节点)
