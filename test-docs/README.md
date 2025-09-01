# 问题结构视图测试文档

这个目录包含用于测试"问题结构"视图功能的示例文档。

## 测试场景

### 1. 正常的层级结构
- `test-structure-root.md` - 根文档
- `test-structure-child1.md` - 子文档1（叶子节点）
- `test-structure-child2.md` - 子文档2（有子节点）
- `test-structure-grandchild.md` - 孙子文档

### 2. 循环引用检测
- `test-cycle-root.md` - 循环引用根文档
- `test-cycle-child.md` - 故意引用父文档，创建循环

### 3. 缺失文件处理
- `test-missing-root.md` - 引用了不存在的文件
- `test-missing-child.md` - 存在的子文档
- `non-existent-file.md` - 不存在的文件（被引用但未创建）

## 使用方法

1. 配置 VS Code 问题管理插件的问题目录为这个 `test-docs` 目录
2. 在 VS Code 中打开任意一个 `.md` 文件
3. 查看"问题结构"视图，应该看到相应的结构显示
4. 测试各种场景下的视图行为

## 预期行为

- 打开正常结构文件时，应显示完整的树状结构
- 当前激活文件在树中应有高亮标识
- 循环引用应被检测并显示错误图标
- 缺失文件应显示为"幽灵"节点并带警告图标
- 点击任意节点应能打开对应文件
