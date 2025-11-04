import { defineConfig } from 'wxt';
import vue from '@vitejs/plugin-vue';
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'chrome-extension-wxt',
  publicDir: 'chrome-extension-wxt/public',
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
});
