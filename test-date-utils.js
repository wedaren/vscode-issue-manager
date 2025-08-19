import { normalizeDate, formatDate, dateToKey, getDateGroupKey, getOrderedGroupKeys, dateKeyToLabel } from '../src/utils/dateUtils';

// 测试日期工具函数
console.log('=== 日期工具函数测试 ===');

const today = new Date();
const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
const fiveDaysAgo = new Date(today.getTime() - 5 * 24 * 60 * 60 * 1000);
const twoWeeksAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);

console.log('原始日期测试:');
console.log('今天:', today);
console.log('昨天:', yesterday);
console.log('5天前:', fiveDaysAgo);
console.log('两周前:', twoWeeksAgo);

console.log('\n标准化日期测试:');
console.log('今天标准化:', normalizeDate(today));
console.log('昨天标准化:', normalizeDate(yesterday));

console.log('\n日期键测试:');
console.log('今天键:', dateToKey(today));
console.log('昨天键:', dateToKey(yesterday));

console.log('\n分组键测试:');
console.log('今天分组:', getDateGroupKey(today));
console.log('昨天分组:', getDateGroupKey(yesterday));
console.log('5天前分组:', getDateGroupKey(fiveDaysAgo));
console.log('两周前分组:', getDateGroupKey(twoWeeksAgo));

console.log('\n格式化日期测试:');
console.log('今天格式化:', formatDate(today));
console.log('5天前格式化:', formatDate(fiveDaysAgo));

console.log('\n标签转换测试:');
console.log('今天标签:', dateKeyToLabel('今天'));
console.log('昨天标签:', dateKeyToLabel('昨天'));
console.log('更早标签:', dateKeyToLabel('更早'));
console.log('日期键标签:', dateKeyToLabel(dateToKey(fiveDaysAgo)));

// 测试分组排序
const testGroups = new Map();
testGroups.set('今天', []);
testGroups.set('昨天', []);
testGroups.set(dateToKey(fiveDaysAgo), []);
testGroups.set('更早', []);

console.log('\n分组排序测试:');
console.log('排序前的键:', Array.from(testGroups.keys()));
console.log('排序后的键:', getOrderedGroupKeys(testGroups));

console.log('\n=== 测试完成 ===');
