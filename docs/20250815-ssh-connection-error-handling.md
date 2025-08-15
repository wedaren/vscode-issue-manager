# SSH连接错误处理改进

## 问题背景
用户报告了一个SSH连接错误，无法连接到GitHub：
```
GitError: ssh: connect to host github.com port 22: Undefined error: 0
致命错误：无法读取远程仓库。
请确认您有正确的访问权限并且仓库存在。
```

## 错误分析
这是一个典型的SSH连接失败错误，可能的原因包括：
1. **网络问题**：无法访问GitHub的22端口
2. **防火墙限制**：公司或本地防火墙阻止SSH连接
3. **SSH配置问题**：SSH密钥配置不正确
4. **代理设置**：网络代理影响SSH连接

## 解决方案

### 1. 增强错误识别
在`handleSyncError`方法中添加了专门的SSH错误检测：

```typescript
// 检查SSH连接错误
if (errorMessage.includes('ssh: connect to host') || 
    errorMessage.includes('undefined error: 0') ||
    errorMessage.includes('无法读取远程仓库') ||
    errorMessage.includes('could not read from remote repository') ||
    (errorMessage.includes('ssh') && (errorMessage.includes('port 22') || errorMessage.includes('github.com')))) {
    this.currentStatus = { 
        status: SyncStatus.Conflict, 
        message: `SSH连接错误: 无法连接到GitHub，请检查网络和SSH配置` 
    };
    return;
}
```

### 2. 错误模式匹配
支持识别以下SSH错误模式：
- `ssh: connect to host` - SSH连接失败
- `undefined error: 0` - Windows特有的SSH错误
- `无法读取远程仓库` - 中文错误消息
- `could not read from remote repository` - 英文错误消息
- 包含`ssh`、`port 22`和`github.com`的组合

### 3. 用户友好的错误提示
- 明确指出这是SSH连接问题
- 建议用户检查网络和SSH配置
- 避免显示复杂的技术错误信息

### 4. 连接测试辅助方法
添加了`testGitConnectivity`方法：

```typescript
private async testGitConnectivity(cwd: string): Promise<boolean> {
    try {
        const git = this.getGit(cwd);
        await git.listRemote(['--heads', 'origin']);
        return true;
    } catch (error) {
        console.log('Git connectivity test failed:', error);
        return false;
    }
}
```

## 用户建议

当遇到SSH连接错误时，用户可以尝试：

1. **检查网络连接**：确保可以访问GitHub
2. **测试SSH连接**：运行 `ssh -T git@github.com`
3. **检查SSH密钥**：确保SSH密钥已添加到GitHub账户
4. **尝试HTTPS替代**：将远程URL改为HTTPS格式
5. **检查防火墙设置**：确保22端口未被阻止
6. **配置代理**：如果使用代理，配置Git的代理设置

## 改进效果

- ✅ **准确识别**：能够准确识别SSH连接失败
- ✅ **友好提示**：提供清晰的错误说明和建议
- ✅ **多语言支持**：支持中英文错误消息
- ✅ **调试支持**：添加连接测试方法便于诊断

## 测试验证
- 模拟SSH连接失败场景
- 验证错误消息的准确识别
- 确认状态栏显示正确的错误状态
- 测试错误处理的优先级
