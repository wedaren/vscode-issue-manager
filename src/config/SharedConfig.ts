/**
 * 共享配置管理器
 * 
 * 用于读取和管理 VSCode 插件与 Chrome 扩展之间的共享配置
 * 支持从以下来源读取配置（优先级从高到低）：
 * 1. 环境变量（process.env）
 * 2. 扩展目录的 .env 文件（通过 dotenv 读取）
 * 3. VSCode 设置（settings.json，支持全局和工作区级别）
 * 4. 默认值
 * 
 * 注意：不支持工作区 .env 文件，用户应通过 VSCode 设置来覆盖配置
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { config as loadEnv } from 'dotenv';
import { Logger } from '../core/utils/Logger';

export interface WebSocketConfig {
  /** WebSocket 服务端口 */
  port: number;
  /** WebSocket 服务主机 */
  host: string;
  /** 完整的 WebSocket URL */
  url: string;
  /** 端口范围（用于自动发现）*/
  portRange: { start: number; end: number };
  /** 是否启用端口自动发现 */
  enablePortDiscovery: boolean;
  /** 端口发现超时时间（毫秒）*/
  portDiscoveryTimeout: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 重试延迟（毫秒）*/
  retryDelay: number;
}

export interface SharedConfigData {
  websocket: WebSocketConfig;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * 共享配置管理器
 */
export class SharedConfig {
  private static instance: SharedConfig | null = null;
  private config: SharedConfigData | null = null;
  private envFilePath: string;
  private static extensionContext: vscode.ExtensionContext | null = null;
  private logger = Logger.getInstance();

  private constructor() {
    // 查找扩展根目录的 .env 文件
    // 注意：不支持工作区 .env 文件，避免混淆
    // 用户应该通过 VSCode 设置（settings.json）来覆盖配置
    
    let extensionEnvPath = '';
    
    // 如果有扩展上下文，使用扩展路径
    if (SharedConfig.extensionContext) {
      extensionEnvPath = path.join(SharedConfig.extensionContext.extensionPath, '.env');
    } else {
      // 开发模式：__dirname 可能指向 out/ 或 dist/ 目录
      // 尝试向上查找 .env 文件
      let currentDir = __dirname;
      for (let i = 0; i < 3; i++) {
        currentDir = path.join(currentDir, '..');
        const testPath = path.join(currentDir, '.env');
        if (fs.existsSync(testPath)) {
          extensionEnvPath = testPath;
          break;
        }
      }
    }
    
    // 加载扩展目录的 .env 文件
    if (extensionEnvPath && fs.existsSync(extensionEnvPath)) {
      this.envFilePath = extensionEnvPath;
      loadEnv({ path: extensionEnvPath });
      this.logger.info('[SharedConfig] 已加载 .env 文件:', extensionEnvPath);
    } else {
      this.envFilePath = '';
      this.logger.info('[SharedConfig] 未找到 .env 文件，使用默认配置');
    }
  }

  /**
   * 初始化扩展上下文（应该在扩展激活时调用一次）
   */
  public static initialize(context: vscode.ExtensionContext): void {
    SharedConfig.extensionContext = context;
  }

  public static getInstance(): SharedConfig {
    if (!SharedConfig.instance) {
      SharedConfig.instance = new SharedConfig();
    }
    return SharedConfig.instance;
  }

  /**
   * 加载配置
   */
  public load(): SharedConfigData {
    if (this.config) {
      return this.config;
    }

    // 获取 VSCode 配置
    const vscodeConfig = vscode.workspace.getConfiguration('issueManager');

    // 构建配置对象（process.env 已经包含了 .env 文件的内容）
    this.config = this.buildConfig(vscodeConfig);

    return this.config;
  }

  /**
   * 重新加载配置
   */
  public reload(): SharedConfigData {
    this.config = null;
    return this.load();
  }

  /**
   * 获取 WebSocket 配置
   */
  public getWebSocketConfig(): WebSocketConfig {
    const config = this.load();
    return config.websocket;
  }

