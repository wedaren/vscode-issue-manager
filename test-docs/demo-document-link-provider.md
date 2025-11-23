# DocumentLinkProvider 功能演示

本文档演示 IssueDocumentLinkProvider 的功能，它可以解析包含 `?issueId=` 查询参数的 markdown 链接。

## 功能说明

DocumentLinkProvider 使得你可以在 markdown 文档中创建带有 issueId 上下文的链接，点击这些链接时会保留 issueId 参数，从而在编辑器中维持正确的上下文状态。

## 示例链接

### 1. 带 issueId 的链接

这是一个包含 issueId 的链接：[测试文件](test-structure-root.md?issueId=test-123)

当你点击这个链接时，文件会以 `?issueId=test-123` 的查询参数打开。

### 2. 带多个查询参数的链接

链接可以包含多个参数：[多参数示例](test-structure-child1.md?issueId=child-456&view=focused)

### 3. 普通链接（不带 issueId）

普通的 markdown 链接也能正常工作：[普通链接](test-structure-child2.md)

### 4. 外部链接

外部链接会被正确跳过，由 VSCode 默认处理：[GitHub](https://github.com)

### 5. 锚点链接

文档内的锚点链接：[跳转到功能说明](#功能说明)

## 技术实现

IssueDocumentLinkProvider 实现了以下功能：

1. **链接解析**：使用正则表达式解析 markdown 链接格式 `[text](path)`
2. **查询参数提取**：识别并保留 `?issueId=xxx` 等查询参数
3. **路径解析**：支持相对路径和绝对路径的正确解析
4. **链接过滤**：自动跳过外部链接（http/https）和锚点链接（#）
5. **Tooltip提示**：为包含 issueId 的链接显示提示信息

## 使用场景

此功能特别适用于：

- 在问题管理器中维护问题之间的关联
- 保持编辑器上下文，确保相关视图正确更新
- 在文档中创建带上下文的导航链接

## 相关文件

- 实现文件：`src/providers/IssueDocumentLinkProvider.ts`
- 注册位置：`src/extension.ts`
- 测试文件：`src/test/IssueDocumentLinkProvider.test.ts`
