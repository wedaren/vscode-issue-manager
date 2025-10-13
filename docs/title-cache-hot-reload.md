# 标题缓存与热更新

本扩展使用 `titleCache.json` 提供问题标题的快速映射，避免在视图渲染阶段频繁读取 Markdown 文件头信息，显著提升性能。

## 文件位置

- 路径：`<issueDir>/.issueManager/titleCache.json`
- 结构：`{ "相对路径(含扩展名)": "标题" }`

示例：

```json
{
  "area/project-a/task-1.md": "实现任务1",
  "resources/ref-xyz.md": "参考资料 XYZ"
}
```

## 使用策略

- 视图渲染（PARA/Focused/Overview/Related/Recent/Structure 等）优先从缓存读取标题。
- 缓存未命中时，不触发 I/O，回退为文件名（不含扩展名）。
- 首次激活时会预加载缓存。

## 热更新

扩展会自动监听 `titleCache.json` 的变更/创建/删除：

- 发生变更后，自动重载缓存并刷新所有视图。
- 已做防抖处理，避免短时间内多次刷新导致抖动。
- 若缓存损坏（JSON 解析失败），会保留旧缓存并在输出日志中给出警告。

## 手动重载

如需手动触发重载，可在命令面板执行：

- “Issue Manager: 重载标题缓存” (命令ID: `issueManager.reloadTitleCache`)

## 常见问题

- 新增文件未即时显示正确标题？
  - 确认 `titleCache.json` 已写入对应条目；若未自动更新，尝试手动执行“重载标题缓存”。
- `titleCache.json` 被误删？
  - 扩展仍可运行，但标题可能回退为文件名；恢复或重建缓存后会自动热更新。
- 性能相关
  - 缓存加载在内存中完成，热更新采用防抖处理；视图刷新与原有“刷新所有视图”机制兼容。