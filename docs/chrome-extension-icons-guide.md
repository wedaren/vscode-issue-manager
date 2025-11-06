# Chrome 扩展图标区分功能使用指南

## 功能简介

本项目已实现 Chrome 扩展在开发版本和生产版本使用不同图标的功能。这样可以在浏览器中一眼区分当前安装的是哪个版本的扩展。

## 图标效果

### 生产版本图标
- 使用标准的扩展图标
- 无任何标识

### 开发版本图标
- 在图标右下角添加红色三角形背景
- 三角形内显示白色 "DEV" 文字
- 一眼就能识别是开发版本

## 使用方法

### 1. 开发模式

启动开发服务器（使用开发版图标）：

```bash
npm run chrome:dev
```

然后在 Chrome 浏览器中：
1. 访问 `chrome://extensions/`
2. 开启"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择 `.output/chrome-mv3-dev` 目录

此时在扩展管理页面和工具栏中会看到带有红色 "DEV" 标识的图标。

### 2. 生产构建

构建生产版本（使用标准图标）：

```bash
npm run chrome:build
```

构建产物位于 `.output/chrome-mv3/` 目录，使用标准图标。

### 3. 打包发布

构建并打包为 ZIP 文件（用于上传到 Chrome Web Store）：

```bash
npm run chrome:zip
```

ZIP 文件使用生产版本图标，无 "DEV" 标识。

## 自定义开发图标

如果您修改了生产版本的图标，需要重新生成开发版本的图标。

### 前置条件

- Python 3.6+
- Pillow 库

安装 Pillow：
```bash
pip install Pillow
```

### 重新生成开发版图标

在项目根目录运行：

```bash
python3 tools/create_dev_icons.py
```

脚本会：
1. 读取 `chrome-extension-wxt/public/` 下的生产版图标
2. 在每个图标右下角添加红色三角形和 "DEV" 文字
3. 保存到 `chrome-extension-wxt/public/dev/` 目录

输出示例：
```
============================================================
Chrome 扩展开发版本图标生成器
============================================================

目标目录: chrome-extension-wxt/public/dev

✓ 创建: chrome-extension-wxt/public/dev/icon-16.png
✓ 创建: chrome-extension-wxt/public/dev/icon.png
✓ 创建: chrome-extension-wxt/public/dev/icon-48.png
✓ 创建: chrome-extension-wxt/public/dev/icon-128.png

============================================================
完成! 成功生成 4/4 个开发版本图标
============================================================
```

## 技术实现

### WXT 配置

`wxt.config.ts` 中的 manifest 配置函数根据构建模式动态选择图标：

```typescript
manifest: ({ mode }) => {
  const isDev = mode === 'development';
  const iconPrefix = isDev ? 'dev/' : '';
  
  return {
    icons: {
      '16': `${iconPrefix}icon-16.png`,
      '32': `${iconPrefix}icon.png`,
      '48': `${iconPrefix}icon-48.png`,
      '128': `${iconPrefix}icon-128.png`,
    },
  };
}
```

### 图标目录结构

```
chrome-extension-wxt/public/
├── icon-16.png          # 生产版本 16x16
├── icon.png             # 生产版本 32x32
├── icon-48.png          # 生产版本 48x48
├── icon-128.png         # 生产版本 128x128
└── dev/                 # 开发版本图标目录
    ├── icon-16.png      # 开发版本 16x16 (带 DEV 标识)
    ├── icon.png         # 开发版本 32x32 (带 DEV 标识)
    ├── icon-48.png      # 开发版本 48x48 (带 DEV 标识)
    └── icon-128.png     # 开发版本 128x128 (带 DEV 标识)
```

## 常见问题

### Q: 为什么需要区分开发和生产版本的图标？

A: 在开发过程中，可能同时安装了开发版本和生产版本的扩展。通过不同的图标，可以快速识别当前使用的是哪个版本，避免混淆。

### Q: 可以自定义 "DEV" 标识的样式吗？

A: 可以。修改 `tools/create_dev_icons.py` 脚本中的颜色、文字、位置等参数即可。例如：
- 修改 `fill=(220, 20, 60, 200)` 更改三角形颜色
- 修改 `text = "DEV"` 更改显示文字
- 修改三角形大小：`triangle_size = int(width * 0.6)`

### Q: 图标生成失败怎么办？

A: 确保：
1. 已安装 Pillow：`pip install Pillow`
2. 源图标文件存在于 `chrome-extension-wxt/public/`
3. 有权限写入 `chrome-extension-wxt/public/dev/` 目录

### Q: 能否为其他浏览器（如 Firefox）也使用不同图标？

A: 可以。WXT 支持多浏览器构建。在配置中添加浏览器判断即可：

```typescript
manifest: ({ mode, browser }) => {
  const isDev = mode === 'development';
  const iconPrefix = isDev ? 'dev/' : '';
  // 根据 browser 参数进一步定制
}
```

## 相关文档

- [WXT 文档](https://wxt.dev/)
- [Chrome 扩展开发文档](https://developer.chrome.com/docs/extensions/)
- [工具脚本说明](../tools/README.md)
- [实现总结](../IMPLEMENTATION_SUMMARY_ICONS.md)

## 总结

通过这个功能，您可以：
- ✅ 在浏览器中快速识别开发版本和生产版本
- ✅ 避免混淆不同版本的扩展
- ✅ 自动化图标生成和切换
- ✅ 轻松维护和更新图标

祝开发愉快！🎉
