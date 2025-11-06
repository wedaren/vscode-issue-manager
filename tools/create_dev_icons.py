#!/usr/bin/env python3
"""
为 Chrome 扩展创建开发版本图标

这个脚本会读取 chrome-extension-wxt/public/ 目录下的生产版本图标，
并在每个图标的右下角添加红色三角形背景和白色 "DEV" 文字，
然后保存到 chrome-extension-wxt/public/dev/ 目录。

用法:
    python3 tools/create_dev_icons.py

要求:
    - Python 3.6+
    - Pillow 库 (pip install Pillow)
"""
from PIL import Image, ImageDraw, ImageFont
import os
import sys

# 获取项目根目录
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 源图标目录和目标目录
src_dir = os.path.join(project_root, 'chrome-extension-wxt/public')
dest_dir = os.path.join(project_root, 'chrome-extension-wxt/public/dev')

# 图标文件列表
icons = ['icon-16.png', 'icon.png', 'icon-48.png', 'icon-128.png']

def create_dev_icon(src_path, dest_path):
    """为单个图标添加 DEV 标识"""
    # 打开原图标
    img = Image.open(src_path).convert('RGBA')
    width, height = img.size
    
    # 创建绘图对象
    draw = ImageDraw.Draw(img)
    
    # 添加半透明红色背景
    overlay = Image.new('RGBA', img.size, (255, 0, 0, 0))
    overlay_draw = ImageDraw.Draw(overlay)
    
    # 在右下角绘制红色三角形背景
    triangle_size = int(width * 0.6)
    triangle = [
        (width, height),
        (width - triangle_size, height),
        (width, height - triangle_size)
    ]
    overlay_draw.polygon(triangle, fill=(220, 20, 60, 200))  # Crimson red with transparency
    
    # 合成图层
    img = Image.alpha_composite(img, overlay)
    draw = ImageDraw.Draw(img)
    
    # 添加 "DEV" 文字
    # 根据图标大小选择合适的字体大小
    font_size = max(6, int(width * 0.25))
    
    try:
        # 尝试使用系统字体
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_size)
    except (OSError, IOError):
        try:
            # Windows 字体路径
            font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", font_size)
        except (OSError, IOError):
            try:
                # macOS 字体路径
                font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", font_size)
            except (OSError, IOError):
                # 如果找不到字体，使用默认字体
                font = ImageFont.load_default()
                print(f"警告: 无法加载系统字体，使用默认字体")
    
    # 绘制文字
    text = "DEV"
    
    # 使用 textbbox 获取文本边界框
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    
    # 计算文字位置（右下角）
    x = width - text_width - 2
    y = height - text_height - 2
    
    # 绘制白色文字
    draw.text((x, y), text, fill=(255, 255, 255, 255), font=font)
    
    # 保存图标
    img.save(dest_path)
    print(f"✓ 创建: {os.path.relpath(dest_path, project_root)}")

def main():
    """主函数"""
    print("=" * 60)
    print("Chrome 扩展开发版本图标生成器")
    print("=" * 60)
    print()
    
    # 检查源目录是否存在
    if not os.path.exists(src_dir):
        print(f"错误: 源目录不存在: {src_dir}")
        sys.exit(1)
    
    # 创建目标目录
    os.makedirs(dest_dir, exist_ok=True)
    print(f"目标目录: {os.path.relpath(dest_dir, project_root)}")
    print()
    
    # 处理每个图标
    success_count = 0
    for icon_name in icons:
        src_path = os.path.join(src_dir, icon_name)
        dest_path = os.path.join(dest_dir, icon_name)
        
        if not os.path.exists(src_path):
            print(f"⚠ 跳过: {icon_name} (文件不存在)")
            continue
        
        try:
            create_dev_icon(src_path, dest_path)
            success_count += 1
        except Exception as e:
            print(f"✗ 错误: {icon_name} - {str(e)}")
    
    print()
    print("=" * 60)
    print(f"完成! 成功生成 {success_count}/{len(icons)} 个开发版本图标")
    print("=" * 60)

if __name__ == '__main__':
    main()
