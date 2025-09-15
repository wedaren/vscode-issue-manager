# FileAccessTracker 服务重构说明

## 重构目标

将文件访问跟踪功能从 `RecentIssuesProvider` 中独立出来，创建专门的 `FileAccessTracker` 服务。

## 架构改进

### 🏗️ 服务独立化
- **之前**: 查看时间跟踪逻辑耦合在 `RecentIssuesProvider` 中
- **现在**: 独立的 `FileAccessTracker` 服务，采用单例模式

### 📊 数据扩展
- **之前**: 只记录查看时间 `{ [filePath: string]: timestamp }`
- **现在**: 完整的访问统计 `FileAccessStats`：
  ```typescript
  interface FileAccessStats {
    lastViewTime: number;    // 最后查看时间
    viewCount: number;       // 查看次数
    firstViewTime: number;   // 首次查看时间
    totalReadTime?: number;  // 累计阅读时间（预留）
  }
  ```

### 🔧 解耦合设计
- **全局监听**: 在 `extension.ts` 中统一初始化
- **服务注入**: 视图提供者通过依赖注入使用服务
- **数据共享**: 多个视图可以共享相同的访问统计数据

## 代码变更

### 1. 新增 FileAccessTracker 服务

```typescript
// src/services/FileAccessTracker.ts
export class FileAccessTracker {
  // 单例模式
  private static instance: FileAccessTracker | null = null;
  
  // 自动事件监听
  private setupEventListeners(): void {
    const activeEditorListener = vscode.window.onDidChangeActiveTextEditor(/* ... */);
  }
  
  // 丰富的访问统计 API
  public getFileAccessStats(filePath: string): FileAccessStats | undefined
  public getLastViewTime(filePath: string): Date | undefined
  public getViewCount(filePath: string): number
}
```

### 2. 简化 RecentIssuesProvider

```typescript
// src/views/RecentIssuesProvider.ts
export class RecentIssuesProvider {
  private fileAccessTracker: FileAccessTracker;
  
  constructor(private context: vscode.ExtensionContext) {
    // 获取共享的跟踪服务实例
    this.fileAccessTracker = FileAccessTracker.getInstance();
  }
  
  // 使用服务提供的 API
  public recordViewTime(filePath: string): void {
    this.fileAccessTracker.recordFileAccess(filePath);
  }
}
```

### 3. 统一初始化

```typescript
// src/extension.ts
export function activate(context: vscode.ExtensionContext) {
  // 全局初始化文件访问跟踪服务
  const fileAccessTracker = FileAccessTracker.initialize(context);
  
  // 其他视图提供者可以直接使用服务
  const recentIssuesProvider = new RecentIssuesProvider(context);
}
```

## 功能增强

### 📈 更丰富的统计信息
- **查看次数**: 显示文件被查看的总次数
- **首次查看时间**: 记录用户第一次查看文件的时间
- **累计阅读时间**: 预留字段，将来可以实现阅读时长统计

### 🛠️ 维护功能
- **数据清理**: `cleanupStats()` 方法清理已删除文件的统计
- **重置统计**: `resetStats()` 方法用于测试或重新开始
- **导出数据**: `getAllAccessStats()` 获取完整统计数据

### 🔮 扩展性预留
- **阅读时间跟踪**: 监听文档关闭事件计算阅读时长
- **滚动进度跟踪**: 监听滚动事件了解阅读深度  
- **活跃度检测**: 监听键盘活动区分活跃阅读和被动打开

## 用户体验改进

### 📊 更详细的工具提示
```
路径: `/path/to/file.md`

修改时间: 2025-01-10 14:30:00
创建时间: 2025-01-08 09:15:00

最近查看: 2025-01-10 16:45:00
查看次数: 5
首次查看: 2025-01-08 10:20:00
```

### 🎯 精确的排序
- 按查看次数排序（将来可实现）
- 按首次查看时间排序（将来可实现）
- 按阅读时长排序（将来可实现）

## 向后兼容

- ✅ 保持现有的排序功能不变
- ✅ 原有的 `recordViewTime` 和 `getViewTime` 方法继续工作
- ✅ 数据迁移：服务会自动适配现有的数据格式

## 总结

这次重构实现了：
1. **关注点分离**: 访问跟踪独立于视图逻辑
2. **可扩展性**: 为将来的功能扩展打下基础
3. **代码复用**: 多个视图可以共享访问统计数据
4. **数据丰富**: 提供更全面的文件访问信息
5. **维护性**: 统一管理和维护访问数据

这为将来实现更高级的文件分析和推荐功能奠定了坚实的基础。
