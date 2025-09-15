#!/usr/bin/env node

/**
 * 测试发布脚本的功能
 */

const { parseCommits, generateChangelogEntry } = require('./release.js');

// 测试数据
const testCommits = [
  'a1b2c3d feat: 新增RSS问题视图功能',
  'e4f5g6h fix: 修复问题结构视图无法展示新增markdown文档的问题',
  'i7j8k9l docs: 更新README文档',
  'mn0pq1r improve: 关注问题视图与问题总览支持折叠功能',
  'st2uv3w chore: 更新依赖包版本',
  'xy4za5b refactor: 重构GitSyncService架构'
];

console.log('🧪 测试发布脚本功能...\n');

// 测试提交解析
console.log('1. 测试提交信息解析:');
const categories = parseCommits(testCommits);
Object.entries(categories).forEach(([key, category]) => {
  if (category.items.length > 0) {
    console.log(`   ${category.title}: ${category.items.length} 项`);
    category.items.forEach(item => console.log(`     ${item}`));
  }
});

console.log('\n2. 测试changelog条目生成:');
const changelogEntry = generateChangelogEntry('0.1.13', categories);
console.log(changelogEntry);

console.log('✅ 测试完成！');