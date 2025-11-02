import { defineConfig } from 'wxt';
import vue from '@vitejs/plugin-vue';
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'chrome-extension-wxt',
  outDir: '.output',
  manifest: {
    name: 'Issue Manager - 网页笔记选取器',
    version: '1.0.0',
    description: '从网页选取内容并在 VSCode Issue Manager 中创建笔记',
    permissions: ['activeTab', 'tabs', 'sidePanel', 'scripting', 'storage'],
    host_permissions: ['http://*/*', 'https://*/*'],
    action: {
      default_title: '打开笔记选取器',
      default_icon: {
        '16': 'icon-16.png',
        '32': 'icon.png',
        '48': 'icon-48.png',
      },
    },
    icons: {
      '16': 'icon-16.png',
      '32': 'icon.png',
      '48': 'icon-48.png',
      '128': 'icon-128.png',
    },
  },
  vite: () => ({
    plugins: [vue()],
  }),
  hooks: {
    'build:done': (wxt, output) => {
      // 复制图标文件到构建输出目录
      const iconFiles = ['icon.png', 'icon-16.png', 'icon-48.png', 'icon-128.png'];
      const publicDir = resolve('chrome-extension-wxt', 'public');
      
      // 获取输出目录 - output.outDir 包含完整路径
      let outDir: string;
      if (output && 'outDir' in output && output.outDir) {
        outDir = output.outDir;
      } else {
        // 回退到手动构建路径
        const suffix = wxt.config.mode === 'development' ? '-dev' : '';
        outDir = resolve('.output', `chrome-mv3${suffix}`);
      }
      
      // 确保输出目录存在
      if (!existsSync(outDir)) {
        mkdirSync(outDir, { recursive: true });
      }
      
      iconFiles.forEach(filename => {
        try {
          const src = resolve(publicDir, filename);
          const dest = resolve(outDir, filename);
          
          // 确保目标目录存在
          const destDir = dirname(dest);
          if (!existsSync(destDir)) {
            mkdirSync(destDir, { recursive: true });
          }
          
          copyFileSync(src, dest);
          console.log(`[icon] Copied ${filename} to ${outDir}`);
        } catch (err) {
          console.warn(`[icon] Failed to copy ${filename}:`, err instanceof Error ? err.message : String(err));
        }
      });
    },
  },
});
