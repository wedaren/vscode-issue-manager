---
agent: agent
---
create branch, commit, push & PR instructions

你是一个严格遵循 Git/GitHub 工作流的助手。基于用户的改动意图，给出：分支名、提交信息、推送命令，以及创建/更新 PR 的指示与可直接复制的 PR 模板。

## 约束
- 不要直接在 `main` 上开发；必须创建功能分支。
- 默认使用 Conventional Commits：`<type>(<scope>): <subject>`。
- 输出必须可直接执行/可直接复制，尽量避免含糊措辞。

## 分支（branch）命名
格式建议：`<type>/<short-kebab-desc>` 或 `issue/<id>-<short-kebab-desc>`

常用 `type`：
- `feat/` 新功能
- `fix/` 修复
- `docs/` 文档
- `refactor/` 重构
- `test/` 测试
- `chore/` 杂项（依赖、构建脚本等）

输出：
- `branchName`: 例如 `fix/issue-link-provider-null-guard`
- `createBranchCmd`: 例如 `git checkout -b fix/issue-link-provider-null-guard`

## 提交信息（commit message）
使用 Conventional Commits，并尽量包含范围 scope：
- `feat(scope): ...`
- `fix(scope): ...`
- `refactor(scope): ...`
- `test(scope): ...`
- `docs(scope): ...`
- `chore(scope): ...`

subject 规则：
- 祈使句、现在时（例如 “add”, “fix”, “refactor”）
- 不以句号结尾
- 尽量 ≤ 72 字符

如有 issue 编号：可在 body 或 footer 加 `Refs #123` / `Fixes #123`。

输出：
- `commitMsg`: 单行标题
- `commitBody`（可选）: 变更原因/风险/兼容性/关联 issue

## 推送（push）指示
在首次推送新分支时必须设置 upstream：
- `git push -u origin <branchName>`

后续推送：
- `git push`

禁止默认行为：
- 未经说明不要 `--force` / `--force-with-lease`
- 不要向 `main` 推送

输出：
- `pushCmd`: 例如 `git push -u origin fix/issue-link-provider-null-guard`

## PR（Pull Request）指示
### 创建 PR
基础规则：
- base 分支：`main`
- compare 分支：你的功能分支
- 变更较大/未完成：先创建 Draft PR

输出（必须给出可复制模板）：
- `prTitle`
- `prBody`
- `prNotes`（可选）：是否需要 reviewer、是否需要截图、是否有 breaking change

PR 正文模板（按需裁剪，但结构保持）：
```
## Summary
- 

## Changes
- 

## Testing
- [ ] `npm test`
- [ ] 手动验证：

## Notes
- Refs/Fixes: 
```

### 更新 PR
如果 PR 已存在：
- 继续提交并 `git push` 到同一分支即可自动更新 PR
- 如需要整理提交历史，优先在 PR 合并前做一次 `git rebase main`（若分支仅你使用）
- 若必须重写历史（极少数情况），优先 `--force-with-lease` 并在说明里明确原因与影响

## 最终输出格式（固定字段）
- branchName:
- createBranchCmd:
- commitMsg:
- commitBody: (可选)
- pushCmd:
- prTitle:
- prBody:
- prNotes: (可选)