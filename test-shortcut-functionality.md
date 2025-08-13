# 快捷键功能测试

## 新增功能：快捷键打开关注问题视图

### 实现的功能
1. **新增命令**：`issueManager.openFocusedView`
   - 标题：打开关注问题视图
   - 分类：Issue Manager

2. **快捷键绑定**：
   - Windows/Linux: `Ctrl+Shift+I`
   - macOS: `Cmd+Shift+I`
   - 仅在插件配置正确时可用 (`when: issueManager.isDirConfigured`)

### 功能说明
当用户按下快捷键时，会执行以下操作：
1. 激活问题管理扩展的活动栏视图
2. 聚焦到关注问题视图
3. 显示确认信息：已打开关注问题视图

### 测试方法
1. 确保已配置问题管理插件的问题目录
2. 按下 `Ctrl+Shift+I` (或 macOS 下的 `Cmd+Shift+I`)
3. 检查是否自动打开问题管理器活动栏并聚焦到关注问题视图
4. 确认显示成功提示信息

### 技术实现
- 在 `package.json` 中添加了新的命令定义和快捷键绑定
- 在 `src/extension.ts` 中注册了新的命令处理程序
- 使用 VS Code 内置命令来激活视图和聚焦

### 备注
- 选择了 `Ctrl+Shift+I` 而非 `Ctrl+Shift+F`，避免与 VS Code 内置的全局搜索快捷键冲突
- 快捷键只在插件正确配置后才可用，避免在未配置状态下的误操作
