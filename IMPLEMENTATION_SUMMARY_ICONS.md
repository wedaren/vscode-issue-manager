# Chrome 扩展开发版本和生产版本使用不同图标 - 实现总结

## 需求

实现 Chrome 插件的开发版本（chrome:dev）与发布版本（chrome:build）使用不同的图标，以便在浏览器中快速区分。

## 实现方案

### 1. 图标设计

创建了两套图标：

- **生产版本图标**: 位于 `chrome-extension-wxt/public/`
  - icon-16.png (16×16)
  - icon.png (32×32)
  - icon-48.png (48×48)
  - icon-128.png (128×128)

- **开发版本图标**: 位于 `chrome-extension-wxt/public/dev/`
  - 在原图标的右下角添加红色三角形背景
  - 在三角形区域显示白色 "DEV" 文字
  - 保持与生产版本相同的尺寸

### 2. WXT 配置修改

修改 `wxt.config.ts` 以支持根据构建模式动态选择图标：

```typescript
manifest: ({ mode }) => {
  // 根据构建模式选择不同的图标路径
  const isDev = mode === 'development';
  const iconPrefix = isDev ? 'dev/' : '';
  
  return {
    // ... 其他配置
    action: {
      default_icon: {
        '16': `${iconPrefix}icon-16.png`,
        '32': `${iconPrefix}icon.png`,
        '48': `${iconPrefix}icon-48.png`,
      },
    },
    icons: {
      '16': `${iconPrefix}icon-16.png`,
      '32': `${iconPrefix}icon.png`,
      '48': `${iconPrefix}icon-48.png`,
      '128': `${iconPrefix}icon-128.png`,
    },
  };
}
```

### 3. 工具脚本

创建了 `tools/create_dev_icons.py` Python 脚本，用于自动生成开发版本的图标：

**功能**：
- 读取生产版本图标
- 添加红色三角形背景和 "DEV" 文字
- 自动调整文字大小以适应不同尺寸的图标
- 跨平台支持（Linux、Windows、macOS）

**使用方法**：
```bash
python3 tools/create_dev_icons.py
```

### 4. 文档更新

更新了 `chrome-extension-wxt/README.md`，添加了关于图标配置的详细说明，包括：
- 不同构建模式使用不同图标的机制
- 图标目录结构
- 如何重新生成开发版本图标

## 使用方法

### 开发模式

```bash
npm run chrome:dev
```

- 启动开发服务器
- 使用带有 "DEV" 标识的图标
- manifest.json 中的图标路径为 `dev/icon-*.png`

### 生产构建

```bash
npm run chrome:build
```

- 构建生产版本
- 使用标准图标（无 "DEV" 标识）
- manifest.json 中的图标路径为 `icon-*.png`

### 打包发布

```bash
npm run chrome:zip
```

- 构建并打包为 ZIP 文件
- 使用生产版本图标
- 可直接上传到 Chrome Web Store

## 验证结果

### 生产版本 manifest.json

```json
{
  "icons": {
    "16": "icon-16.png",
    "32": "icon.png",
    "48": "icon-48.png",
    "128": "icon-128.png"
  }
}
```

### 开发版本 manifest.json

```json
{
  "icons": {
    "16": "dev/icon-16.png",
    "32": "dev/icon.png",
    "48": "dev/icon-48.png",
    "128": "dev/icon-128.png"
  }
}
```

## 技术要点

1. **WXT 框架的 manifest 配置函数**: 利用 WXT 提供的 manifest 配置函数，可以接收 `{ mode }` 参数来判断当前构建模式

2. **条件路径生成**: 根据 `mode === 'development'` 动态生成图标路径前缀

3. **图标处理**: 使用 Python Pillow 库进行图像处理，支持：
   - 图像合成（alpha 通道）
   - 绘制几何图形（三角形）
   - 文本渲染（自适应字体大小）

4. **跨平台字体支持**: 脚本尝试多个常见字体路径，确保在不同操作系统上都能正常工作

## 优势

1. **快速识别**: 在浏览器扩展管理页面和工具栏中，可以一眼区分开发版本和生产版本
2. **自动化**: 图标选择完全自动化，无需手动配置
3. **易维护**: 只需更新生产版本图标，运行脚本即可生成开发版本
4. **无侵入**: 不影响现有代码逻辑，只在配置层面做了调整

## 文件清单

- `wxt.config.ts` - 修改了 manifest 配置，支持根据模式选择图标
- `chrome-extension-wxt/public/dev/` - 新增开发版本图标目录
  - `icon-16.png`
  - `icon.png`
  - `icon-48.png`
  - `icon-128.png`
- `tools/create_dev_icons.py` - 图标生成脚本
- `tools/README.md` - 工具使用说明
- `chrome-extension-wxt/README.md` - 更新了图标配置说明

## 总结

成功实现了 Chrome 扩展开发版本和生产版本使用不同图标的需求。通过 WXT 框架的配置功能和自动化脚本，实现了：

- ✅ 开发版本使用带有 "DEV" 标识的图标
- ✅ 生产版本使用标准图标
- ✅ 自动根据构建模式切换图标
- ✅ 提供工具脚本便于维护
- ✅ 完善的文档说明

该方案简洁、高效、易维护，完全满足项目需求。
