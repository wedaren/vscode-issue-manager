**QuickPick 功能设计与实现原理

- **简要说明**: 本文档描述了在 Chrome 扩展 content script 中实现 `Cmd+Shift+P` 快捷命令面板（QuickPick）的整体架构、消息流、UI 实现要点、样式隔离策略、键盘交互、以及与 background / side panel 的集成细节。

**总体架构**
- **触发点**: 在 content script（入口文件 [entrypoints/content/index.ts](entrypoints/content/index.ts)）全局监听 `keydown`（`Cmd+Shift+P`）并调用 QuickPick 展示逻辑。
- **UI 实现**: QuickPick UI 纯 DOM 实现，代码位于 [features/selection/ui/quickpick.ts](features/selection/ui/quickpick.ts)。不依赖框架，直接创建 overlay、panel、input 与列表节点。
- **消息与交互**: QuickPick 的 command 回调通过 `chrome.runtime.sendMessage` 与 background 或 side panel 通信（如创建笔记、导出、显示 toast 等）。background 负责与 VSCode WebSocket 交互以及调用 Chrome API（如 captureVisibleTab）。

**关键文件**
- content script 主入口: [entrypoints/content/index.ts](entrypoints/content/index.ts)
- quickpick UI: [entrypoints/content/features/selection/ui/quickpick.ts](entrypoints/content/features/selection/ui/quickpick.ts)
- 样式: [entrypoints/content/style.css](entrypoints/content/style.css)
- background 消息处理: [entrypoints/background.ts](entrypoints/background.ts)
- 侧边面板 toast: [components/SidePanel.vue](components/SidePanel.vue)

**实现要点（UI 与样式隔离）**
- **样式隔离策略**: 为避免宿主页面样式影响，关键元素使用 `all: initial` / 内联样式并明确设置 `font-family`，同时在创建时注入内联样式（如背景、颜色、padding、box-shadow、z-index）。样式位于 `style.css`，并在 runtime 用内联样式做二次保障。
- **定位策略**: 面板使用 overlay + 相对面板（panel） + 绝对定位列表（list）的组合：`panel` 为 `position: relative`，`list` 为 `position: absolute; top: inputHeight`。这样能避免页面布局/overflow 将下拉项遮挡。
- **z-index 与可视保障**: 列表强制设置高 z-index（如 10000003），并用内联颜色保证在深色或浅色页面都可见。

**功能与消息流**
- **创建笔记**: QuickPick 触发 `CONTENT_SELECTED` 消息到 background，background 将数据通过 WebSocket 或 fallback vscode:// URI 发送给 VSCode。（见 background 的 `handleContentSelected`）
- **显示 Toast**: content script 发 `SHOW_TOAST` 给 background，background 再调用 `notifySidePanel` 转发到侧边面板，侧边面板调用本地 `showMessage` 显示消息。
- **导出页面/截图**:
  - HTML 导出：在 content 端生成 Blob -> 创建 ObjectURL -> 触发下载。
  - PNG 截图：content 发 `CAPTURE_VISIBLE_TAB` 给 background，background 使用 `chrome.tabs.captureVisibleTab` 并把 dataUrl 返回给 content，content 下载该 dataUrl。（注意：需 manifest 权限）
  - PDF：触发 `window.print()`，用户在打印对话中选择 “保存为 PDF”。

**键盘交互与体验**
- 支持键位：`ArrowUp`/`ArrowDown`、`Enter`（确认）、`Escape`（取消）。
- 增强快捷键：已添加 `Ctrl+N` / `Ctrl+P` 用于下一项/上一项（可按需扩展支持 `Meta+N/P`）。
- 搜索过滤：输入框触发 filter，通过 label + description 的文本匹配并限制最大返回数（如前 50 项）。

**已知实现细节与修复记录**
- 顺序细节：`createPanel()` 内部会调用 `removePanel()` 清理旧状态，最初 `showQuickPick` 直接先赋值 `optionsCache` 再 `createPanel()` 会导致选项被清空。已修复为先 `createPanel()` 再填充 `optionsCache`。
- 宿主页面覆盖：若宿主页面使用强规则（例如将所有 DIV display:none 或全局 font-color 等），若遇到不可见问题，QuickPick 在创建时会注入内联样式保证可见性，并会打印调试信息到控制台用于快速定位。

**权限与 Manifest 注意**
- 若要使用 `chrome.tabs.captureVisibleTab`，manifest 需声明 `"tabs"` 权限并在 manifest 导航里允许相应 host。请确保 `manifest.json`（或 manifest v3 的对应配置）包含必要权限，否则截图会失败并报错。

**测试与验证步骤**
- 在任一页面按 `Cmd+Shift+P` 验证 QuickPick 弹出。
- 输入过滤关键字，验证条目数量变化与高亮。
- 使用 `Enter` 执行并检查：
  - `从页面创建笔记`：侧边 panel 显示创建中/成功消息并检查 VSCode 侧是否收到（WebSocket）或 fallback URI 打开。
  - `导出为图片 (PNG 截图)`：检查是否触发下载（需 manifest 权限）。
  - `以 PDF 打印页面`：是否弹出打印对话。

**限制与后续改进建议**
- **完整页面长图**: 目前使用 `captureVisibleTab` 仅截取可见区域。若需整页长截图，需使用滚动拼接或第三方库（html2canvas + 分块渲染），实现复杂度较高。
- **无交互 PDF 导出**: 当前依赖用户在打印对话选择保存为 PDF。可引入 headless 或 html2pdf 库生成静默 PDF（会增加体积和依赖）。
- **命令可配置化**: 建议把 quickpick 命令列表提取到单独配置文件，支持运行时扩展/插件或用户自定义命令。
- **无障碍支持**: 目前为简单键盘交互，后续可增加 ARIA 属性以提升可访问性。

**结语**
- 本设计以最小依赖、最大兼容为目标，保证在多数网站上弹出命令面板并执行常见操作（创建笔记、导出、截屏）。样式隔离与内联样式是解决宿主页面干扰的关键手段；消息总线（content → background → side panel/VSC）保持职责分离。

如需我把该文档移到仓库根目录的 `docs/` 并在 README 中添加链接，我可继续处理。