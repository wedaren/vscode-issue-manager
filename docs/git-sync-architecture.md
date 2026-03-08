# Git 自动同步系统架构文档

## 概述

Issue Manager 扩展的 Git 自动同步系统负责将用户的笔记（Markdown 文件）通过 Git 在多台设备之间自动同步。用户将笔记目录（`issueDir`）初始化为一个 Git 仓库并关联远程仓库后，系统会自动监听文件变化、提交更改并推送到远程，同时定期从远程拉取其他设备的更新。

核心设计原则：
- **对用户透明**：同步在后台自动进行，用户不需要手动执行 Git 操作
- **安全优先**：遇到合并冲突时立即暂停自动化，等待用户手动解决
- **优雅降级**：网络故障时自动重试，所有错误都不会丢失用户数据
- **可选的 LLM 增强**：支持通过 GitHub Copilot 生成语义化的提交消息

## 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      ExtensionInitializer                       │
│                              │                                  │
│                      ServiceRegistry                            │
│                        │         │                              │
│          ┌─────────────┘         └──────────────┐               │
│          ▼                                      ▼               │
│   GitSyncService (单例)              setupLLMCommitMessage      │
│      │       │       │              Generator (可选)            │
│      │       │       │                      │                   │
│      ▼       ▼       ▼                      ▼                   │
│  文件监听  周期拉取  命令注册         GitOperations              │
│      │       │       │           .setCommitMessageGenerator()   │
│      └───────┴───────┘                                          │
│              │                                                  │
│              ▼                                                  │
│       GitOperations (静态类)                                    │
│    ┌────────────────────────┐                                   │
│    │ · SimpleGit 实例缓存    │                                  │
│    │ · 分支名缓存 (1min TTL) │                                  │
│    │ · LLM 提交消息生成器    │                                  │
│    └────────────────────────┘                                   │
│              │                                                  │
│              ▼                                                  │
│        simple-git 库                                            │
│              │                                                  │
│              ▼                                                  │
│         Git CLI (本地)                                          │
│              │                                                  │
│              ▼                                                  │
│        远程 Git 仓库 (origin)                                   │
└─────────────────────────────────────────────────────────────────┘
```

## 模块职责

### 核心模块

| 模块 | 文件路径 | 职责 |
|------|----------|------|
| **GitSyncService** | `src/services/git-sync/GitSyncService.ts` | 主编排器。单例模式，协调文件监听、同步调度、冲突管理 |
| **GitOperations** | `src/services/git-sync/GitOperations.ts` | 底层 Git 操作封装。缓存实例和分支名，支持 LLM 提交消息 |
| **SyncErrorHandler** | `src/services/git-sync/SyncErrorHandler.ts` | 错误分类与处理。区分冲突、网络、认证等错误类型 |
| **SyncRetryManager** | `src/services/git-sync/SyncRetryManager.ts` | 指数退避重试。仅对网络类临时错误重试 |
| **StatusBarManager** | `src/services/git-sync/StatusBarManager.ts` | VS Code 状态栏 UI 更新 |
| **SyncNotificationManager** | `src/services/git-sync/SyncNotificationManager.ts` | 桌面通知与日志管理，带节流控制 |

### 辅助模块

| 模块 | 文件路径 | 职责 |
|------|----------|------|
| **UnifiedFileWatcher** | `src/services/UnifiedFileWatcher.ts` | 全局文件监听器，监控 `.md` 文件和 `.issueManager/` 目录 |
| **ServiceRegistry** | `src/core/ServiceRegistry.ts` | 服务初始化编排，注入 LLM 提交消息生成器 |
| **config.ts** | `src/config.ts` | 读取用户配置项 |

## 同步生命周期

### 1. 初始化阶段

```
VS Code 启动
    │
    ▼
ExtensionInitializer.initialize()
    │
    ▼
ServiceRegistry.initializeServices()
    │
    ├─→ setupLLMCommitMessageGenerator()    // 若启用，注入 LLM 生成器到 GitOperations
    │
    ▼
GitSyncService.getInstance().initialize()
    │
    ├─→ setupAutoSync()
    │     ├─→ 检查 isAutoSyncEnabled()      // 配置：sync.enableAutosync
    │     ├─→ 检查 issueDir 是否配置        // 配置：issueManager.issueDir
    │     ├─→ 检查 issueDir 是否为 Git 仓库 // 检查 .git 目录
    │     ├─→ setupFileWatcher()             // 订阅 UnifiedFileWatcher 事件
    │     └─→ setupPeriodicPull()            // 设置定时拉取（默认 15 分钟）
    │
    ├─→ registerCommands()                   // 注册 issueManager.synchronizeNow 命令
    │
    ├─→ 监听 issueManager.sync 配置变更     // 配置变更时自动重新设置
    │
    └─→ performInitialSync()                 // 启动时同步：有未推送的 commit 则 push，否则 pull
