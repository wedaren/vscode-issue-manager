---
title: "测试根文档"
date: "2025-01-02"
root_file: "test-strategy1-root.md"
children_files: []
---

# 策略1 测试 - 根文档

这是用于测试策略1自动 frontmatter 维护功能的根文档。

## 测试计划

### 测试1: 新建子文档
- 在同一目录下创建新的 markdown 文件
- 验证是否自动添加到 children_files
- 验证新文件的 parent_file 是否正确设置

### 测试2: 删除子文档
- 删除已存在的子文档
- 验证是否自动从 children_files 中移除

### 测试3: 手动编辑 frontmatter
- 手动修改子文档的 parent_file
- 验证父文档的 children_files 是否自动同步

## 当前状态
- 文件: test-strategy1-root.md
- children_files: []
- 等待测试...
