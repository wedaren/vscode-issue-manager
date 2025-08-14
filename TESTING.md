# Git 同步功能测试说明

## 安装测试依赖

运行测试前需要安装 sinon 依赖：

```bash
npm install --save-dev sinon @types/sinon
```

## 运行测试

```bash
# 编译测试
npm run compile-tests

# 运行所有测试
npm test

# 或者只运行特定测试
npm run compile-tests && ./node_modules/.bin/mocha out/test/GitSyncService.unit.test.js
```

## 测试文件说明

- `GitSyncService.unit.test.ts` - 单元测试，测试 GitSyncService 的各个功能
- `GitSyncService.test.ts` - 集成测试，需要真实的 Git 仓库环境
- `TestHelper.ts` - 测试辅助工具，提供模拟功能

## 测试覆盖的功能

1. **基础功能测试**：
   - 单例模式验证
   - 时间格式化功能
   - Git 仓库检测

2. **配置测试**：
   - 默认配置值验证
   - 自定义配置值测试
   - 配置变更处理

3. **状态管理测试**：
   - 状态栏更新
   - 同步状态切换
   - 资源清理

4. **错误处理测试**：
   - 无效目录处理
   - 空配置处理
   - Git 操作错误处理

## 注意事项

- 测试使用临时目录，不会影响实际项目
- 模拟了 VS Code 环境，无需真实的 VS Code 实例
- 集成测试需要 Git 环境，请确保系统已安装 Git
