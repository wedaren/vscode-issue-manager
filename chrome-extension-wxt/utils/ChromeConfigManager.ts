/**
 * Chrome 扩展配置管理器
 * 
 * 从多个来源读取配置（优先级从高到低）：
 * 1. Chrome Storage API（运行时保存的配置）
 * 2. 环境变量（.env 文件，通过 WXT/Vite 注入）
 * 3. 默认配置
 */

interface WebSocketConfig {
  url: string;
  port: number;
  host: string;
  portRange: { start: number; end: number };
  enablePortDiscovery: boolean;
  portDiscoveryTimeout: number;
  maxRetries: number;
  retryDelay: number;
}

interface ChromeConfig {
  websocket: WebSocketConfig;
  timestamp?: string;
}

/**
 * Chrome 扩展配置管理器
 */
export class ChromeConfigManager {
  private static instance: ChromeConfigManager | null = null;
  private config: ChromeConfig | null = null;
  private readonly STORAGE_KEY = 'issueManager.config';

  private constructor() {}

  public static getInstance(): ChromeConfigManager {
    if (!ChromeConfigManager.instance) {
      ChromeConfigManager.instance = new ChromeConfigManager();
    }
    return ChromeConfigManager.instance;
  }

  /**
   * 从环境变量读取配置
   * WXT 通过 Vite 注入环境变量
   * 通过 wxt.config.ts 中的 envPrefix 配置，支持 WS_、ENABLE_ 等前缀
   */
  private getEnvConfig(): Partial<WebSocketConfig> {
    // 直接使用 import.meta.env，在 WXT 构建环境中始终可用
    const env = import.meta.env;
    
    const port = env.WS_PORT ? parseInt(env.WS_PORT) : undefined;
    const host = env.WS_HOST as string | undefined;
    const portRangeStart = env.WS_PORT_RANGE_START ? parseInt(env.WS_PORT_RANGE_START) : undefined;
    const portRangeEnd = env.WS_PORT_RANGE_END ? parseInt(env.WS_PORT_RANGE_END) : undefined;
    const enablePortDiscovery = env.ENABLE_PORT_DISCOVERY === 'true';
    const portDiscoveryTimeout = env.PORT_DISCOVERY_TIMEOUT ? parseInt(env.PORT_DISCOVERY_TIMEOUT) : undefined;
    const maxRetries = env.WS_MAX_RETRIES ? parseInt(env.WS_MAX_RETRIES) : undefined;
    const retryDelay = env.WS_RETRY_DELAY ? parseInt(env.WS_RETRY_DELAY) : undefined;

    const config: Partial<WebSocketConfig> = {};
    
    if (port !== undefined) {
      config.port = port;
      if (host) {
        config.url = `ws://${host}:${port}/ws`;
      }
    }
    if (host !== undefined) {
      config.host = host;
    }
    if (portRangeStart !== undefined && portRangeEnd !== undefined) {
      config.portRange = { start: portRangeStart, end: portRangeEnd };
    }
    if (enablePortDiscovery !== undefined) {
      config.enablePortDiscovery = enablePortDiscovery;
    }
    if (portDiscoveryTimeout !== undefined) {
      config.portDiscoveryTimeout = portDiscoveryTimeout;
    }
    if (maxRetries !== undefined) {
      config.maxRetries = maxRetries;
    }
    if (retryDelay !== undefined) {
      config.retryDelay = retryDelay;
    }

    return config;
  }

