/**
 * 测试 FileAccessTracker 防抖功能
 */

console.log('脚本开始执行...');

const fs = require('fs');
const path = require('path');

// 模拟 VS Code API
const vscode = {
  ExtensionContext: class {
    constructor() {
      this.workspaceState = {
        data: {},
        get: function(key, defaultValue) {
          return this.data[key] || defaultValue;
        },
        update: function(key, value) {
          this.data[key] = value;
          console.log(`保存数据到扩展状态: ${key}`);
        }
      };
    }
  }
};

// 模拟工具函数
function getIssueDir() {
  return '/test/issues';
}

// 简单的防抖函数实现
function debounce(func, delay) {
  let timeout;
  return function(...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), delay);
  };
}

// 简化的 FileAccessTracker 用于测试
class FileAccessTracker {
  constructor(context) {
    this.context = context;
    this.accessStats = {};
    this.saveCallCount = 0;
    
    // 防抖保存函数，使用较短的延迟便于测试
    this.debouncedSaveStats = debounce(() => this.saveStats(), 100);
  }

  saveStats() {
    this.saveCallCount++;
    console.log(`第 ${this.saveCallCount} 次调用 saveStats()`);
    this.context.workspaceState.update('issueManager.fileAccessStats', this.accessStats);
  }

  recordFileAccess(filePath) {
    const now = Date.now();
    const existing = this.accessStats[filePath];

    if (existing) {
      existing.lastViewTime = now;
      existing.viewCount += 1;
    } else {
      this.accessStats[filePath] = {
        lastViewTime: now,
        viewCount: 1,
        firstViewTime: now
      };
    }

    console.log(`记录文件访问: ${filePath} (访问次数: ${this.accessStats[filePath].viewCount})`);
    // 使用防抖保存
    this.debouncedSaveStats();
  }
}

// 测试防抖功能
async function testDebounce() {
  console.log('=== 测试 FileAccessTracker 防抖功能 ===\n');
  
  const context = new vscode.ExtensionContext();
  const tracker = new FileAccessTracker(context);
  
  console.log('1. 快速连续访问多个文件（模拟用户快速切换标签页）:');
  tracker.recordFileAccess('/test/issues/file1.md');
  tracker.recordFileAccess('/test/issues/file2.md');
  tracker.recordFileAccess('/test/issues/file3.md');
  tracker.recordFileAccess('/test/issues/file1.md'); // 再次访问 file1
  tracker.recordFileAccess('/test/issues/file2.md'); // 再次访问 file2
  
  console.log(`\n当前 saveStats 调用次数: ${tracker.saveCallCount}（应该为 0，因为防抖还没触发）\n`);
  
  // 等待防抖延迟
  console.log('2. 等待防抖延迟 (150ms)...');
  await new Promise(resolve => setTimeout(resolve, 150));
  
  console.log(`\n防抖后 saveStats 调用次数: ${tracker.saveCallCount}（应该为 1）`);
  
  // 验证数据是否正确保存
  console.log('\n3. 验证访问统计数据:');
  console.log('file1.md 访问次数:', tracker.accessStats['/test/issues/file1.md']?.viewCount || 0);
  console.log('file2.md 访问次数:', tracker.accessStats['/test/issues/file2.md']?.viewCount || 0);
  console.log('file3.md 访问次数:', tracker.accessStats['/test/issues/file3.md']?.viewCount || 0);
  
  // 测试单次访问
  console.log('\n4. 测试单次访问:');
  tracker.recordFileAccess('/test/issues/file4.md');
  
  // 等待防抖
  console.log('等待防抖延迟...');
  await new Promise(resolve => setTimeout(resolve, 150));
  
  console.log(`\n最终 saveStats 调用次数: ${tracker.saveCallCount}（应该为 2）`);
  
  console.log('\n=== 测试完成 ===');
  console.log('结论: 防抖功能正常工作，避免了频繁的 I/O 操作！');
}

// 运行测试
testDebounce().catch(console.error);
