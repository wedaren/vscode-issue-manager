# 使用 envPrefix 避免重复配置

## 问题

之前的方案需要在 `.env` 文件中重复配置：

```env
# VSCode 使用
VSCODE_WS_PORT=37892

# Chrome 使用（需要 VITE_ 前缀）
VITE_VSCODE_WS_PORT=37892
```

这样存在问题：
- ❌ 配置重复，容易不一致
- ❌ 维护成本高
- ❌ VSCODE_ 前缀语义不清晰（实际上两边都在用）

## 解决方案：使用 Vite 的 envPrefix

### 核心原理

Vite 允许通过 `envPrefix` 配置来指定哪些前缀的环境变量可以被注入到客户端代码中。

默认情况下，只有 `VITE_` 前缀的变量会被注入。通过配置 `envPrefix`，我们可以添加更多前缀。

### 实现步骤

#### 1. 修改 wxt.config.ts

```typescript
import { defineConfig } from 'wxt';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  srcDir: 'chrome-extension-wxt',
  vite: () => ({
    plugins: [vue()],
    // 允许非 VITE_ 前缀的环境变量被注入
    // 这样可以避免在 .env 文件中重复配置
    envPrefix: ['VITE_', 'WS_', 'ENABLE_', 'PORT_', 'LOG_', 'CHROME_'],
  }),
});
```

#### 2. 简化 .env 文件

```env
# Issue Manager 共享配置文件
# VSCode 插件和 Chrome 扩展使用相同的变量名

# ============================================
# WebSocket 服务配置
# ============================================

# WebSocket 服务端口
WS_PORT=37892

# WebSocket 服务主机
WS_HOST=localhost

# 端口范围（用于自动发现）
WS_PORT_RANGE_START=37892
WS_PORT_RANGE_END=37899

# ============================================
# 功能开关
# ============================================

# 是否启用端口自动发现
ENABLE_PORT_DISCOVERY=true

# 端口发现超时时间（毫秒）
PORT_DISCOVERY_TIMEOUT=1000

# ============================================
# 连接与重试配置
# ============================================

# WebSocket 连接最大重试次数
WS_MAX_RETRIES=3

# 重试延迟（毫秒）
WS_RETRY_DELAY=1000

# ============================================
# 日志配置
# ============================================

# 日志级别 (debug, info, warn, error)
LOG_LEVEL=info
```

#### 3. 更新 VSCode 插件代码

在 `src/config/SharedConfig.ts` 中：

```typescript
// 使用新的变量名（去掉 VSCODE_ 前缀）
const port = this.getConfigValue<number>(
  'WS_PORT',  // 不再是 VSCODE_WS_PORT
  vscodeConfig,
  'chromeIntegration.port',
  37892,
  (v) => parseInt(v)
);
```

#### 4. 更新 Chrome 扩展代码

在 `chrome-extension-wxt/utils/ChromeConfigManager.ts` 中：

```typescript
private getEnvConfig(): Partial<WebSocketConfig> {
  const env = import.meta.env;
  
  // 直接使用 WS_ 前缀，不需要 VITE_ 前缀
  const port = env.WS_PORT ? parseInt(env.WS_PORT) : undefined;
  const host = env.WS_HOST as string | undefined;
  const enablePortDiscovery = env.ENABLE_PORT_DISCOVERY === 'true';
  // ...
}
```

#### 5. 更新 TypeScript 类型定义

在 `chrome-extension-wxt/globals.d.ts` 中：

```typescript
// 环境变量类型定义
interface ImportMetaEnv {
  // WebSocket 配置（不再需要 VITE_ 前缀）
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
```

## 变量命名规范

### 为什么去掉 VSCODE_ 前缀？

1. **语义更清晰** - 这些配置是两边共享的，不只是 VSCode 使用
2. **更简洁** - `WS_PORT` 比 `VSCODE_WS_PORT` 更简短直观
3. **避免误导** - Chrome 扩展也在使用，`VSCODE_` 前缀容易造成误解

### 新的命名规范

使用语义化的前缀：

| 前缀 | 用途 | 示例 |
|------|------|------|
| `WS_*` | WebSocket 相关配置 | `WS_PORT`, `WS_HOST`, `WS_MAX_RETRIES` |
| `ENABLE_*` | 功能开关 | `ENABLE_PORT_DISCOVERY`, `ENABLE_DEBUG` |
| `PORT_*` | 端口相关（非 WebSocket） | `PORT_DISCOVERY_TIMEOUT` |
| `LOG_*` | 日志相关 | `LOG_LEVEL`, `LOG_FILE` |
| `CHROME_*` | Chrome 扩展特定配置 | `CHROME_SYNC_INTERVAL` |

