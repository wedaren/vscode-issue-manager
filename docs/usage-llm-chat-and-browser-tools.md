# 使用说明：LLM Chat 与浏览器交互工具

> 适用版本: 3.0.115+
>
> **⚠️ 注意**: 标签页管理工具（open_tab、list_tabs 等）和页面交互工具（get_page_elements、click_element、fill_input 等）已在后续迭代中移除。以下涉及浏览器操作的章节仅作历史参考。

## 1. 快速开始

### 1.1 前置条件

- VS Code 已安装 **GitHub Copilot** 扩展并登录
- Chrome 已安装 **Issue Manager** 扩展
- VS Code 扩展与 Chrome 扩展已通过 WebSocket 连接（侧面板显示绿色连接状态）

### 1.2 打开 LLM Chat

**在 Chrome 侧面板中:**
1. 点击 Chrome 工具栏的扩展图标，打开侧面板
2. 切换到「LLM Chat」标签页
3. 直接输入消息即可开始对话

**在 VS Code 中:**
1. 使用命令面板 `Cmd+Shift+P` → 搜索 `LLM Chat`
2. 或点击活动栏的 Chat 图标

## 2. 对话管理

### 2.1 多会话

- 点击 **+** 按钮创建新对话
- 点击历史记录图标查看所有对话
- 每个对话独立存储，互不干扰
- 对话记录持久化为 issueMarkdown 文件，支持 Git 同步

### 2.2 模型选择

- 点击顶部模型名称切换 Copilot 模型
- 支持 GPT-4.1、GPT-4o 等
- 模型选择会记忆到 localStorage

### 2.3 工具开关

- 输入框旁有工具图标开关（默认开启）
- 开启后 LLM 可使用所有浏览器交互和笔记管理工具
- 关闭后退化为纯文本对话

## 3. 浏览器交互功能

### 3.1 打开网页

```
用户: 打开微博
AI: [调用 open_tab] 已打开新标签页
    - ID: 123
    - 标题: 微博
    - URL: https://weibo.com
```

### 3.2 查看页面内容

```
用户: 看看当前打开的页面有什么内容
AI: [调用 list_tabs] 列出标签页
    [调用 get_tab_content] 读取页面内容
    页面主要内容是...
```

### 3.3 填写表单（登录、搜索、注册等）

```
用户: 帮我在这个页面登录，用户名 test@example.com，密码 123456
AI: [调用 get_page_elements] 获取表单结构
    找到: username 输入框、password 输入框、登录按钮
    [调用 fill_input] 填写用户名
    [调用 fill_input] 填写密码
    [调用 click_element] 点击登录按钮
    已完成登录操作
```

### 3.4 处理验证码

```
用户: 帮我填验证码，验证码是 A3X9
AI: [调用 get_page_elements] 查找验证码输入框
    [调用 fill_input] 填入 A3X9
    [调用 click_element] 点击提交
    验证码已提交
```

> 注意：LLM 无法自动识别图形验证码内容。你需要看到验证码后告诉 AI 具体的文字/数字。

### 3.5 操作下拉框

```
用户: 把语言选择改成中文
AI: [调用 get_page_elements] 查找下拉框
    [调用 select_option] 选择 "中文"
    已选择中文
```

### 3.6 模拟按键

```
用户: 在搜索框输入完后按回车搜索
AI: [调用 fill_input] 输入搜索词
    [调用 press_key] 按下 Enter
    搜索已触发
```

## 4. 笔记管理功能

### 4.1 创建研究笔记

```
用户: 把这个页面的内容整理成笔记
AI: [调用 get_tab_content] 读取页面
    [调用 create_issue_tree] 创建层级笔记
    已创建笔记树：
    - 主题概述
      - 要点一
      - 要点二
      - 要点三
```

### 4.2 搜索和更新笔记

```
用户: 搜索关于 AI Agent 的笔记，补充今天的发现
AI: [调用 search_issues] 检索 "AI Agent"
    [调用 read_issue] 读取找到的笔记
    [调用 update_issue] 追加新内容
    笔记已更新
```

## 5. Web Research Agent

### 5.1 使用方式

1. 在 Chrome 侧面板切换到「Web Agent」标签
2. 输入研究任务描述（如 "调研主流 AI Agent 框架的优缺点"）
3. Agent 会自主完成：搜索 → 抓取 → 分析 → 创建笔记 → 生成报告

### 5.2 与 LLM Chat 的区别

| 特性 | LLM Chat | Web Research Agent |
|------|----------|-------------------|
| 交互模式 | 多轮对话，用户引导 | 单次任务，自主执行 |
| 工具轮次 | 最多 10 轮 | 最多 15 轮 |
| 适用场景 | 即时问答、页面操作、表单填写 | 深度研究、资料整理、报告生成 |
| 进度反馈 | 流式文本 + 工具调用卡片 | 阶段性进度事件 |

## 6. 工具调用反馈 UI

当 LLM 调用工具时，聊天界面会显示紧凑的工具调用卡片：

- **紫色旋转图标** → 工具正在执行中
- **绿色对勾** → 工具执行成功
- **红色叹号** → 工具执行失败

点击已完成的工具卡片可展开查看执行结果详情。

## 7. 完整工具列表

### 标签页管理
| 工具 | 说明 |
|------|------|
| `open_tab` | 打开新标签页 |
| `get_tab_content` | 读取页面文本 |
| `activate_tab` | 切换标签页 |
| `list_tabs` | 列出所有标签 |
| `organize_tabs` | 分组整理标签 |
| `close_tabs` | 关闭标签 |

### 页面交互
| 工具 | 说明 |
|------|------|
| `get_page_elements` | 获取可交互元素（输入框、按钮等） |
| `click_element` | 点击元素 |
| `fill_input` | 填写输入框 |
| `select_option` | 选择下拉选项 |
| `press_key` | 模拟按键 |

### 搜索抓取
| 工具 | 说明 |
|------|------|
| `web_search` | 网络搜索 |
| `fetch_url` | 抓取网页内容 |

### 笔记管理
| 工具 | 说明 |
|------|------|
| `search_issues` | 搜索笔记 |
| `read_issue` | 读取笔记 |
| `create_issue` | 创建笔记 |
| `create_issue_tree` | 创建笔记树 |
| `list_issue_tree` | 查看笔记结构 |
| `update_issue` | 更新笔记 |

## 8. 常见问题

**Q: 工具调用没有反应？**
- 确认工具开关已开启（输入框旁的图标）
- 确认 Chrome 扩展与 VS Code 已连接
- 查看 VS Code 输出面板的日志（搜索 `[ChromeChat]`）

**Q: fill_input 在某些网站不生效？**
- 部分网站使用自定义组件（如 Shadow DOM），标准 DOM 操作可能无法触达
- 尝试使用 `press_key` 配合手动输入

**Q: 模型没有调用工具，只是文字回复？**
- 确认使用支持 tool-calling 的模型（推荐 GPT-4.1 或 GPT-4o）
- 系统提示词已引导模型使用工具，但某些模型可能需要更明确的指令
