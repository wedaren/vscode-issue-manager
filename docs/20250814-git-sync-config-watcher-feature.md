# Git同步服务配置监听功能

## 更新日期
2025年8月14日

## 功能概述
扩展了GitSyncService，使其不仅监听问题目录下的Markdown文件变化，还监听`.issueManager`目录下的配置文件变化，确保问题管理状态的完整同步。

## 技术实现

### 双监听器架构
1. **问题文件监听器**：监听`issueDir/**/*.md`
2. **配置文件监听器**：监听`issueDir/.issueManager/**/*`

### 监听的配置文件
- `tree.json` - 问题树结构
- `focused.json` - 关注问题列表  
- 其他配置文件

### 代码更改
```typescript
// 添加配置监听器属性
private configWatcher?: vscode.FileSystemWatcher;

// 创建两个监听器
const mdPattern = new vscode.RelativePattern(issueDir, '**/*.md');
const configPattern = new vscode.RelativePattern(path.join(issueDir, '.issueManager'), '**/*');

// 统一的事件处理
const onFileChange = () => { /* 防抖和同步逻辑 */ };
```

## 优势
- **完整同步**：问题文件和配置文件的任何变化都会触发Git同步
- **统一防抖**：两个监听器共享同一个防抖机制，避免重复同步
- **资源管理**：正确的清理和释放机制

## 使用场景
- 修改问题树结构时自动同步
- 添加/移除关注问题时自动同步
- 任何配置变更都会被Git跟踪

## 测试建议
1. 修改`.issueManager/tree.json`文件，观察是否触发同步
2. 修改`.issueManager/focused.json`文件，验证自动同步
3. 同时修改问题文件和配置文件，确保防抖正常工作