  /**
   * 加载配置
   * 优先级：Chrome Storage > 环境变量 > 默认配置
   */
  public async load(): Promise<ChromeConfig> {
    if (this.config) {
      return this.config;
    }

    // 1. 尝试从 Chrome Storage 读取
    const storageConfig = await this.loadFromStorage();
    if (storageConfig) {
      console.log('[Config] 使用 Chrome Storage 配置');
      this.config = storageConfig;
      return this.config;
    }

    // 2. 尝试从环境变量读取
    const envConfig = this.getEnvConfig();
    if (Object.keys(envConfig).length > 0) {
      console.log('[Config] 使用环境变量配置:', envConfig);
      const defaultConfig = this.getDefaultConfig();
      this.config = {
        websocket: {
          ...defaultConfig.websocket,
          ...envConfig
        }
      };
      return this.config;
    }

    // 3. 使用默认配置
    console.log('[Config] 使用默认配置');
    this.config = this.getDefaultConfig();
    return this.config;
  }

  /**
   * 获取 WebSocket 配置
   */
  public async getWebSocketConfig(): Promise<WebSocketConfig> {
    const config = await this.load();
    return config.websocket;
  }

  /**
   * 保存配置到 Chrome Storage
   */
  public async save(config: Partial<ChromeConfig>): Promise<void> {
    const currentConfig = await this.load();
    const newConfig = {
      ...currentConfig,
      ...config,
      websocket: {
        ...currentConfig.websocket,
        ...(config.websocket || {})
      },
      timestamp: new Date().toISOString()
    };

    await chrome.storage.sync.set({
      [this.STORAGE_KEY]: newConfig
    });

    this.config = newConfig;
  }

  /**
   * 端口自动发现
   * 
   * 尝试连接端口范围内的 VSCode 实例
   */
  public async discoverPort(): Promise<number | null> {
    const config = await this.load();
    const { portRange, portDiscoveryTimeout } = config.websocket;

    console.log(`[Config] 开始端口发现: ${portRange.start}-${portRange.end}`);

    for (let port = portRange.start; port <= portRange.end; port++) {
      try {
        const available = await this.testPort(port, portDiscoveryTimeout);
        if (available) {
          console.log(`[Config] 发现可用端口: ${port}`);
          // 更新配置
          await this.save({
            websocket: {
              ...config.websocket,
              port,
              url: `ws://${config.websocket.host}:${port}/ws`
            }
          });
          return port;
        }
      } catch (error) {
        console.debug(`[Config] 端口 ${port} 不可用:`, error);
      }
    }

    console.warn('[Config] 未找到可用端口');
    return null;
  }

  /**
   * 测试端口是否可用
   */
  private testPort(port: number, timeout: number): Promise<boolean> {
    return new Promise((resolve) => {
      const url = `ws://localhost:${port}/ws`;
      let ws: WebSocket | null = null;
      let timer: number | null = null;

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
        }
        if (ws) {
          ws.close();
        }
      };

      timer = setTimeout(() => {
        cleanup();
        resolve(false);
      }, timeout) as unknown as number;

      try {
        ws = new WebSocket(url);

        ws.onopen = () => {
          cleanup();
          resolve(true);
        };

        ws.onerror = () => {
          cleanup();
          resolve(false);
        };
      } catch (error) {
        cleanup();
        resolve(false);
      }
    });
  }

  /**
   * 从 Chrome Storage 加载配置
   */
  private async loadFromStorage(): Promise<ChromeConfig | null> {
    try {
      const result = await chrome.storage.sync.get(this.STORAGE_KEY);
      if (result[this.STORAGE_KEY]) {
        return result[this.STORAGE_KEY] as ChromeConfig;
      }
    } catch (error) {
      console.error('[Config] 从 Storage 加载配置失败:', error);
    }
    return null;
  }

  /**
   * 获取默认配置
   */
  private getDefaultConfig(): ChromeConfig {
    return {
      websocket: {
        url: 'ws://localhost:37892/ws',
        port: 37892,
        host: 'localhost',
        portRange: { start: 37892, end: 37899 },
        enablePortDiscovery: true,
        portDiscoveryTimeout: 1000,
        maxRetries: 3,
        retryDelay: 1000
      }
    };
  }

  /**
   * 重置为默认配置
   */
  public async reset(): Promise<void> {
    await chrome.storage.sync.remove(this.STORAGE_KEY);
    this.config = null;
  }
}
