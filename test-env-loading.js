#!/usr/bin/env node

/**
 * 测试环境变量加载
 * 
 * 验证多环境配置文件是否正确加载
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

console.log('========================================');
console.log('测试环境变量加载');
console.log('========================================\n');

// 模拟 SharedConfig 的加载逻辑
const extensionPath = __dirname;
const mode = process.env.NODE_ENV || 'development';

console.log(`当前模式: ${mode}\n`);

// 按顺序加载配置文件
const envFiles = [
  path.join(extensionPath, '.env'),
  path.join(extensionPath, '.env.local'),
  path.join(extensionPath, `.env.${mode}`),
  path.join(extensionPath, `.env.${mode}.local`)
];

console.log('尝试加载以下配置文件:\n');

let loadedVars = {};

for (const envFile of envFiles) {
  const exists = fs.existsSync(envFile);
  const status = exists ? '✅' : '❌';
  console.log(`${status} ${path.basename(envFile)}`);
  
  if (exists) {
    const result = dotenv.config({ path: envFile, override: true });
    if (!result.error) {
      console.log(`   已加载: ${path.basename(envFile)}`);
      // 记录新加载的变量
      if (result.parsed) {
        Object.assign(loadedVars, result.parsed);
      }
    }
  }
}

console.log('\n========================================');
console.log('最终环境变量值:');
console.log('========================================\n');

const checkVars = [
  'WS_PORT',
  'WS_HOST',
  'WS_PORT_RANGE_START',
  'WS_PORT_RANGE_END',
  'LOG_LEVEL',
  'ENABLE_PORT_DISCOVERY',
  'PORT_DISCOVERY_TIMEOUT',
  'WS_RETRY_DELAY',
  'ENABLE_VERBOSE_LOGGING',
  'ENABLE_PERFORMANCE_MONITORING'
];

for (const varName of checkVars) {
  const value = process.env[varName];
  if (value !== undefined) {
    console.log(`✅ ${varName} = ${value}`);
  } else {
    console.log(`❌ ${varName} = (未设置)`);
  }
}

console.log('\n========================================');
console.log('验证开发环境配置:');
console.log('========================================\n');

if (mode === 'development') {
  // 验证开发环境特定值
  const checks = [
    { var: 'WS_PORT', expected: '37895', desc: '开发端口' },
    { var: 'LOG_LEVEL', expected: 'debug', desc: 'Debug 日志' },
    { var: 'PORT_DISCOVERY_TIMEOUT', expected: '500', desc: '快速超时' },
    { var: 'WS_RETRY_DELAY', expected: '500', desc: '快速重试' }
  ];
  
  for (const check of checks) {
    const actual = process.env[check.var];
    const match = actual === check.expected;
    const status = match ? '✅' : '❌';
    console.log(`${status} ${check.desc}: ${check.var}=${actual} (期望: ${check.expected})`);
  }
} else {
  console.log('非开发模式，跳过开发环境配置检查');
}

console.log('\n========================================');
console.log('测试完成');
console.log('========================================\n');
