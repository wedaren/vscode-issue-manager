# Gemini Code Assist 使用指南

本项目已配置 Gemini Code Assist for GitHub，用于自动代码审查和 AI 辅助开发。

## 配置文件

- **主配置**: `.gemini/config.yaml` - 包含 Gemini 的行为配置
- **风格指南**: `.gemini/styleguide.md` - 项目特定的编码规范

## 当前配置特点

### 审查模式

- 使用**专业语调**，适合严肃的开发项目
- **中等严重程度阈值**，过滤掉过于细微的问题
- **无评论数量限制**，确保所有重要问题都被发现
- **自动审查新 PR**，提高开发效率

### 忽略文件

配置忽略了以下类型的文件：

- 测试文件 (`*.test.ts`, `src/test/**`)
- 构建产物 (`out/**`, `dist/**`, `*.vsix`)
- 依赖包 (`node_modules/**`)
- 配置文件 (`tsconfig.json`, `webpack.config.js` 等)
- 文档文件 (`*.md`, `docs/**`)

## 使用方法

### 在 Pull Request 中使用命令

#### 1. 手动触发代码审查

```text
/gemini review
```

适用场景：

- 完成代码修改后想获得反馈
- 自动审查失败或被跳过时

#### 2. 生成 PR 摘要

```text
/gemini summary
```

适用场景：

- 复杂的 PR 需要清晰的变更说明
- 为团队成员解释代码变更

#### 3. 直接询问问题

```text
@gemini-code-assist 这个函数的性能如何？有优化建议吗？
```

适用场景：

- 对特定代码有疑问
- 需要最佳实践建议
- 讨论替代实现方案

### 针对 VS Code 扩展开发的常见问题

#### 资源管理

```text
@gemini-code-assist 这里的 TreeDataProvider 是否正确实现了资源释放？
```

#### 性能优化

```text
@gemini-code-assist 这个文件监听器会不会造成性能问题？
```

#### API 使用

```text
@gemini-code-assist 这种方式使用 VS Code API 是否符合最佳实践？
```

#### 类型安全

```text
@gemini-code-assist 这里的类型定义是否足够严格？
```

## 审查重点

Gemini 会特别关注以下方面：

### TypeScript 代码质量

- 类型安全性和类型定义
- 接口设计的合理性
- 泛型使用的正确性

### VS Code 扩展特定问题

- 资源管理和内存泄漏
- API 使用的正确性
- 性能优化机会

### 架构和设计

- 模块职责划分
- 依赖注入的使用
- 错误处理策略

### 安全性

- 文件路径验证
- 用户输入验证
- 权限检查

## 最佳实践建议

1. **提交前自查**: 在提交 PR 前使用 `/gemini review` 进行初步检查
2. **具体询问**: 使用 `@gemini-code-assist` 针对特定问题进行询问
3. **及时修复**: 根据 Gemini 的建议及时修复发现的问题
4. **学习改进**: 从 Gemini 的反馈中学习最佳实践

## 配置调整

如果需要调整配置，可以编辑 `.gemini/config.yaml` 文件：

- **降低噪音**: 将 `comment_severity_threshold` 改为 `HIGH`
- **限制评论**: 设置 `max_review_comments` 为具体数字
- **调整忽略**: 修改 `ignore_patterns` 数组

## 注意事项

- Gemini Code Assist 需要在 GitHub 仓库中安装才能使用
- 配置变更后可能需要重新触发审查才能生效
- 私有仓库需要确保已授权 Gemini 访问
