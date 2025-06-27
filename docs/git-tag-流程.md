# Git 打 tag 并推送到远程的标准流程

1. 查看当前最新 tag（可选，便于确定新版本号）：

   ```sh
   git describe --tags --abbrev=0
   ```

2. 按需确定新 tag 号（如 bugfix 则第三位 +1，feature 则第二位 +1，主版本则第一位 +1）。

3. 打上新 tag（如 v0.0.3）：

   ```sh
   git tag v0.0.3
   ```

4. 推送 tag 到远程仓库：

   ```sh
   git push origin v0.0.3
   ```

5. （可选）推送所有本地 tag：

   ```sh
   git push --tags
   ```

---

## 常用 tag 语义
- vX.Y.Z
  - X：主版本，重大变更/重构
  - Y：新功能
  - Z：修复/小改动

## 建议
- 打 tag 前确保本地 commit 已推送到远程。
- tag message 可用 `git tag -a v0.0.3 -m "说明"` 方式添加。
- 推送后可在 GitHub Releases 页面补充说明。

---

本流程可直接复制粘贴到命令行使用。
