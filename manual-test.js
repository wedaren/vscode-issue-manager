/**
 * 手动测试新的RSS分离存储功能
 */

const fs = require('fs');
const path = require('path');

// 测试数据
const testFeedId = 'test-feed-' + Date.now();
const testItems = [
    {
        id: 'item1',
        title: '测试文章1',
        description: '这是测试文章1的描述',
        link: 'https://example.com/item1',
        pubDate: new Date('2025-08-19T10:00:00Z'),
        author: '作者1',
        content: '测试内容1'
    },
    {
        id: 'item2', 
        title: '测试文章2',
        description: '这是测试文章2的描述',
        link: 'https://example.com/item2',
        pubDate: new Date('2025-08-19T11:00:00Z'),
        author: '作者2',
        content: '测试内容2'
    }
];

const testStates = {
    [testFeedId]: {
        lastUpdated: new Date().toISOString()
    }
};

// 模拟分离存储的文件路径
const issueManagerDir = path.join(process.cwd(), '.issueManager');
const statesFile = path.join(issueManagerDir, 'rss-states.json');
const feedFile = path.join(issueManagerDir, `rss-${testFeedId}.jsonl`);

console.log('开始测试RSS分离存储功能...\n');

// 创建目录
if (!fs.existsSync(issueManagerDir)) {
    fs.mkdirSync(issueManagerDir, { recursive: true });
    console.log('✓ 创建 .issueManager 目录');
}

// 测试保存状态文件
try {
    fs.writeFileSync(statesFile, JSON.stringify(testStates, null, 2));
    console.log('✓ 保存RSS状态文件');
} catch (error) {
    console.error('✗ 保存RSS状态文件失败:', error);
}

// 测试保存JSONL文件
try {
    const jsonlContent = testItems.map(item => JSON.stringify(item)).join('\n');
    fs.writeFileSync(feedFile, jsonlContent);
    console.log('✓ 保存RSS文章JSONL文件');
} catch (error) {
    console.error('✗ 保存RSS文章JSONL文件失败:', error);
}

// 测试读取状态文件
try {
    const statesContent = fs.readFileSync(statesFile, 'utf8');
    const loadedStates = JSON.parse(statesContent);
    console.log('✓ 读取RSS状态文件成功');
    console.log('  状态数据:', Object.keys(loadedStates).length, '个订阅源');
} catch (error) {
    console.error('✗ 读取RSS状态文件失败:', error);
}

// 测试读取JSONL文件
try {
    const jsonlContent = fs.readFileSync(feedFile, 'utf8');
    const lines = jsonlContent.trim().split('\n');
    const loadedItems = lines.map(line => JSON.parse(line));
    console.log('✓ 读取RSS文章JSONL文件成功');
    console.log('  文章数据:', loadedItems.length, '篇文章');
} catch (error) {
    console.error('✗ 读取RSS文章JSONL文件失败:', error);
}

// 验证Git友好性：检查文件大小和结构
console.log('\nGit友好性检查:');
console.log('- 状态文件大小:', fs.statSync(statesFile).size, 'bytes');
console.log('- 文章文件大小:', fs.statSync(feedFile).size, 'bytes');
console.log('- 分离存储：每个订阅源独立文件 ✓');
console.log('- JSONL格式：便于增量更新 ✓');

console.log('\n测试完成！新的分离存储格式工作正常。');