## 优势

### ✅ 配置简洁

- 不再需要重复配置
- 每个变量只写一次
- 易于维护和更新

### ✅ 语义清晰

- 使用通用的语义化前缀
- 前缀直接表达变量的用途
- 不会造成"这是谁的配置"的困惑

### ✅ 类型安全

- TypeScript 完整支持
- 编译时检查
- IDE 自动补全

### ✅ Vite 原生支持

- 不需要额外的构建脚本
- 不需要预处理步骤
- 利用 Vite 内置能力

## 工作原理

### VSCode 插件端

```
.env 文件
    ↓
dotenv 包加载
    ↓
process.env.WS_PORT
    ↓
SharedConfig.getConfigValue()
    ↓
使用配置
```

### Chrome 扩展端

```
.env 文件
    ↓
Vite 构建时读取
    ↓
envPrefix 过滤（WS_、ENABLE_ 等）
    ↓
注入到 import.meta.env
    ↓
ChromeConfigManager.getEnvConfig()
    ↓
使用配置
```

## 使用流程

### 开发环境

1. 复制配置模板：
   ```bash
   cp .env.example .env
   ```

2. 修改配置值：
   ```env
   WS_PORT=37892
   WS_HOST=localhost
   ```

3. 重启服务：
   - **VSCode**: `Cmd+R` (Reload Window)
   - **Chrome**: `npm run chrome:dev`

### 配置优先级

#### VSCode 插件

1. 环境变量（`process.env`，含 `.env` 文件）
2. VSCode 设置（`settings.json`）
3. 默认值

#### Chrome 扩展

1. Chrome Storage（运行时保存）
2. 环境变量（`import.meta.env`，构建时注入）
3. 默认值

## 技术细节

### envPrefix 的工作机制

当 Vite 构建时：

1. 读取 `.env` 文件
2. 检查每个环境变量的前缀
3. 如果前缀匹配 `envPrefix` 数组中的任何一个，则注入到 `import.meta.env`
4. 其他变量不会被注入（安全考虑）

### 为什么保留 VITE_ 前缀？

虽然我们添加了其他前缀，但仍保留 `VITE_` 在 `envPrefix` 中：

```typescript
envPrefix: ['VITE_', 'WS_', 'ENABLE_', 'PORT_', 'LOG_', 'CHROME_']
```

原因：
1. **兼容性** - 某些第三方库可能使用 `VITE_` 前缀
2. **Vite 生态** - 遵循 Vite 社区约定
3. **灵活性** - 如果需要 Chrome 特定的配置，仍可使用 `VITE_` 前缀

### 安全性

Vite 的 `envPrefix` 机制是**安全的**：

- ✅ 只有指定前缀的变量会被注入
- ✅ 敏感信息（如 API 密钥）不应该使用这些前缀
- ✅ 客户端代码中的环境变量是公开的，任何人都可以看到

因此，不要在这些变量中存储：
- ❌ API 密钥
- ❌ 密码
- ❌ 私钥
- ❌ 任何敏感信息

## 常见问题

### Q: 为什么不使用 JSON 配置文件？

A: JSON 文件需要额外的管理逻辑：
- Chrome 扩展需要在构建时复制文件
- 无法享受环境变量的便利性（如不同环境使用不同配置）
- `.env` 文件是行业标准，工具链支持更好

### Q: 可以动态修改配置吗？

A: 可以，但方式不同：
- **VSCode**: 通过 VSCode 设置或修改 `.env` 后重启
- **Chrome**: 通过 Chrome Storage API 运行时保存

### Q: 如果添加新的前缀需要做什么？

A: 两步：
1. 在 `wxt.config.ts` 的 `envPrefix` 数组中添加新前缀
2. 在 `chrome-extension-wxt/globals.d.ts` 中添加 TypeScript 类型

### Q: VSCode 和 Chrome 可以使用不同的值吗？

A: 可以通过配置优先级实现：
- VSCode: 在 VSCode 设置中覆盖
- Chrome: 在 Chrome Storage 中保存不同的值

## 总结

通过使用 Vite 的 `envPrefix` 配置：

1. ✅ **消除重复** - 一个变量一份配置
2. ✅ **语义清晰** - 使用通用的语义化前缀
3. ✅ **维护简单** - 修改一次，两边生效
4. ✅ **类型安全** - TypeScript 完整支持
5. ✅ **工具链友好** - 利用 Vite 内置能力，无需额外脚本

这是目前最简洁、最优雅的共享配置方案！
