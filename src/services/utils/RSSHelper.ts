import * as vscode from 'vscode';

/**
 * RSS帮助工具类
 */
export class RSSHelper {
    /**
     * 显示RSS格式帮助信息
     */
    public static showRSSFormatHelp(): void {
        const helpContent = `# RSS订阅源格式说明

本插件支持两种RSS订阅源格式：JSON Feed 和 XML RSS。

## 支持的格式：

### 一、JSON Feed格式

#### 1. 标准JSON Feed 1.1格式:
\`\`\`json
{
  "version": "https://jsonfeed.org/version/1.1",
  "title": "我的博客",
  "items": [
    {
      "title": "文章标题",
      "url": "https://example.com/article1",
      "date_published": "2025-01-01T00:00:00Z",
      "summary": "文章摘要",
      "author": {"name": "作者名"}
    }
  ]
}
\`\`\`

#### 2. 自定义JSON格式:
\`\`\`json
{
  "items": [
    {
      "title": "文章标题",
      "link": "https://example.com/article1",
      "description": "文章描述",
      "pubDate": "2025-01-01",
      "author": "作者名"
    }
  ]
}
\`\`\`

#### 3. 直接数组格式:
\`\`\`json
[
  {
    "title": "文章标题",
    "url": "https://example.com/article1",
    "date": "2025-01-01"
  }
]
\`\`\`

### 二、XML RSS格式

#### 1. RSS 2.0格式:
\`\`\`xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>博客标题</title>
    <item>
      <title>文章标题</title>
      <link>https://example.com/article1</link>
      <description>文章描述</description>
      <pubDate>Mon, 01 Jan 2025 00:00:00 GMT</pubDate>
      <author>作者邮箱</author>
    </item>
  </channel>
</rss>
\`\`\`

#### 2. Atom格式:
\`\`\`xml
<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>博客标题</title>
  <entry>
    <title>文章标题</title>
    <link href="https://example.com/article1"/>
    <summary>文章摘要</summary>
    <published>2025-01-01T00:00:00Z</published>
    <author><name>作者名</name></author>
  </entry>
</feed>
\`\`\`

#### 3. RDF格式:
\`\`\`xml
<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <item>
    <title>文章标题</title>
    <link>https://example.com/article1</link>
    <description>文章描述</description>
    <dc:date>2025-01-01</dc:date>
  </item>
</rdf:RDF>
\`\`\`

了解更多:
- JSON Feed: https://jsonfeed.org/
- RSS规范: https://www.rssboard.org/rss-specification`;

        // 创建并显示虚拟文档
        vscode.workspace.openTextDocument({
            content: helpContent,
            language: 'markdown'
        }).then(doc => {
            vscode.window.showTextDocument(doc);
        });
    }

    /**
     * 显示JSON Feed格式帮助信息（保持向后兼容）
     */
    public static showJSONFeedHelp(): void {
        // 调用新的综合帮助方法
        RSSHelper.showRSSFormatHelp();
    }

    /**
     * 生成订阅源ID
     */
    public static generateFeedId(): string {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 10);
        return `feed_${timestamp}_${random}`;
    }

    /**
     * 清理文件名中的非法字符
     */
    public static sanitizeFilename(filename: string): string {
        return filename
            .replace(/[<>:"/\\|?*]/g, '-')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .substring(0, 50); // 限制长度
    }
}
