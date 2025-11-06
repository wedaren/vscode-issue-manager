# VSCode 扩展 .env 文件加载修复

## 问题

之前的实现使用 `vscode.workspace.workspaceFolders` 获取路径，这会导致读取**用户工作区**的 `.env` 文件，而不是**扩展目录**的 `.env` 文件。

```
错误的路径：/Users/wedaren/repositoryDestinationOfGithub/issue-notes/.env
正确的路径：/Users/wedaren/repositoryDestinationOfGithub/vscode-issue-manager/.env
```

## 解决方案

### 1. 使用 ExtensionContext.extensionPath

在 `SharedConfig` 中添加静态方法 `initialize()` 来接收扩展上下文：

```typescript
export class SharedConfig {
  private static extensionContext: vscode.ExtensionContext | null = null;

  public static initialize(context: vscode.ExtensionContext): void {
    SharedConfig.extensionContext = context;
  }
  
  private constructor() {
    if (SharedConfig.extensionContext) {
      // 使用扩展的安装路径
      extensionEnvPath = path.join(
        SharedConfig.extensionContext.extensionPath, 
        '.env'
      );
    }
  }
}
```

### 2. 在扩展激活时初始化

在 `extension.ts` 的 `activate()` 函数中：

```typescript
export function activate(context: vscode.ExtensionContext) {
  // 必须在其他服务之前初始化
  SharedConfig.initialize(context);
  
  // ... 其他初始化代码
}
```

### 3. 配置加载优先级

1. **环境变量** - process.env（最高优先级）
2. **扩展根目录的 .env** - 主要配置源（开发和生产环境都使用）
3. **VSCode 设置** - 通过 settings.json 配置（支持全局和工作区级别）
4. **默认值** - 代码中的默认配置

**注意**：不支持工作区 `.env` 文件。如果用户需要在不同工作区使用不同配置，应该通过 VSCode 的工作区设置（`.vscode/settings.json`）来实现。

## 开发模式兼容性

代码还包含了开发模式的兼容逻辑：

```typescript
// 如果没有扩展上下文（测试环境），向上查找 .env
let currentDir = __dirname;
for (let i = 0; i < 3; i++) {
  currentDir = path.join(currentDir, '..');
  const testPath = path.join(currentDir, '.env');
  if (fs.existsSync(testPath)) {
    extensionEnvPath = testPath;
    break;
  }
}
```

这样在开发时（从 `out/` 或 `dist/` 目录运行）也能正确找到 `.env` 文件。

## 文件位置

- 开发时：`vscode-issue-manager/.env`
- 发布后：扩展安装目录下的 `.env`（通过 extensionContext.extensionPath 获取）

## 为什么直接使用 .env 而不是 .env.example？

### 传统做法（.env.example）
- 适用于开源项目，用户需要复制并填写
- `.env` 包含敏感信息，被 gitignore
- `.env.example` 提供配置模板

### 我们的做法（.env）
- ✅ **配置不敏感** - 只包含端口、主机等非敏感配置
- ✅ **扩展自带** - 配置随扩展一起发布
- ✅ **即用即可** - 用户无需手动创建配置
- ✅ **有默认值** - 即使没有 .env 也能正常工作

因此，`.env` 文件被提交到仓库，作为扩展的默认配置。

## 验证

重启 VSCode 后，应该看到正确的日志：

**✅ 正确**：
```
[SharedConfig] 已加载 .env 文件: /Users/wedaren/repositoryDestinationOfGithub/vscode-issue-manager/.env
```

**❌ 之前的错误**：
```
[SharedConfig] 已加载工作区 .env 文件: /Users/wedaren/repositoryDestinationOfGithub/issue-notes/.env
```

## 如何覆盖配置？

### 全局覆盖
在 VSCode 的全局设置中（`settings.json`）：

```json
{
  "issueManager.chromeIntegration.port": 37895,
  "issueManager.chromeIntegration.host": "localhost"
}
```

### 工作区级别覆盖
在工作区设置中（`.vscode/settings.json`）：

```json
{
  "issueManager.chromeIntegration.port": 37900,
  "issueManager.chromeIntegration.enablePortDiscovery": false
}
```

这样可以在不同工作区使用不同的配置，而不会造成混淆。
