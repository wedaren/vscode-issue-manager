---
mode: 'agent'
---

// 目标：审查暂存区的代码变更，提供反馈，并生成符合规范的 commit message。

// 步骤 1: 显示暂存区变更
@terminal 执行 `git --no-pager diff --staged -w` 命令并直接使用其输出。

// 步骤 2: 代码审查与反馈
请基于以下几点，对暂存区的代码变更进行审查：
1.  **主要变更总结**：简述本次变更的核心内容。
2.  **潜在问题**：指出可能的bug、逻辑不严谨之处、或不符合最佳实践的地方。
3.  **改进建议**：提出可以使代码更好的建议（可选）。
4.  **代码规范**：检查是否符合项目编码规范。

// 步骤 3: 生成 Commit Message
请根据步骤 2 的审查结果和暂存区的代码变更，遵循 Conventional Commits 规范，为这些变更生成一个合适的 commit message。
Commit Message 结构应如下：

<type>(<scope>): <subject>

[可选的空行]

[详细描述本次变更的核心内容和目的。这部分内容可以基于步骤 2.1 的主要变更总结，但应更加充实和书面化，作为 commit message 主体的一部分。]

[可选的“主要变更包括：”列表，用点操作符（-）开始，详细列出具体的代码文件和修改点。]
- 例如: 在 `src/chatViewProvider.ts` 中新增 `parseChatHistory` 方法，负责解析从 .chatlog.md 文件读取的字符串历史记录。
- 例如: 修改 `media/chat.js` 以处理新的 `loadParsedHistory` 消息...

[可选的“这样做的好处是：”或“解决的问题：”部分，用点操作符（-）开始，说明本次变更带来的益处或修复的问题。]
- 例如: 简化了前端逻辑，使其更专注于 UI 渲染和用户交互。
- 例如: 提高了代码的可维护性和可扩展性。

// 步骤 4: 提供 Commit 命令
// 重要提示：当需要执行 git commit 命令时，为了确保 commit message (特别是包含单引号 ' 或其他特殊shell字符时) 能够被 shell 正确解析并传递给 git，请严格遵循以下步骤：
//
// 1. 生成原始 Commit Message：
//    首先，根据代码变更和 Conventional Commits 规范，生成一个标准的 commit message 字符串。
//    我们称此字符串为 “原始 commit message”。
//
// 2. 处理原始 Commit Message 以适应 Shell：
//    接下来，需要对“原始 commit message”进行转换，以生成一个“处理后的 commit message”，使其能安全地嵌入到单引号包裹的 shell 命令中。
//    转换规则：将“原始 commit message”中的每一个单引号字符 (') 替换为序列 `'\''` (这四个字符依次是：单引号，反斜杠，单引号，单引号)。
//
//    例如：
//    如果“原始 commit message”是: `feat(user): add 'admin' role`
//    经过处理后，它将变成: `feat(user): add '\''admin'\'' role`
//
//    另一个例子：
//    如果“原始 commit message”是: `fix: resolve issue with it's parsing`
//    经过处理后，它将变成: `fix: resolve issue with it'\''s parsing`
//
//    再一个例子 (包含反引号)：
//    如果“原始 commit message”是: `docs: update README with \`important\` notice`
//    经过处理后，它将变成: `docs: update README with \`important\` notice` (因为反引号在单引号内不需要特殊处理，所以不变)
//    但如果原始消息是: `feat: it's a new feature with \`code\``
//    处理后是: `feat: it'\''s a new feature with \`code\``
//
// 3. 构建并执行 Commit 命令：
//    使用“处理后的 commit message”构建最终的 `git commit` 命令。命令的格式应为：
//    `git commit -m '此处放入处理后的 commit message'`
//
//    承接上面的例子，最终生成的命令会是：
//    对于第一个例子: `git commit -m 'feat(user): add '\''admin'\'' role'`
//    对于第二个例子: `git commit -m 'fix: resolve issue with it'\''s parsing'`
//    对于包含反引号的例子: `git commit -m 'feat: it'\''s a new feature with \`code\``
//
// 请确保 @terminal 执行的命令严格遵循此格式，将“处理后的 commit message”准确地放在单引号之间。
@terminal 执行 `git commit -m '此处放入处理后的 commit message'` 命令

