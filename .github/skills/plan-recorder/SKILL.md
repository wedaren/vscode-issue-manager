---
name: plan-recorder
description: 将任意重构或实施计划写入仓库文档，供团队参考与复用。触发时请打开或引用 `references/PLAN.md`。
---

# Plan Recorder

此 Skill 用于将任意重构、设计或实施计划以文档形式保存在仓库中，便于审阅、讨论与后续实现。

When to use this skill:
- 当需要把技术或项目计划记录为可审阅、可追溯的仓库文档时。

Resources:
- `references/PLAN.md` — 包含可编辑的计划模板与示例内容。

Usage:
- 打开 `references/PLAN.md`，将计划替换或另存为项目中的文档，存放到仓库的 `/Users/wedaren/repositoryDestinationOfGithub/issue-notes` 目录，用于 PR 描述或任务拆分。

Script helper:
- 有一个小工具用于将本模板写入目标目录或文件路径：

	```bash
	node .github/skills/plan-recorder/scripts/create_plan.js [--out <path>]
	```

	- 默认会写入目录 `/Users/wedaren/repositoryDestinationOfGithub/issue-notes`，并使用时间戳命名规则生成文件名 `YYYYMMDD-HHmmss-SSS.md`，例如 `20260119-153012-123.md`。
	- 也可以传入目标路径（目录或具体文件名）：

	```bash
	node .github/skills/plan-recorder/scripts/create_plan.js --out /absolute/path/to/dir
	node .github/skills/plan-recorder/scripts/create_plan.js docs/my-feature-plan.md
	```