```

### 2. 文件变更触发同步

当用户编辑笔记文件或创建新笔记时：

```
文件变更 (*.md 或 .issueManager/*)
    │
    ▼
UnifiedFileWatcher 触发事件
    │
    ├─→ 冲突模式？ → checkConflictResolved() → 若已解决则恢复同步
    │
    ▼
GitSyncService.triggerSync()
    │
    ├─→ 检查 isAutoSyncEnabled()
    ├─→ 检查 issueDir 和 Git 仓库
    ├─→ 检查 isConflictMode（冲突时跳过）
    │
    ▼
状态更新 → HasLocalChanges（"待同步"）
    │
    ▼
debouncedAutoCommitAndPush()  ←── 防抖: 默认 30 秒
    │                              多次变更只触发最后一次
    ▼
performAutoCommitAndPush()
    │
    ▼
retryManager.executeWithRetry('auto-sync', ...)  ←── 最多重试 3 次
    │
    ├─→ 有本地变更？
    │     │
    │     ▼ (commit → pull → push 策略)
    │   [1] 收集变更文件列表
    │       git add ['*.md', '.issueManager']
    │       生成提交消息（LLM 或模板）
    │       git commit -m "<message>"
    │   [2] git pull origin <branch> --no-rebase
    │   [3] git push origin <branch>
    │       └─→ push 被拒绝？→ pull + push 重试一次
    │       └─→ 网络错误？→ 本地 commit 已保存，推送延迟
    │
    ├─→ 无本地变更？
    │     └─→ git pull origin <branch> --no-rebase  (仅拉取远程更新)
    │
    ▼
状态更新 → Synced（"自动同步完成"）
    │
    ▼ (所有重试都失败时)
tryLocalCommitFallback()  ←── 确保至少本地 commit 保存数据
```

### 3. 周期性同步

即使没有本地变更，系统也会定期从远程拉取，以获取其他设备的更新。如果有之前断网未推送的本地 commit，也会一并推送：

```
setInterval (默认 15 分钟)
    │
    ▼
performPeriodicSync()
    │
    ├─→ 检查 isConflictMode
    ├─→ 检查 currentStatus !== Syncing
    │
    ▼
retryManager.executeWithRetry('periodic-pull', ...)
    │
    ├─→ 有本地变更（包括之前未推送的 commit）？
    │     └─→ commitAndPushChanges()  (commit → pull → push)
    │
    ├─→ 无本地变更？
    │     └─→ git pull origin <branch> --no-rebase
    │
    ▼
状态更新 → Synced（"已是最新状态"）
```

### 4. 手动同步

用户点击状态栏按钮或执行命令 `issueManager.synchronizeNow`：

```
用户触发
    │
    ▼
performManualSync()
    │
    ├─→ 如果 isConflictMode:
    │     ├─→ 仍有冲突 → 提示"请先解决合并冲突"
    │     └─→ 冲突已解决 → 恢复自动同步
    │
    ├─→ 有本地更改？
    │     └─→ commitAndPushChanges()  (commit → pull → push)
    │
    ├─→ 无本地更改？
    │     └─→ git pull origin <branch> --no-rebase
    │
    ▼
显示"同步完成"通知
```

### 5. 程序化触发

当扩展内部执行关键操作时，会主动调用 `triggerSync()`：

```typescript
// 以下操作完成后都会调用 GitSyncService.getInstance().triggerSync()
createIssueFromClipboard   // 从剪贴板创建笔记
createIssueFromHtml        // 从 HTML 创建笔记
smartCreateIssue           // 智能创建笔记
focusCommands              // 添加/移除/切换关注
createTranslationFromEditor // 创建翻译
```

### 6. VS Code 关闭前同步

```
VS Code 关闭
    │
    ▼
deactivate()
    │
    ▼
GitSyncService.performFinalSync()  ←── "尽力而为"，失败不阻塞关闭
    │
    ├─→ 检查 isAutoSyncEnabled 和 !isConflictMode
    ├─→ 检查是否有本地更改
    │     └─→ 有更改 → commitAndPushChanges()  (commit → pull → push)
    │     └─→ push 失败？本地 commit 已保存，下次启动时 performInitialSync 补推
    │
    ▼
GitSyncService.dispose()  ←── 清理所有资源
```

## 提交消息生成

### 模板模式（默认）

使用 `issueManager.sync.autoCommitMessage` 配置的模板，默认值：

```
[Auto-Sync] Changes at {date}
```

其中 `{date}` 会被替换为 ISO 8601 格式的当前时间戳。

### LLM 模式（可选）

启用 `issueManager.sync.enableLLMCommitMessage` 后，系统会通过 GitHub Copilot 生成语义化的提交消息：

```
提交流程:
    │
    ├─→ git status (收集变更文件列表)
    │     新增: 20260308-143000-000.md
    │     修改: 20260307-120500-000.md
    │     删除: 20260301-090000-000.md
    │
    ├─→ LLM Prompt:
    │   "你是一个 Git 提交消息助手。请根据以下文件变更列表，
    │    生成一条简洁的中文 Git 提交消息（不超过 72 个字符）。
    │    只返回提交消息本身，不要添加任何解释、引号或前缀。
    │    变更文件：
    │    新增: 20260308-143000-000.md
    │    修改: 20260307-120500-000.md
    │    删除: 20260301-090000-000.md"
    │
    ├─→ LLM 返回: "新增笔记并更新已有笔记，清理过期内容"
    │
    └─→ 如果 LLM 失败或返回空 → 回退到模板模式
```

**依赖注入设计**：`GitOperations` 不直接依赖 `LLMService`，而是通过 `setCommitMessageGenerator()` 接受外部注入的生成函数，由 `ServiceRegistry` 在初始化时完成注入。这避免了循环依赖，也使得 `GitOperations` 可以独立测试。

## 错误处理

### 错误分类

`SyncErrorHandler` 将错误分为以下类型：

| 错误类型 | 检测方式 | 处理策略 |
|----------|----------|----------|
| **合并冲突** | `GitResponseError` 中的 conflicts/failed 字段，或消息包含 conflict/merge | 进入冲突模式，暂停所有自动化 |
| **SSH 连接错误** | 消息包含 `ssh: connect to host`、`port 22` 等 | 显示错误，允许重试 |
| **网络错误** | 消息包含 network/connection/timeout/econnreset | 自动重试（指数退避） |
| **认证错误** | 消息包含 authentication/permission/access denied | 显示错误，不重试 |
| **Git 配置错误** | 消息包含 rebase/变基等 | 显示错误，不重试 |

### 重试策略

`SyncRetryManager` 实现指数退避重试：

```
初始延迟: 5 秒（可配置）
退避倍数: 2
最大延迟: 5 分钟
最大重试: 3 次（可配置）

示例: 5s → 10s → 20s → 放弃
```

**仅对网络类临时错误重试**，合并冲突、认证失败等不可重试的错误会立即抛出。

### 冲突模式

当检测到合并冲突时：

1. 设置 `isConflictMode = true`
2. 停止周期性定时器和防抖调用
3. **保留文件监听器**以自动检测冲突解决（用户编辑文件时触发 `checkConflictResolved()`）
4. 显示模态对话框，引导用户：
   - "打开问题目录" — 查看冲突文件
   - "查看帮助文档" — 打开 GitHub README
   - "手动同步" — 解决冲突后重新同步

冲突恢复方式（两种）：

**自动恢复**：用户在编辑器中解决冲突标记后保存文件，文件监听器触发 `checkConflictResolved()`，检测到无冲突后自动恢复同步。

**手动恢复**：用户点击"手动同步"按钮，检查 `git status` 确认冲突已解决后恢复同步。

## 状态栏 UI

状态栏显示在 VS Code 右下角。**当自动同步禁用时，状态栏自动隐藏**；启用时显示。不同状态对应不同图标：

| 状态 | 图标 | 文字 | 说明 |
|------|------|------|------|
| Synced | `$(sync)` | Git同步 | 已同步，一切正常 |
| Syncing | `$(sync~spin)` | 同步中... | 正在执行 Git 操作（旋转动画） |
| HasLocalChanges | `$(cloud-upload)` | 待同步 | 有本地变更，等待防抖触发 |
| HasRemoteChanges | `$(cloud-download)` | 有更新 | 有远程更新待拉取 |
| Conflict | `$(warning)` | 同步失败 | 错误状态，橙色背景高亮 |
| Disabled | `$(sync-ignored)` | Git同步 | 自动同步已禁用 |

工具提示显示详细信息，包括上次同步时间（如"5分钟前"）。

点击状态栏按钮会触发 `issueManager.synchronizeNow` 命令执行手动同步。

## 性能优化

### SimpleGit 实例缓存

每个工作目录只创建一个 `SimpleGit` 实例并缓存复用，避免频繁初始化：

```typescript
private static gitInstances = new Map<string, SimpleGit>();

private static getGit(cwd: string): SimpleGit {
    const cached = this.gitInstances.get(cwd);
    if (cached) return cached;
    // ... 创建新实例并缓存
}
```

### 分支名缓存

当前分支名以 1 分钟 TTL 缓存，避免 `pullChanges` 和 `commitAndPushChanges` 各自查询一次分支：

```typescript
private static branchCache = new Map<string, { branch: string; timestamp: number }>();
private static readonly BRANCH_CACHE_TTL = 60_000; // 1分钟

private static async getCurrentBranch(git: SimpleGit, cwd: string): Promise<string> {
    const cached = this.branchCache.get(cwd);
    if (cached && Date.now() - cached.timestamp < this.BRANCH_CACHE_TTL) {
        return cached.branch;
    }
    // ... 查询并缓存
}
```

### 防抖机制

文件变更使用 30 秒防抖（可配置），避免用户频繁编辑时触发大量同步。同一防抖窗口内的多次变更只会执行最后一次同步操作。

### 通知节流

相同类型的桌面通知在 1 分钟内只显示一次，避免在快速重试场景下打扰用户。

## 配置项

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `issueManager.sync.enableAutosync` | boolean | `false` | 启用自动同步 |
| `issueManager.sync.autoCommitMessage` | string | `[Auto-Sync] Changes at {date}` | 提交消息模板 |
| `issueManager.sync.changeDebounceInterval` | number | `30` | 文件变更防抖间隔（秒） |
| `issueManager.sync.periodicPullInterval` | number | `15` | 周期性拉取间隔（分钟） |
| `issueManager.sync.maxRetries` | number | `3` | 最大重试次数 |
| `issueManager.sync.retryInitialDelay` | number | `5` | 重试初始延迟（秒） |
| `issueManager.sync.enableNotifications` | boolean | `true` | 启用桌面通知 |
| `issueManager.sync.enableLLMCommitMessage` | boolean | `false` | 启用 LLM 智能提交消息 |

## 资源生命周期

系统区分两类可释放资源（Disposable）：

1. **文件监听资源** (`fileWatcherDisposables`)
   - 生命周期：`setupAutoSync()` 时创建，配置变更或进入冲突模式时销毁并重建
   - 包括：UnifiedFileWatcher 的事件订阅

2. **服务级资源** (`serviceDisposables`)
   - 生命周期：`initialize()` 时创建，仅在 `dispose()` 时销毁
   - 包括：VS Code 命令注册、配置变更监听器

```
setupAutoSync() 调用时:
    └─→ cleanup()
          ├─→ 清除 periodicTimer
          ├─→ cleanupFileWatcher()    ←── 只清理 fileWatcherDisposables
          └─→ retryManager.cleanup()

dispose() 调用时:
    └─→ cleanup()                     ←── 同上
          + statusBarManager.dispose()
          + notificationManager.dispose()
          + GitOperations.cleanup()   ←── 清理缓存
          + serviceDisposables 全部释放
```

## 数据流图

### 笔记从创建到同步的完整流程

```
用户操作: 创建笔记
    │
    ▼
createAndOpenIssue()
    │
    ├─→ generateFileName()      →  "20260308-143000-000.md"
    │
    ├─→ createIssueMarkdown()
    │     ├─→ 生成 YAML frontmatter
    │     ├─→ 写入文件到 issueDir
    │     └─→ 刷新缓存
    │
    ├─→ 在编辑器中打开文件
    │
    └─→ GitSyncService.triggerSync()
          │
          ▼
        防抖等待 30 秒
          │
          ▼
        performAutoCommitAndPush()
          │
          ├─→ git status (收集变更)
          ├─→ git add ['*.md', '.issueManager']
          ├─→ 生成提交消息 (LLM / 模板)
          ├─→ git commit -m "..."          ←── 先 commit 保证数据安全
          ├─→ git pull origin main --no-rebase
          └─→ git push origin main
                ├─→ push 被拒绝 → pull + push 重试
                └─→ 网络错误 → 本地 commit 已保存
                │
                ▼
          远程仓库已更新
                │
                ▼
          其他设备通过周期性拉取获取更新
```

### 磁盘上的文件结构

```
issueDir/                              ←── 用户配置的笔记目录
├── .git/                              ←── Git 仓库
├── .issueManager/                     ←── 扩展内部状态
│   ├── .focused                       ←── 关注列表
│   ├── .issue-structure-cache         ←── 结构缓存
│   └── .state                         ←── 状态跟踪
├── 20260308-143000-000.md             ←── 笔记文件
├── 20260307-120500-000.md
└── 20260301-090000-000.md
```

每个笔记文件格式：

```markdown
---
issue_root_file: null
issue_parent_file: null
issue_children_files: []
issue_linked_files: []
issue_linked_workspace: []
issue_title: "笔记标题"
issue_description: "描述"
issue_brief_summary: "摘要"
terms: []
terms_references: []
---

# 笔记标题

正文内容...
```

## 前提条件

使用 Git 自动同步功能需要：

1. **笔记目录已初始化为 Git 仓库**：目录下存在 `.git/` 文件夹
2. **已配置远程仓库**：`git remote` 中有 `origin`
3. **Git 认证已配置**：SSH key 或 HTTPS 凭据能正常推拉
4. **启用自动同步**：设置 `issueManager.sync.enableAutosync = true`
5. **（可选）LLM 提交消息**：需要安装并登录 GitHub Copilot 扩展
