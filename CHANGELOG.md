# 变更日志

“issue-manager”扩展的所有显著变更都将记录在此文件中。

查看 [Keep a Changelog](http://keepachangelog.com/) 获取关于如何组织此文件的建议。

## [0.0.13] - 2025-07-05

### 新增

- feat: 实现 Language Model Tool API 支持 AI 聊天内容记录功能
- feat: 添加 Gemini Code Assist 配置，使用中文进行代码审查

### 修复与改进

- fix: 修复 QuickPick 资源管理和 Stale Response 问题
- fix: 移除 onDidAccept 中多余的 quickPick.dispose() 调用
- fix: 修正命令名称拼写错误
- docs: 在编码风格指南中强调使用中文回答

## [0.0.9] - 2025-07-02

### 新增

- feat: 添加关注问题视图的排序方式，按添加时间倒序排列

### 修复与改进

- 修复 关注问题视图中重复 ID 问题

## [0.0.8] - 2025-07-01

### 修复与改进

- feat: 节点展开/折叠状态的持久化与多视图同步

## [0.0.7] - 2025-07-01

### 修复与改进

- fix: 智能新建问题时，打开已有笔记也能插入到父节点，并完善需求文档说明

## [未发布]

- 初始版本
