---
title: "测试子文档1"
date: "2025-01-02"
root_file: "test-strategy1-root.md"
parent_file: "test-strategy1-root.md"
children_files: []
---

# 测试子文档1

这是第一个测试子文档，用于验证 FrontmatterService 的功能。

## 当前状态
- parent_file: test-strategy1-root.md
- children_files: []
- 与根文档的关系: 子文档

测试项目：
- [x] 被正确添加到父文档的 children_files
- [ ] 删除时自动从父文档移除
- [ ] 手动编辑 frontmatter 时自动同步
