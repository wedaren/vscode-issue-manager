# .issueManager 目录使用说明

## 目录结构

```
.issueManager/
├── rss-history.yaml    # RSS文章历史记录（YAML格式）
└── (未来可能的其他配置文件)
```

## 版本控制建议

### 选项1：包含在版本控制中（推荐用于团队协作）
如果你希望团队成员共享RSS订阅配置和历史记录：

在项目根目录的 `.gitignore` 中**不要**添加 `.issueManager/`

### 选项2：排除版本控制（推荐用于个人项目）
如果你希望保持RSS历史记录为个人私有：

在项目根目录的 `.gitignore` 中添加：
```gitignore
# 问题管理器私有配置
.issueManager/
```

### 选项3：部分版本控制（灵活方案）
如果你希望共享配置但保持历史记录私有：

在项目根目录的 `.gitignore` 中添加：
```gitignore
# 排除RSS历史记录，但保留其他配置
.issueManager/rss-history.yaml
```

## 同步方案

### 云同步
- **Dropbox/OneDrive/iCloud**：将工作区放在云同步目录中
- **Git同步**：通过版本控制系统同步（见上面的版本控制建议）
- **手动同步**：复制 `.issueManager` 目录到其他设备

### 备份建议
定期备份 `.issueManager/rss-history.json` 文件，因为它包含了你的RSS阅读历史。

### 数据迁移
当切换工作区或设备时，只需复制整个 `.issueManager` 目录即可保留所有RSS历史记录。

## 文件格式说明

### rss-history.yaml
```yaml
# RSS文章历史记录
订阅源ID:
  - id: 文章ID
    feedId: 订阅源ID
    title: 文章标题
    link: 文章链接
    description: 文章描述
    pubDate: 发布时间(ISO字符串)
    content: 文章内容(可选)
    author: 作者(可选)
    categories:
      - 分类标签1
      - 分类标签2
```

这个文件使用YAML格式，比JSON更易读和编辑。

## 故障排除

### 文件损坏
如果 `rss-history.yaml` 文件损坏，插件会自动创建新的空文件，不影响正常使用。

### 权限问题
确保VS Code有权限读写工作区目录。在某些情况下可能需要管理员权限。

### 大文件性能
如果历史记录文件过大影响性能，可以使用插件的"清理旧文章"功能减少文件大小。
