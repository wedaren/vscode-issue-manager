# RSS内容处理功能使用指南

## 概述

RSS内容处理功能允许您定制化处理RSS文章的内容，包括内容裁剪、HTML清理、摘要提取等多种转换选项。

## 功能特性

### 1. 内容处理器

- **HTML清理处理器** (`html-cleanup`): 清理和过滤HTML内容
- **长度裁剪处理器** (`length-trim`): 按指定长度智能裁剪内容  
- **摘要提取处理器** (`summary-extract`): 智能提取内容摘要
- **自定义规则处理器** (`custom-rules`): 应用用户自定义的正则表达式规则

### 2. 预设配置

#### 简洁模式 (concise)
- 移除HTML标签
- 限制内容长度为300字符
- 保留链接

#### 摘要模式 (summary)  
- 移除HTML标签
- 提取文章摘要（最多2句话）
- 优先提取"摘要"、"总结"等章节

#### 清洁模式 (clean)
- 保留HTML标签
- 移除危险标签（script、style等）
- 保留图片和链接

#### 纯文本模式 (plain)
- 移除所有HTML标签
- 限制内容长度为500字符

## 配置方法

### 1. 全局默认配置

通过VS Code设置配置默认的内容处理方式：

```json
{
  "issueManager.rss.contentProcessing.defaultPreset": "concise",
  "issueManager.rss.contentProcessing.maxLength": 500,
  "issueManager.rss.contentProcessing.preserveHtml": false,
  "issueManager.rss.contentProcessing.preserveImages": true,
  "issueManager.rss.contentProcessing.preserveLinks": true
}
```

### 2. 订阅源特定配置

为不同的订阅源设置不同的处理规则：

1. 右键点击RSS订阅源
2. 选择"配置订阅源内容处理"
3. 选择适合的处理模式

### 3. 自定义规则

添加自定义的正则表达式规则：

```json
{
  "issueManager.rss.contentProcessing.customRules": [
    {
      "pattern": "\\[广告\\].*?\\[/广告\\]",
      "replacement": "",
      "flags": "gi"
    },
    {
      "pattern": "点击查看原文",
      "replacement": "",
      "flags": "g"
    }
  ]
}
```

## 命令

### 配置内容处理
- **命令**: `issueManager.rss.configureContentProcessing`
- **功能**: 配置全局默认的内容处理预设

### 配置订阅源内容处理  
- **命令**: `issueManager.rss.configureFeedSpecificProcessing`
- **功能**: 为特定订阅源配置内容处理规则

## 使用示例

### 示例1: 技术博客订阅

对于技术博客，通常希望保留完整内容但清理HTML：

```json
{
  "preset": "clean",
  "options": {
    "preserveHtml": true,
    "preserveImages": true,
    "preserveLinks": true,
    "removeTags": ["script", "style", "iframe", "ads"]
  }
}
```

### 示例2: 新闻订阅

对于新闻订阅，可能只需要摘要：

```json
{
  "preset": "summary",
  "options": {
    "summaryMode": {
      "enabled": true,
      "maxSentences": 3,
      "preferredSections": ["导语", "摘要", "要点"]
    }
  }
}
```

### 示例3: 社交媒体订阅

对于社交媒体内容，可能需要严格的长度限制：

```json
{
  "preset": "concise", 
  "options": {
    "maxLength": 200,
    "preserveHtml": false,
    "customRules": [
      {
        "pattern": "#\\w+",
        "replacement": "",
        "flags": "g"
      }
    ]
  }
}
```

## 程序化使用

### 在代码中使用内容处理（重构后的简化API）

```typescript
import { RSSMarkdownConverter } from './services/converters/RSSMarkdownConverter';

// 1. 使用默认配置（会自动读取用户配置）
const markdown1 = RSSMarkdownConverter.convertToMarkdown(item, feed, true);

// 2. 禁用内容处理，保持原始内容
const markdown2 = RSSMarkdownConverter.convertToMarkdown(item, feed, false);

// 3. 使用预设配置
const markdown3 = RSSMarkdownConverter.convertToMarkdown(item, feed, true, {
  preset: 'concise'
});

// 4. 使用自定义处理器和选项
const markdown4 = RSSMarkdownConverter.convertToMarkdown(item, feed, true, {
  processors: ['html-cleanup', 'length-trim'],
  options: {
    maxLength: 300,
    preserveLinks: true,
    removeTags: ['script', 'style', 'iframe']
  }
});

// 5. 用于虚拟文件预览
const previewMarkdown = RSSMarkdownConverter.generatePreviewMarkdown(item, feed, true);
```

### RSSService中的简化调用

```typescript
// RSSService现在只需要传递是否使用内容处理的标志
const markdownUri = await rssService.convertToMarkdown(item, true);
const previewContent = rssService.getItemMarkdown(itemId, true);
```

### 方法签名说明

#### convertToMarkdown
```typescript
public static convertToMarkdown(
    item: RSSItem, 
    feed?: RSSFeed, 
    useCustomProcessing: boolean = true,
    processingOptions?: {
        preset?: string;
        processors?: string[];
        options?: ContentProcessingOptions;
    }
): string
```

**参数说明：**
- `item`: RSS文章项
- `feed`: RSS订阅源（可选）
- `useCustomProcessing`: 是否启用内容处理（默认true）
- `processingOptions`: 显式处理选项，会覆盖配置文件设置

**处理逻辑：**
1. 如果 `processingOptions` 存在，直接使用该配置
2. 否则，如果 `useCustomProcessing` 为 true，则：
   - 先查找订阅源特定配置
   - 如果没有，则使用全局默认配置
3. 如果 `useCustomProcessing` 为 false，则不进行任何内容处理

## 最佳实践

1. **选择合适的预设**: 大多数情况下，预设配置就能满足需求
2. **渐进式配置**: 先使用默认配置，根据实际效果再调整
3. **订阅源特定配置**: 为不同类型的订阅源设置不同的处理规则
4. **测试自定义规则**: 自定义正则表达式规则前先进行测试
5. **性能考虑**: 避免过于复杂的正则表达式规则

## 故障排除

### 常见问题

1. **内容被过度裁剪**: 检查`maxLength`设置，或使用摘要模式
2. **HTML标签未被清理**: 确认`preserveHtml`设置为false
3. **自定义规则不生效**: 检查正则表达式语法和flags设置
4. **处理性能问题**: 减少自定义规则数量，优化正则表达式

### 调试提示

- 使用VS Code的开发者工具查看控制台输出
- 测试单个处理器的效果
- 逐步添加处理规则，确定问题所在
