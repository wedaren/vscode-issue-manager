// Global type declarations for Chrome extension

// WXT provides 'browser' globally, and Chrome extensions use 'chrome'
// This declares 'chrome' as an alias to 'browser' for type checking
declare const chrome: typeof browser;

// 环境变量类型定义
// WXT/Vite 会在编译时注入环境变量
// 通过 wxt.config.ts 中的 envPrefix 配置，支持多种前缀
interface ImportMetaEnv {
  // WebSocket 配置
  readonly WS_PORT?: string;
  readonly WS_HOST?: string;
  readonly WS_PORT_RANGE_START?: string;
  readonly WS_PORT_RANGE_END?: string;
  readonly WS_MAX_RETRIES?: string;
  readonly WS_RETRY_DELAY?: string;
  
  // 功能开关
  readonly ENABLE_PORT_DISCOVERY?: string;
  
  // 其他配置
  readonly PORT_DISCOVERY_TIMEOUT?: string;
  readonly LOG_LEVEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
