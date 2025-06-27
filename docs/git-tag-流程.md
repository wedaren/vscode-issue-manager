# Git 打 tag 并推送到远程的标准流程（推荐方式）

## 自动化推荐：结合 GitHub Actions 自动打 tag 与发布

> 推荐：已配置 GitHub Actions 工作流，main 分支的 package.json 版本号发生变化时，会自动检测并打上对应 tag（如 v0.0.4），随后自动发布扩展，无需手动打 tag。
>
> 只需正常提交并合并 main 分支，版本号变更后自动完成全部流程。
>
> 如需手动流程，请参考下文。

---

## 推荐：用 npm version 保证 tag 与 package.json 版本号一致

1. 查看当前版本号（可选）：

   ```sh
   cat package.json | grep '"version"'
   ```

2. 使用 npm version 自动升级版本（如 patch/minor/major），并生成 tag：

   ```sh
   npm version patch   # 或 minor/major
   ```
   - 自动修改 package.json 的 version 字段
   - 生成对应的 commit
   - 打上同名 tag（如 v0.0.4）

3. 推送 commit 和 tag 到远程：

   ```sh
   git push && git push --tags
   ```

> 建议：始终用 npm version 管理版本号和 tag，避免手动不一致。如需自定义 tag 名称，可用 `npm version 0.0.4`。

---

## 常用 tag 语义
- vX.Y.Z
  - X：主版本，重大变更/重构
  - Y：新功能
  - Z：修复/小改动

## 其他建议
- 打 tag 前确保本地 commit 已推送到远程。
- tag message 可用 `npm version patch -m "说明"` 或 `git tag -a v0.0.3 -m "说明"`。
- 推送后可在 GitHub Releases 页面补充说明。

---

本流程可直接复制粘贴到命令行使用。
