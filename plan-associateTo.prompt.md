Plan: 新增“附属到/关联到”功能

概述：在现有“移动到”功能旁新增“附属到”（推荐中文名称：`关联到`）命令，行为与“移动到”相同但不移除原引用。实现通过复用 `moveTo` 流程，改为在目标处插入被克隆的新节点（为克隆节点生成新 id），保持原节点不变。下面为可执行步骤草案供审阅。

步骤
1. 新增命令注册（`package.json`）
   - 新增命令 id：`issueManager.attachTo` 与 `issueManager.attachToFromEditor`（或基于命名约定使用 `attachTo`/`associateTo`）。
   - 命令标题示例：`关联到...`。

2. 新增命令实现（`src/commands/attachTo.ts`）
   - 以 `src/commands/moveTo.ts` 为模版复制实现流程。
   - 主要变更：移除对 `removeNode` 的调用；将被选中的树节点做深拷贝并为每个克隆节点生成新的唯一 `id`（实现 `cloneNodeWithNewIds(node)`），再把克隆后的节点插入目标位置。
   - 对来自编辑器/文件的 `vscode.TreeItem` 保持原有转换逻辑（`convertTreeItemToTreeNode`），因为其已生成新 id，可直接插入。
   - 保留循环引用检测与排除逻辑，但针对克隆逻辑调整排除条件以避免把祖先克隆到其子孙下形成循环。
   - 保持 `writeTree(tree)`、刷新视图与用户提示（提示文案改为“已在目标处关联 X 项”）。

3. 命令注册与调用点（`src/core/CommandRegistry.ts` 或现有命令注册模块）
   - 在命令注册处按 `moveTo` 的方式注册新命令并绑定到 `attachTo` 实现。
   - 在 `package.json` 的 `contributes.commands` 中添加对应条目（同步标题与类别）。
   - 如需在树的右键菜单或编辑器上下文菜单暴露该命令，需在 `contributes.menus` 中加入相应配置。

4. 树工具支持：克隆与 id 管理（`src/data/issueTreeManager.ts` 或同级工具）
   - 新增或导出 `cloneNodeWithNewIds(node: IssueTreeNode): IssueTreeNode`，递归克隆子节点并为每个节点生成 `uuidv4()` 新 id，同时保留 `filePath`、`resourceUri` 等必要字段。
   - 确保任何基于节点 id 的缓存或映射在克隆操作后不会误用原 id（必要时更新 map 或在提示中说明）。

5. 拖放支持（可选）
   - 如需通过拖放实现“附属到”，在 `src/views/*DragAndDropController.ts` 的 `handleDrop` 中增加分支（例如检测 modifier key 或不同的鼠标按钮），并在该分支调用克隆插入逻辑而非移动逻辑。
   - 明确与现有拖放“移动”行为的区分，避免用户混淆（UI 提示/tooltip）。

6. 测试、文档与提示文案
   - 新增测试文件 `src/test/attachTo.test.ts`，覆盖以下用例：
     - 对树中节点执行“关联到”后，原节点仍存在且目标处出现新节点；
     - 克隆节点 id 与原节点 id 不相同；
     - 克隆包含子树时子结构保持一致；
     - 循环引用检测能阻止非法操作。
   - 更新 docs（`docs/`）与 CHANGELOG，说明“关联到”与“移动到”行为差异。
   - 更新用户提示文案，例如 `已在 ${target} 处关联 ${count} 个问题`。

命名建议（优先级）
1. 关联到：简短、语义清晰，强调建立关联而非移除原位置（推荐）。
2. 引用到：明确表示建立引用关系，适合文件仍然唯一但在树中多处出现的场景。
3. 链接到：用户友好，强调链接关系。
4. 附加到：表示在目标处附加一项，语义平行于“移动到”。
5. 挂载到：较技术化，适合进阶用户界面。
6. 同时添加到：口语化但冗长，可用作说明文本。

风险与兼容性注意点
- ID 与引用一致性：克隆节点时必须为所有克隆节点生成新的唯一 id，避免与现有 id 冲突，并检查 focused/缓存/映射不被误用。
- 逻辑假设冲突：部分代码可能假定同一 `filePath` 仅在树中出现一次，新增多处引用可能影响删除、聚合统计、或某些管理器逻辑，需要做回归检查（focusedManager、paraManager、搜索/定位、删除流程）。
- UI/交互混淆：拖放与右键菜单需明确区分“移动”与“关联”行为，避免误操作。

预估工作量与时间
- 难度：中等。
- 预估时间：约 4–8 小时（实现 + 单元测试 + 文案与回归检查）。

下一步（可选）
- 我可以生成针对 `src/commands/moveTo.ts` 的 patch 草案：新增 `src/commands/attachTo.ts` 的完整实现骨架与 `cloneNodeWithNewIds` 的实现示例，并更新 `package.json` 命令列表与命令注册点；或
- 仅生成 `cloneNodeWithNewIds` 的伪代码与单元测试用例草稿。

说明：该文档已写入仓库根目录文件 `plan-associateTo.prompt.md`，用于后续细化与提交补丁。