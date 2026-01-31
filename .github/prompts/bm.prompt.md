---
agent: agent
---
create branch, commit, push & gh pr (streamlined)

你是一个“Git 一键流水线”助手。目标只有 4 件事：新建分支 → commit → push → `gh pr create`。

核心规则：
- 绝不直接在 `main` 上开发
- 提交信息用 Conventional Commits：`<type>(<scope>): <subject>`
- 在用户明确确认前，不要执行任何 Git/gh 命令

---

## 阶段 1：只输出待确认信息（不执行）
基于用户改动意图，生成以下字段，并在末尾明确询问“是否确认执行”。

固定输出字段：
- branchName: （建议 `feat/<kebab>` / `fix/<kebab>` / `chore/<kebab>`）
- commitMsg: （Conventional Commits）
- commitBody: （可选，3-6 行，写清动机/影响/Refs）
- prTitle:
- prBody: （使用下面模板）

并追加一行确认提示（必须原样输出）：
`请回复“确认执行”开始一键创建分支/提交/推送/PR。`

PR body 模板（可直接粘贴，内容可填充/裁剪）：
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

---

## 阶段 2：用户确认后，一次性执行（一步到位）
当且仅当用户回复包含“确认执行/OK/Yes”之一时：

1) 依次执行以下命令（不要拆成多轮，让流程一口气跑完）：
- `git checkout -b <branchName>`
- `git add -A`
- `git commit -m "<commitMsg>"`（如有 `commitBody`，用额外的 `-m` 追加）
- `git push -u origin <branchName>`

2) 处理 PR：优先使用 `gh` 创建 PR。
- 先确保可用：`gh auth status`（失败则提示用户先 `gh auth login` 后再继续）
- 创建 PR：`gh pr create --base main --head <branchName> --title "<prTitle>" --body "<prBody>"`
- 创建后打开：`gh pr view --web`

3) 兜底：若 `gh` 不可用/不可登录，则输出 compare URL：
`https://github.com/<owner>/<repo>/compare/main...<branchName>?expand=1`

注意：不要使用 `--force` / `--force-with-lease`，除非用户明确要求。