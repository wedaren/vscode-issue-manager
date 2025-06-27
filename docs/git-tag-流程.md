# npm version 与 Git tag 标准流程详解

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

- `patch`（/pætʃ/）：修复/小改动（如 v1.2.3 → v1.2.4）
- `minor`（/ˈmaɪnər/）：新功能（如 v1.2.3 → v1.3.0）
- `major`（/ˈmeɪdʒər/）：主版本，重大变更/重构（如 v1.2.3 → v2.0.0）

## 其他建议
- 打 tag 前确保本地 commit 已推送到远程。
- tag message 可用 `npm version patch -m "说明"` 或 `git tag -a v0.0.3 -m "说明"`。
- 推送后可在 GitHub Releases 页面补充说明。

---

## npm version 的原理与推荐流程

`npm version xxx` 实际会自动完成以下操作：

1. 修改 `package.json`（和 `package-lock.json`，如有）中的 `version` 字段为指定版本号（如 `0.0.4`）。
2. 生成一个新的 commit，commit message 形如 `v0.0.4`。
3. 在本地仓库自动打上同名 Git tag（如 `v0.0.4`），tag message 与 commit message 一致。
4. 如果用 `npm version patch/minor/major`，会自动递增对应的版本号。

这样可以保证 Git tag 与 `package.json` 版本号始终一致，避免手动操作带来的不一致问题。

**推荐标准流程：**

1. 使用 `npm version patch`（或 `minor`/`major`/具体版本号），自动完成版本号递增、commit 和 tag。
2. 推送 commit 和 tag 到远程仓库：

   ```sh
   git push && git push --tags
   ```

配合 GitHub Actions，可实现自动检测 tag 并发布扩展，无需手动打 tag。

---

本流程可直接复制粘贴到命令行使用。
