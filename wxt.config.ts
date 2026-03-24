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
      permissions: ['activeTab', 'tabs', 'tabGroups', 'sidePanel', 'scripting', 'storage'],
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
  // 使用正常 Chrome 的用户配置文件（保留书签、登录状态等）
  webExt: {
    chromiumProfile: `${process.env.HOME}/Library/Application Support/Google/Chrome/DevProfile`,
    keepProfileChanges: true,
    startUrls: ['https://www.google.com'],
    // ⚠️ disable-blink-features=AutomationControlled: 移除自动化检测标记，使 Google 登录不被拦截
    // 风险：部分网站的反爬/反自动化检测会失效，仅用于开发环境，勿用于生产或自动化测试
    chromiumArgs: ['--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-blink-features=AutomationControlled'],
  },
  vite: () => ({
    plugins: [vue()],
    // 允许非 VITE_ 前缀的环境变量被注入
    // 这样可以避免在 .env 文件中重复配置
    envPrefix: ['VITE_', 'WS_', 'ENABLE_', 'PORT_', 'LOG_', 'CHROME_'],
  }),
});
