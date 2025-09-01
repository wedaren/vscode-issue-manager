# 问题结构视图缓存机制详细说明

## 问题背景

原始的 `buildNodeRecursively` 函数存在性能问题：
- 对于具有共享子节点（DAG 结构）的问题结构，会导致重复计算
- 每次遇到一个文件节点时都会重新构建，即使该节点已在本次刷新中被构建过
- 违反了风格指南中关于使用缓存的建议

## 解决方案

### 1. 基础缓存机制

**实现**：
- 引入 `nodeCache: Map<string, CachedNodeInfo>` 作为持久化缓存
- 在递归构建前检查缓存，避免重复工作
- 缓存所有成功构建的节点和错误节点

**优势**：
- 显著提升 DAG 结构文档的构建性能
- 减少文件系统 I/O 操作
- 避免重复的 frontmatter 解析

### 2. 智能缓存失效

**核心问题**：文件修改后缓存数据可能过期

**解决策略**：

#### a) 基于修改时间的自动失效
```typescript
interface CachedNodeInfo {
    node: IssueStructureNode;
    lastModified: number; // 文件最后修改时间戳
}

// 检查缓存是否过期
if (cachedInfo.lastModified === currentModTime) {
    // 缓存有效，使用缓存
    return cachedNode;
} else {
    // 缓存过期，删除并重新构建
    nodeCache.delete(fileName);
}
```

#### b) 文件系统监听失效
```typescript
const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(issueDir, '**/*.md')
);

watcher.onDidChange(uri => {
    this.invalidateFileCache(path.basename(uri.fsPath));
});
```

#### c) 手动刷新失效
```typescript
public refresh(): void {
    this.nodeCache.clear(); // 清空所有缓存
    this.onActiveEditorChanged(vscode.window.activeTextEditor);
}
```

#### d) 相关性检查失效
```typescript
private isFileRelatedToCurrent(fileName: string): boolean {
    return fileName === this.currentActiveFile || 
           this.findNodeInCurrent(fileName) !== null;
}
```

### 3. 实现细节

#### 缓存生命周期
1. **缓存创建**：首次构建节点时创建缓存条目
2. **缓存命中**：后续访问时检查修改时间，命中则直接返回
3. **缓存失效**：文件修改时间变化或文件系统事件触发失效
4. **缓存清理**：手动刷新或相关文件变化时清理

#### 状态正确性保证
- **错误状态缓存**：错误节点也会被缓存，避免重复错误检查
- **循环引用处理**：循环引用检测在缓存检查之后进行

## 性能优化效果

### 缓存命中场景
- ✅ **共享子节点**：多个父节点引用同一子节点时
- ✅ **重复访问**：同一结构的多次刷新
- ✅ **未修改文件**：文件内容未变化的情况

### 缓存失效场景
- 🔄 **文件内容修改**：frontmatter 或标题变化
- 🔄 **文件删除**：文件被删除时
- 🔄 **手动刷新**：用户主动刷新视图
- 🔄 **相关文件变化**：影响当前视图的文件变化

## 测试策略

### 功能测试
- ✅ 基本缓存命中和失效
- ✅ 文件修改时的自动失效
- ✅ 文件系统监听的正确性
- ✅ 当前文件状态的正确更新

### 性能测试
- 📊 大型 DAG 结构的构建时间对比
- 📊 文件 I/O 操作次数统计
- 📊 内存使用情况监控

### 边界情况测试
- 🧪 缓存在循环引用时的行为
- 🧪 文件不存在时的缓存处理
- 🧪 并发文件修改的处理

## 日志和调试

实现了详细的日志记录：
```typescript
console.log(`缓存失效: ${fileName}`);
console.log(`缓存过期，重新构建: ${fileName}`);
console.log('手动刷新，清空所有缓存');
```

这些日志帮助：
- 调试缓存行为
- 监控性能优化效果
- 排查缓存相关问题

## 总结

这个智能缓存机制完美解决了原始问题：

1. **性能优化**：显著减少重复计算和 I/O 操作
2. **数据准确性**：确保缓存数据与文件状态同步
3. **用户体验**：响应迅速的视图更新
4. **健壮性**：妥善处理各种边界情况

该解决方案既满足了性能要求，又保证了功能的正确性，是一个完整而优雅的缓存实现。
