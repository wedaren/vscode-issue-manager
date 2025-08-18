# RSS历史记录格式升级：JSON → YAML

## 改进说明

将RSS历史记录的存储格式从JSON升级为YAML，提供更好的可读性和编辑体验。

## 格式对比

### 之前（JSON格式）
```json
{
  "example-feed-1": [
    {
      "id": "article-1",
      "feedId": "example-feed-1",
      "title": "示例文章标题",
      "link": "https://example.com/article-1",
      "description": "这是一个示例RSS文章的描述信息",
      "pubDate": "2025-01-15T10:30:00.000Z",
      "content": "文章的完整内容...",
      "author": "作者姓名",
      "categories": ["技术", "开发"]
    }
  ]
}
```

### 现在（YAML格式）
```yaml
# RSS文章历史记录
# 此文件保存所有RSS订阅源的文章历史记录

example-feed-1:
  - id: article-1
    feedId: example-feed-1
    title: 示例文章标题
    link: https://example.com/article-1
    description: 这是一个示例RSS文章的描述信息
    pubDate: '2025-01-15T10:30:00.000Z'
    content: 文章的完整内容...
    author: 作者姓名
    categories:
      - 技术
      - 开发
```

## YAML格式优势

### 1. 可读性更佳
- **层次清晰**：通过缩进表示层次结构，比大括号更直观
- **注释支持**：可以添加 `#` 注释说明，便于理解和维护
- **视觉友好**：减少了符号干扰，数据结构一目了然

### 2. 编辑更便利
- **手动编辑**：更容易手动添加、修改、删除条目
- **格式宽松**：不需要严格的引号和逗号规则
- **错误宽容**：轻微的格式错误不会导致整个文件失效

### 3. 维护性提升
- **版本控制友好**：Git diff 显示更清晰的变更
- **合并冲突解决**：结构化的格式使合并冲突更容易解决
- **数据验证**：可以使用YAML Schema进行数据验证

### 4. 国际化支持
- **Unicode友好**：更好地支持中文等非ASCII字符
- **多行字符串**：支持保持原始格式的多行文本
- **特殊字符处理**：更灵活的字符串引用机制

## 技术实现

### 依赖包升级
```json
{
  "dependencies": {
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9"
  }
}
```

### 新增工具函数
```typescript
// 读取YAML文件
export async function readYAMLFile<T = any>(fileUri: vscode.Uri): Promise<T | null>

// 写入YAML文件  
export async function writeYAMLFile(fileUri: vscode.Uri, data: any): Promise<boolean>
```

### YAML配置选项
```typescript
yaml.dump(data, {
  indent: 2,           // 缩进空格数
  lineWidth: -1,       // 禁用行宽限制
  noRefs: true,        // 禁用引用
  sortKeys: false      // 保持原始键顺序
});
```

## 文件迁移

### 自动迁移策略
对于现有的JSON文件，系统会：
1. 检测到JSON格式的历史文件时自动读取
2. 将数据转换为YAML格式并保存
3. 保留原始JSON文件作为备份
4. 后续操作使用YAML格式

### 迁移实现
```typescript
async function migrateFromJSON(): Promise<void> {
    const jsonPath = vscode.Uri.joinPath(issueManagerDir, 'rss-history.json');
    const yamlPath = vscode.Uri.joinPath(issueManagerDir, 'rss-history.yaml');
    
    try {
        // 读取JSON文件
        const jsonData = await readJSONFile(jsonPath);
        if (jsonData) {
            // 保存为YAML格式
            await writeYAMLFile(yamlPath, jsonData);
            
            // 重命名JSON文件为备份
            const backupPath = vscode.Uri.joinPath(issueManagerDir, 'rss-history.json.backup');
            await vscode.workspace.fs.rename(jsonPath, backupPath);
            
            vscode.window.showInformationMessage('RSS历史记录已升级为YAML格式');
        }
    } catch (error) {
        console.error('迁移RSS历史记录失败:', error);
    }
}
```

## 用户体验改进

### 编辑体验
- **语法高亮**：大多数编辑器都支持YAML语法高亮
- **自动缩进**：编辑器可以自动处理YAML缩进
- **折叠功能**：可以折叠大的数据块便于浏览

### 调试便利
- **错误定位**：YAML解析错误会指出具体行号
- **数据验证**：可以使用在线YAML验证工具
- **格式化工具**：丰富的YAML格式化和美化工具

### 协作友好
- **团队共享**：YAML格式更容易在团队中共享和讨论
- **文档化**：可以在文件中添加详细的注释和说明
- **标准化**：YAML是广泛采用的配置文件标准

## 性能考虑

### 解析性能
- **js-yaml库**：成熟稳定的YAML解析库
- **内存效率**：与JSON相比内存使用相当
- **解析速度**：略慢于JSON但差异很小

### 文件大小
- **压缩比较**：YAML文件通常比JSON稍大
- **可读性权衡**：为了可读性而牺牲少量存储空间是值得的
- **实际影响**：对于RSS历史记录文件，大小差异微不足道

## 兼容性保证

### 向后兼容
- **数据结构不变**：底层数据结构保持完全一致
- **API不变**：所有公共接口保持不变
- **功能一致**：所有RSS历史管理功能完全一致

### 平台支持
- **跨平台**：js-yaml在所有Node.js支持的平台上工作
- **VS Code兼容**：与所有VS Code版本兼容
- **编码支持**：完整的UTF-8支持

## 示例对比

### 配置复杂度
**JSON格式**：
```json
{"config":{"enabled":true,"feeds":[{"name":"Feed1","url":"http://example.com"}]}}
```

**YAML格式**：
```yaml
config:
  enabled: true
  feeds:
    - name: Feed1
      url: http://example.com
```

### 注释和文档
**JSON格式**：
```json
{
  "_comment": "This is a workaround for comments",
  "data": "value"
}
```

**YAML格式**：
```yaml
# 这是真正的注释，不会影响数据结构
data: value
```

## 未来发展

### Schema验证
```yaml
# 可以定义YAML Schema进行数据验证
$schema: "rss-history-schema.yaml"
```

### 模板功能
```yaml
# 支持YAML锚点和引用，减少重复
default-article: &default
  author: Unknown
  categories: []

feeds:
  feed1:
    - <<: *default
      title: Article 1
```

### 配置分离
```yaml
# 可以将配置和数据分离
feeds: !include feeds.yaml
history: !include history.yaml
```

## 总结

YAML格式升级为RSS历史记录管理带来了显著的用户体验提升：

✅ **可读性更强**：清晰的层次结构和注释支持
✅ **编辑更容易**：手动编辑和维护更加便利
✅ **版本控制友好**：Git操作和合并更加直观
✅ **标准化**：使用业界标准的配置文件格式
✅ **向后兼容**：保持所有现有功能不变

这个改进让RSS历史记录不仅功能强大，而且用户友好，是朝着更好用户体验迈进的重要一步。
