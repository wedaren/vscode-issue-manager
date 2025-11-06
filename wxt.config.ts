import { defineConfig } from 'wxt';
import vue from '@vitejs/plugin-vue';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'chrome-extension-wxt',
  publicDir: 'chrome-extension-wxt/public',
  outDir: '.output',
  manifest: ({ mode }) => {
    // 根据构建模式选择不同的图标路径
    const isDev = mode === 'development';
    const iconPrefix = isDev ? 'dev/' : '';
    
    return {
      name: 'Issue Manager - 网页笔记选取器',
      version: '1.0.0',
      description: '从网页选取内容并在 VSCode Issue Manager 中创建笔记',
      permissions: ['activeTab', 'tabs', 'sidePanel', 'scripting', 'storage'],
      host_permissions: ['http://*/*', 'https://*/*'],
      action: {
        default_title: '打开笔记选取器',
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
  },
  vite: () => ({
    plugins: [vue()],
    // 允许非 VITE_ 前缀的环境变量被注入
    // 这样可以避免在 .env 文件中重复配置
    envPrefix: ['VITE_', 'WS_', 'ENABLE_', 'PORT_', 'LOG_', 'CHROME_'],
  }),
});
