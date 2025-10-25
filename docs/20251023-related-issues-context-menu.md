# 相关联问题视图上下文菜单统一

## 修改日期
2025年10月23日 - 初始实现  
2025年10月24日 - 性能优化  
2025年10月24日 - 资源管理优化  
2025年10月24日 - 上下文变量简化

## 修改目标
让相关联问题视图的节点右键菜单与问题总览视图的节点保持一致。

## 修改内容

### 1. RelatedIssuesProvider.ts
- **添加依赖**: 导入 `ParaCategoryCache` 服务
- **添加构造函数**: 接收 `vscode.ExtensionContext` 参数,通过依赖注入管理 `ParaCategoryCache` 实例
- **资源管理优化**:
  - 实现 `vscode.Disposable` 接口，确保正确的资源清理
  - 添加 `disposables` 数组管理所有可释放资源
  - 在 `dispose` 方法中统一释放事件发射器和事件监听器
  - 避免内存泄漏，符合项目编码风格指南
- **性能优化**: 
  - 在构建节点时预计算 `contextValue`，避免在 `getTreeItem` 中重复计算
  - 在 `RelatedIssueNode` 接口中添加 `contextValue` 属性用于缓存
  - 添加 PARA 分类缓存更新监听器，自动刷新视图
- **修改 getTreeItem 方法**: 
  - 使用缓存的 `contextValue` 或按需计算
  - 设置节点的 `id` 和 `resourceUri` 属性,确保命令参数正确传递

### 2. relatedIssuesViewRegistration.ts
- **修改实例化**: 在创建 `RelatedIssuesProvider` 实例时传递 `context` 参数
- **生命周期管理**: 将 `relatedIssuesProvider` 添加到 `context.subscriptions` 中，确保 VS Code 能正确管理其生命周期

### 3. package.json
为以下命令的 `when` 条件添加 `view == 'issueManager.views.related'`:

#### PARA 分类操作（使用统一上下文变量优化）
- `issueManager.para.addToProjects` - 添加到 Projects
- `issueManager.para.addToAreas` - 添加到 Areas
- `issueManager.para.addToResources` - 添加到 Resources
- `issueManager.para.addToArchives` - 添加到 Archives
- `issueManager.para.viewInProjects` - 在 Projects 中查看
- `issueManager.para.viewInAreas` - 在 Areas 中查看
- `issueManager.para.viewInResources` - 在 Resources 中查看
- `issueManager.para.viewInArchives` - 在 Archives 中查看

注意: `issueManager.copyFilename` 命令不需要修改,因为其条件是基于 `viewItem` 匹配,而不是 `view`。

### 4. ViewContextManager.ts（新增）
- **创建视图上下文管理器**: 统一管理问题树视图的上下文状态
- **监听视图可见性**: 监听所有问题树视图的可见性和选择变化
- **设置上下文变量**: 维护 `issueManager.isInIssueTreeView` 上下文变量
- **简化 when 条件**: 将复杂的多视图 OR 条件简化为单一上下文检查

### 5. ViewRegistry.ts
- **集成上下文管理器**: 在构造函数中创建 `ViewContextManager` 实例
- **注册视图实例**: 将所有问题树视图注册到上下文管理器中
- **生命周期管理**: 确保上下文管理器随扩展生命周期正确释放

## 技术细节

### contextValue 的作用
通过设置与问题总览视图相同的 `contextValue`,相关联问题视图的节点可以响应相同的右键菜单命令。`ParaCategoryCache.getContextValueWithParaMetadata()` 方法会根据节点是否有 PARA 分类自动添加相应的标记,例如:
- `issueNode` - 普通问题节点
- `issueNode:paraAssignable` - 可分配 PARA 分类的节点
- `issueNode:paraAssigned:projects` - 已分配到 Projects 的节点
- `focusedNode` - 关注的问题节点

### 性能优化架构
1. **依赖注入**: 在构造函数中创建 `ParaCategoryCache` 实例，避免每次渲染时重复调用 `getInstance()`
2. **预计算缓存**: 在构建节点时预计算 `contextValue`，存储在节点对象中
3. **延迟计算**: `getTreeItem` 中使用缓存值，仅在缓存未命中时才重新计算
4. **自动刷新**: 监听 PARA 分类缓存更新事件，自动刷新视图以保持数据同步

### 资源管理架构
1. **Disposable 模式**: 实现 `vscode.Disposable` 接口，提供统一的资源清理机制
2. **资源追踪**: 使用 `disposables` 数组追踪所有需要释放的资源
3. **生命周期管理**: 通过 VS Code 的订阅机制自动管理组件生命周期
4. **内存泄漏防护**: 确保所有事件监听器在组件销毁时正确释放

### 上下文变量管理架构
1. **统一上下文**: 引入 `issueManager.isInIssueTreeView` 上下文变量，标识用户当前在问题树视图中
2. **视图监听**: 监听所有问题树视图的可见性和选择变化事件
3. **条件简化**: 将 `package.json` 中的长条件（如 `view == 'a' || view == 'b' || view == 'c'`）简化为单一上下文检查
4. **可维护性**: 添加新视图时只需在一处定义，无需修改所有相关的 when 条件

### PARA 分类支持
相关联问题视图的节点现在可以:
1. 显示 PARA 分类图标
2. 通过右键菜单添加/移除 PARA 分类
3. 在不同的 PARA 分类视图中查看
4. 自动响应 PARA 分类变更，保持视图状态同步

## 测试建议
1. 在相关联问题视图中右键点击节点,验证菜单项是否与问题总览视图一致
2. 测试"添加关注"、"解除关联"、"移动到..."等基础操作
3. 测试 PARA 分类相关操作,验证分类图标和菜单项是否正确显示
4. 验证已有关注的节点是否显示"移除关注"和"置顶关注"选项
