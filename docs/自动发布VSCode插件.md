# 自动发布 VS Code 插件

本文档旨在指导你如何使用 GitHub Actions 自动化 VS Code 插件的发布流程。通过自动化，你可以确保每次发布都遵循一致的步骤，减少手动错误，并提高发布效率。

## 1. 概述

自动发布是指当满足特定条件（例如，推送一个新的 Git Tag）时，通过预定义的自动化流程（如 CI/CD 流水线）自动完成插件的构建、测试、打包和发布到 VS Code Marketplace 的过程。

**优点：**
*   **提高效率**: 减少手动操作，节省时间。
*   **减少错误**: 自动化流程减少人为错误的可能性。
*   **一致性**: 确保每次发布都遵循相同的步骤和标准。
*   **持续集成/部署**: 更好地融入 CI/CD 工作流。

## 2. 准备工作

在设置自动化发布之前，你需要完成以下准备工作：

### 2.1 创建 Azure DevOps Personal Access Token (PAT)

VS Code Marketplace 使用 Azure DevOps 作为其发布平台。你需要创建一个 Personal Access Token (PAT) 来授权 GitHub Actions 发布你的插件。
https://dev.azure.com/wedaren/
1.  访问 [Azure DevOps](https://dev.azure.com/wedaren/) 并登录你的账户。
2.  点击右上角的用户设置图标，选择 "Personal access tokens"。
3.  点击 "New Token"。
4.  填写以下信息：
    *   **Name**: 为你的 Token 命名，例如 `VSCodeExtensionPublisher`。
    *   **Organization**: 选择 "All accessible organizations"。
    *   **Scopes**: 选择 "Custom defined"。
    *   在 "Marketplace" 下，勾选 "Acquire" 和 "Publish" 权限。
    *   设置过期时间（建议设置为一年或更长，以便长期使用）。
5.  点击 "Create"。
6.  **重要**: 复制生成的 PAT。这个 Token 只会显示一次，请务必妥善保存。你将在后续步骤中将其添加到 GitHub Secrets。

### 2.2 在 VS Code Marketplace 上创建发布者

如果你还没有发布者，你需要先在 VS Code Marketplace 上创建一个。

1.  访问 [VS Code Marketplace Publisher Management](https://marketplace.visualstudio.com/manage/publishers)。
2.  点击 "Create new publisher"。
3.  填写所需信息并创建你的发布者。
4.  记住你的发布者 ID，它通常是你的组织或个人名称。

### 2.3 配置 `package.json`

确保你的 `package.json` 文件中包含以下关键信息：

*   `name`: 插件的名称。
*   `displayName`: 插件在 Marketplace 上显示的名称。
*   `description`: 插件的描述。
*   `version`: 插件的版本号。
*   `publisher`: 你在 Marketplace 上创建的发布者 ID。

示例：

```json
{
  "name": "issue-manager",
  "displayName": "Issue Manager",
  "description": "A VS Code extension for managing issues.",
  "version": "0.0.1",
  "publisher": "your-publisher-id", // 替换为你的发布者 ID
  "engines": {
    "vscode": "^1.80.0"
  },
  "categories": [
    "Other"
  ],
  "activationEvents": [
    "onStartupFinished"
  ],
  "main": "./out/extension.js",
  "contributes": {
    // ... 你的贡献点
  },
  "scripts": {
    "vscode:prepublish": "npm run compile",
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./",
    "pretest": "npm run compile && npm run lint",
    "lint": "eslint src --ext ts",
    "test": "vscode-test"
  },
  "devDependencies": {
    "@types/vscode": "^1.80.0",
    "@types/mocha": "^10.0.6",
    "@types/node": "18.x",
    "@typescript-eslint/eslint-plugin": "^7.11.0",
    "@typescript-eslint/parser": "^7.11.0",
    "eslint": "^8.57.0",
    "typescript": "^5.4.5",
    "@vscode/test-cli": "^0.0.9",
    "@vscode/test-electron": "^2.4.0"
  }
}
```

## 3. GitHub Actions 配置

现在，我们将创建 GitHub Actions 工作流文件。

### 3.1 创建工作流文件

在你的项目根目录下创建 `.github/workflows/release.yml` 文件：

```
.
├── .github/
│   └── workflows/
│       └── release.yml  <-- 在这里创建
└── ...
```

### 3.2 编写 `release.yml`

将以下内容复制到 `release.yml` 文件中。这个工作流会在你推送一个新的 Git Tag 时触发。

```yaml
name: Publish VS Code Extension

on:
  push:
    tags:
      - 'v*' # 当有新的以 'v' 开头的 Tag 被推送到仓库时触发

jobs:
  publish:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18' # 根据你的项目需求选择 Node.js 版本

      - name: Install dependencies
        run: npm install

      - name: Run tests
        run: npm test # 确保你的测试通过

      - name: Package extension
        run: npm install -g vsce && vsce package

      - name: Publish extension
        run: vsce publish -p ${{ secrets.VSCE_TOKEN }}
        env:
          VSCE_TOKEN: ${{ secrets.VSCE_TOKEN }} # 从 GitHub Secrets 中获取 Token
```

## 4. 环境变量配置

为了安全地存储你的 Azure DevOps PAT，你需要将其添加到 GitHub Secrets。

1.  在你的 GitHub 仓库中，导航到 "Settings" -> "Secrets and variables" -> "Actions"。
2.  点击 "New repository secret"。
3.  **Name**: 输入 `VSCE_TOKEN` (这个名称必须与 `release.yml` 中使用的名称一致)。
4.  **Secret**: 粘贴你在步骤 2.1 中复制的 Azure DevOps PAT。
5.  点击 "Add secret"。

## 5. 触发发布

一旦你完成了上述配置，你就可以通过推送一个新的 Git Tag 来触发自动发布。

1.  **更新 `package.json` 中的版本号**: 在发布之前，请确保你已经更新了 `package.json` 文件中的 `version` 字段。
2.  **创建 Git Tag**:
    ```bash
    git add .
    git commit -m "Release vX.Y.Z"
    git tag vX.Y.Z # 这里的 vX.Y.Z 应该与 package.json 中的版本号一致，并以 'v' 开头
    ```
3.  **推送 Tag 到 GitHub**:
    ```bash
    git push origin vX.Y.Z
    ```

推送 Tag 后，GitHub Actions 将会自动运行 `publish` 工作流，并在成功后将你的插件发布到 VS Code Marketplace。

你可以在 GitHub 仓库的 "Actions" 选项卡中查看工作流的执行状态和日志。
