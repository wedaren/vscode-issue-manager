# 发布工具使用指南

## 概述

这个自动化发布工具实现了TODO中要求的功能：
- 结合git log记录自动更新changelog
- 使用npm version patch管理版本号
- 自动创建git tag并支持推送到远程仓库
- 触发GitHub Actions自动发布到VS Code Marketplace

## 核心功能

### 1. 自动版本管理
- 使用 `npm version patch/minor/major` 自动增加版本号
- 同步更新package.json中的版本

### 2. 智能Changelog生成
- 从git log提取提交记录
- 按提交类型自动分类（feat, fix, docs, refactor等）
- 生成符合Keep a Changelog格式的条目
- 自动插入到CHANGELOG.md的TODO行后

### 3. Git集成
- 支持从最后一个版本tag以来的提交
- 自动创建版本tag
- 可选择自动推送到远程仓库

## 使用方法

### 基本用法

```bash
# 创建patch版本并更新changelog（不推送）
npm run release

# 或者直接使用
node scripts/release.js
```

### 版本类型选择

```bash
# Patch版本（0.1.12 -> 0.1.13）
npm run release:patch

# Minor版本（0.1.12 -> 0.2.0） 
npm run release:minor

# Major版本（0.1.12 -> 1.0.0）
npm run release:major
```

### 自动推送和发布

```bash
# 创建patch版本并自动推送tag（触发GitHub Actions发布）
npm run release:patch:tag

# 创建minor版本并自动推送tag
npm run release:minor:tag

# 创建major版本并自动推送tag  
npm run release:major:tag
```

### 高级选项

```bash
# 忽略工作区检查（有未提交更改时）
node scripts/release.js --force

# 查看帮助信息
node scripts/release.js --help
```

## 工作流程

1. **检查环境**
   - 验证是否在git仓库中
   - 检查工作区是否干净

2. **收集提交记录**
   - 从最后一个版本tag以来的提交
   - 如果没有tag，则获取最近10个提交

3. **解析和分类**
   - 按commit message前缀分类
   - 支持feat, fix, docs, refactor, perf, test, chore, improve等

4. **更新版本和文档**
   - 使用npm version增加版本号
   - 生成changelog条目
   - 更新CHANGELOG.md

5. **Git操作（可选）**
   - 提交所有更改
   - 创建版本tag
   - 推送到远程仓库

## 提交信息规范

为了获得最佳的changelog生成效果，建议使用以下提交信息格式：

```
<type>: <description>

# 示例：
feat: 新增RSS问题视图功能
fix: 修复问题结构视图无法展示新增markdown文档的问题
docs: 更新README文档
refactor: 重构GitSyncService架构
perf: 优化问题视图性能
test: 添加单元测试
chore: 更新依赖包版本
improve: 关注问题视图与问题总览支持折叠功能
```

支持的类型：
- `feat`: ✨ 新功能
- `fix`: 🐞 修复
- `docs`: 📚 文档
- `style`: 🎨 代码风格
- `refactor`: ♻️ 重构
- `perf`: ⚡ 性能优化
- `test`: 🧪 测试
- `chore`: 🔧 构建/工具
- `improve`: 🔧 改进

## 示例输出

运行发布脚本后，CHANGELOG.md会自动更新：

```markdown
## [0.1.13] - 2025-09-15

### ✨ 新功能
- **新增RSS问题视图功能**

### 🐞 修复
- **修复问题结构视图无法展示新增markdown文档的问题**

### 📚 文档
- **更新README文档**
```

## 注意事项

1. **权限要求**
   - 需要对仓库有push权限
   - GitHub Actions需要配置VSCE_TOKEN secret

2. **工作区状态**
   - 建议在干净的工作区运行
   - 使用--force可忽略未提交的更改

3. **版本策略**
   - 遵循语义化版本规范
   - patch: 向后兼容的bug修复
   - minor: 向后兼容的新功能
   - major: 不向后兼容的更改

4. **发布流程**
   - 推送tag后会自动触发GitHub Actions
   - 确保所有CI检查通过后再推送tag

## 故障排除

### 常见问题

1. **找不到版本tag**
   ```
   ⚠️  未找到版本标签，获取最近10个提交
   ```
   这是正常的，首次使用时会从最近的提交开始。

2. **工作区不干净**
   ```
   ⚠️  工作区有未提交的更改
   ```
   提交更改或使用--force参数。

3. **npm version失败**
   确保package.json格式正确且版本号有效。

### 调试

使用测试脚本检查解析逻辑：
```bash
node scripts/test-release.js
```

## 自定义配置

可以修改 `scripts/release.js` 中的 `CONFIG` 对象来自定义：
- changelog文件路径
- git log命令
- 提交类型映射

```javascript
const CONFIG = {
  changelogPath: path.join(__dirname, '..', 'CHANGELOG.md'),
  packageJsonPath: path.join(__dirname, '..', 'package.json'),
  gitLogCommand: 'git log --oneline --pretty=format:"%h %s" ...',
  // ...
};
```