  /**
   * 导出配置到 JSON 文件（供 Chrome 扩展读取）
   */
  public async exportForChrome(outputPath: string): Promise<void> {
    const config = this.load();
    const chromeConfig = {
      websocket: {
        url: config.websocket.url,
        port: config.websocket.port,
        host: config.websocket.host,
        portRange: config.websocket.portRange,
        enablePortDiscovery: config.websocket.enablePortDiscovery,
        portDiscoveryTimeout: config.websocket.portDiscoveryTimeout,
        maxRetries: config.websocket.maxRetries,
        retryDelay: config.websocket.retryDelay
      },
      timestamp: new Date().toISOString()
    };

    await fs.promises.writeFile(
      outputPath,
      JSON.stringify(chromeConfig, null, 2),
      'utf-8'
    );
  }

  /**
   * 构建配置对象
   * dotenv 已经将 .env 文件的内容加载到 process.env 中
   */
  private buildConfig(
    vscodeConfig: vscode.WorkspaceConfiguration
  ): SharedConfigData {
    // 读取端口配置（优先级：环境变量 > VSCode 配置 > 默认值）
    // dotenv 已经将 .env 文件加载到 process.env 中
    const port = this.getConfigValue<number>(
      'WS_PORT',
      vscodeConfig,
      'chromeIntegration.port',
      37892,
      (v) => parseInt(v)
    );

    const host = this.getConfigValue<string>(
      'WS_HOST',
      vscodeConfig,
      'chromeIntegration.host',
      'localhost'
    );

    const url = this.getConfigValue<string>(
      'WS_URL',
      vscodeConfig,
      'chromeIntegration.url',
      `ws://${host}:${port}/ws`
    );

    // 解析端口范围
    const portRangeStart = this.getConfigValue<number>(
      'WS_PORT_RANGE_START',
      vscodeConfig,
      'chromeIntegration.portRangeStart',
      37892,
      (v) => parseInt(v)
    );

    const portRangeEnd = this.getConfigValue<number>(
      'WS_PORT_RANGE_END',
      vscodeConfig,
      'chromeIntegration.portRangeEnd',
      37899,
      (v) => parseInt(v)
    );

    const portRange = {
      start: portRangeStart,
      end: portRangeEnd
    };

    const enablePortDiscovery = this.getConfigValue<boolean>(
      'ENABLE_PORT_DISCOVERY',
      vscodeConfig,
      'chromeIntegration.enablePortDiscovery',
      true,
      (v: any) => v === 'true' || v === true
    );

    const portDiscoveryTimeout = this.getConfigValue<number>(
      'PORT_DISCOVERY_TIMEOUT',
      vscodeConfig,
      'chromeIntegration.portDiscoveryTimeout',
      1000,
      (v) => parseInt(v)
    );

    const maxRetries = this.getConfigValue<number>(
      'WS_MAX_RETRIES',
      vscodeConfig,
      'chromeIntegration.maxRetries',
      3,
      (v) => parseInt(v)
    );

    const retryDelay = this.getConfigValue<number>(
      'WS_RETRY_DELAY',
      vscodeConfig,
      'chromeIntegration.retryDelay',
      1000,
      (v) => parseInt(v)
    );

    const logLevel = this.getConfigValue<string>(
      'LOG_LEVEL',
      vscodeConfig,
      'chromeIntegration.logLevel',
      'info'
    ) as 'debug' | 'info' | 'warn' | 'error';

    return {
      websocket: {
        port,
        host,
        url,
        portRange,
        enablePortDiscovery,
        portDiscoveryTimeout,
        maxRetries,
        retryDelay
      },
      logLevel
    };
  }

  /**
   * 获取配置值（支持多种来源）
   * 优先级：环境变量（含扩展 .env）> VSCode 设置 > 默认值
   */
  private getConfigValue<T>(
    envKey: string,
    vscodeConfig: vscode.WorkspaceConfiguration,
    vscodeKey: string,
    defaultValue: T,
    transformer?: (value: any) => T
  ): T {
    // 1. 优先使用环境变量（dotenv 已经加载到 process.env）
    if (process.env[envKey]) {
      const value = process.env[envKey]!;
      return transformer ? transformer(value) : (value as unknown as T);
    }

    // 2. 使用 VSCode 配置
    const vscodeValue = vscodeConfig.get<T>(vscodeKey);
    if (vscodeValue !== undefined) {
      return vscodeValue;
    }

    // 3. 使用默认值
    return defaultValue;
  }

}
