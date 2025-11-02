# Chrome 扩展更新日志

## [2.0.0] - 2025-11-02

### 🎉 重大更新：迁移到 WXT + Vue

完全重写 Chrome 扩展，采用现代化技术栈。

### ✨ 新增

- **WXT 框架**: 使用 WXT 0.20.11 作为扩展开发框架
- **Vue 3**: 使用 Vue 3 Composition API 构建 UI
- **TypeScript**: 完整的类型安全支持
- **Vite**: 快速的构建工具
- **热重载**: 开发模式支持实时预览
- **多尺寸图标**: 支持 16×16, 32×32, 48×48, 128×128 四种尺寸

### 🔄 改进

- **代码质量**: 
  - 从原生 JavaScript 升级到 TypeScript
  - 使用 Vue 响应式数据管理
  - 组件化架构，代码更易维护
  
- **开发体验**:
  - 开发模式支持热重载
  - 构建时间从无到 1.4 秒
  - TypeScript 智能提示
  - Vue DevTools 支持

- **性能优化**:
  - 构建产物优化，总大小约 89KB
  - 代码分割和懒加载
  - 更快的加载速度

### 📚 文档

- 新增 `README.md` - 详细使用和开发文档
- 新增 `TESTING.md` - 完整测试指南
- 新增 `CHANGELOG.md` - 本文件
- 项目根目录新增 `MIGRATION_GUIDE.md` - 迁移指南

### 🔧 技术细节

#### 文件结构
```
chrome-extension-wxt/
├── entrypoints/
│   ├── background.ts        # TypeScript 重写
│   ├── content/
│   │   ├── index.ts        # TypeScript 重写
│   │   └── style.css
│   └── sidepanel/
│       ├── index.html
│       ├── main.ts
│       └── style.css
├── components/
│   └── SidePanel.vue       # Vue 3 单文件组件
├── public/
│   ├── icon.png
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
└── README.md
```

#### 依赖项
- `wxt@^0.20.11`
- `vue@^3.x`
- `@vitejs/plugin-vue@^5.x`
- `typescript@^5.7.x`

#### 构建命令
```bash
npm run chrome:dev      # 开发模式
npm run chrome:build    # 生产构建
npm run chrome:zip      # 打包 ZIP
```

### ✅ 功能保持

所有原有功能完整保留：
- WebSocket 与 VSCode 通信
- DOM 可视化选取器
- 键盘导航支持
- 关注问题列表
- HTML 到 Markdown 转换
- 错误处理和回退机制

### 🐛 已知问题

- 图标目前使用相同的源文件缩放到不同尺寸。建议后续为每个尺寸创建优化的图标文件。

### 🔐 安全

- 通过 CodeQL 安全扫描，无安全问题
- 所有依赖项已更新到最新稳定版本
- 遵循 Chrome 扩展最佳安全实践

---

## [1.0.0] - 旧版本

### 功能
- 原生 JavaScript 实现
- 基础的 DOM 选取功能
- WebSocket 通信
- Side Panel UI

### 技术栈
- 原生 JavaScript
- 无构建工具
- 手动开发流程

---

## 迁移说明

从 1.0.0 升级到 2.0.0：

1. 旧版本代码已备份到 `chrome-extension.backup/` 目录
2. 新版本位于 `chrome-extension-wxt/` 目录
3. 功能完全兼容，无需修改 VSCode 扩展
4. 详细迁移指南请参见 `/MIGRATION_GUIDE.md`

## 贡献

感谢所有为这次重大更新做出贡献的开发者！

特别感谢：
- WXT 框架团队
- Vue.js 团队
- TypeScript 团队
- 所有提供反馈和建议的用户

---

更多信息请访问：
- [GitHub 仓库](https://github.com/wedaren/vscode-issue-manager)
- [使用文档](README.md)
- [测试指南](TESTING.md)
- [迁移指南](../MIGRATION_GUIDE.md)
