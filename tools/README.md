# 工具脚本

这个目录包含了项目开发过程中使用的辅助工具脚本。

## create_dev_icons.py

为 Chrome 扩展创建开发版本的图标。

### 功能

该脚本会：
1. 读取 `chrome-extension-wxt/public/` 目录下的生产版本图标
2. 在每个图标的右下角添加红色三角形背景和白色 "DEV" 文字
3. 将处理后的图标保存到 `chrome-extension-wxt/public/dev/` 目录

### 使用方法

```bash
# 在项目根目录运行
python3 tools/create_dev_icons.py
```

### 要求

- Python 3.6+
- Pillow 库

安装 Pillow：
```bash
pip install Pillow
```

### 何时使用

当您修改了生产版本的图标（`chrome-extension-wxt/public/` 目录下的图标）并希望重新生成开发版本的图标时，运行此脚本。

开发版本的图标会在 WXT 构建时自动使用（开发模式：`npm run chrome:dev`），无需手动干预。

### 图标处理效果

- 在图标右下角添加红色三角形背景（带透明度）
- 在三角形区域内显示白色 "DEV" 文字
- 保持原图标的其他部分不变
- 自动根据图标尺寸调整文字大小

这样可以在浏览器中一眼区分开发版本和生产版本的扩展。
