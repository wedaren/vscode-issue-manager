# GitHub Actions 自动发布流程说明

本仓库的 `.github/workflows/release.yml` 文件定义了自动发布 VS Code 扩展的流程，核心要点如下：

## 什么是 GitHub Actions Workflow？
- 它是 GitHub 提供的自动化工具，可以在代码推送、打 tag、发 PR 等事件发生时，自动执行一系列脚本。
- 工作流文件位于 `.github/workflows/` 目录下，格式为 YAML。

## 本工作流的触发条件
- 只有当你推送一个符合 `vX.Y.Z` 格式的 tag（如 `v0.0.4`）到 GitHub 时，才会自动触发。
- 推送 tag 的常用命令：
  ```sh
  git push --tags
  ```

## 主要步骤说明
1. 检出代码（拉取你的仓库源码）。
2. 设置 Node.js 环境（用于运行 npm/yarn 等工具）。
3. 安装依赖（`npm ci`）。
4. 全局安装 `vsce`（VS Code 扩展官方打包/发布工具）。
5. 用 `vsce publish` 命令自动发布扩展到 Marketplace。

## Token 配置
- 你需要在 GitHub 仓库的 Settings → Secrets → Actions 里添加名为 `VSCE_TOKEN` 的密钥。
- 该 token 可通过 `vsce login` 命令获取。

## 常见问题
- tag 没推送到远程不会触发。
- tag 格式不对不会触发。
- 没有配置 `VSCE_TOKEN` 会导致发布失败。

如需详细了解，可参考 [GitHub Actions 官方文档](https://docs.github.com/en/actions)。
