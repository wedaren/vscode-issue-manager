---
# 创建 Wiki（IssueMarkdown） - Prompt 模板
---

请基于下面的标题和上下文生成 issue 的 Markdown 正文（body）。注意：Frontmatter 已由程序生成，请不要输出任何 frontmatter。

- 输出内容仅为 Markdown 正文（可以包含 H1 标题），不要包含 YAML frontmatter 或额外的解释文本。
- 正文建议包含：H1 标题、简要摘要、背景/要点/后续步骤/参考等小节，语言为中文。

输入占位符：
- 标题：{{title}}
- 选中文本/上下文：
```
{{selection}}
```

请将生成结果写成可直接写入文件的 Markdown 正文（不含 frontmatter），并保持语言为中文。谢谢。
