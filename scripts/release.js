#!/usr/bin/env node

/**
 * 自动发布脚本
 * 功能：
 * 1. 从git log获取最新提交记录
 * 2. 自动更新CHANGELOG.md
 * 3. 使用npm version patch增加版本号
 * 4. 创建git tag并推送
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 配置选项
const CONFIG = {
  changelogPath: path.join(__dirname, '..', 'CHANGELOG.md'),
  packageJsonPath: path.join(__dirname, '..', 'package.json'),
  // 获取从最后一个version tag以来的提交
  gitLogCommand: 'git log --oneline --pretty=format:"%h %s" $(git describe --tags --abbrev=0 2>/dev/null || echo HEAD~10)..HEAD',
  // 如果没有tags，则获取最近10个提交
  fallbackGitLogCommand: 'git log --oneline --pretty=format:"%h %s" -10'
};

/**
 * 执行命令并返回输出
 */
function execCommand(command, options = {}) {
  try {
    return execSync(command, { encoding: 'utf8', ...options }).trim();
  } catch (error) {
    console.error(`执行命令失败: ${command}`);
    console.error(error.message);
    return null;
  }
}

/**
 * 获取git提交记录
 */
function getGitCommits() {
  console.log('🔍 获取git提交记录...');
  
  let commits = execCommand(CONFIG.gitLogCommand);
  
  // 如果没有找到任何tag，使用fallback命令
  if (!commits) {
    console.log('⚠️  未找到版本标签，获取最近10个提交');
    commits = execCommand(CONFIG.fallbackGitLogCommand);
  }
  
  if (!commits) {
    throw new Error('无法获取git提交记录');
  }
  
  return commits.split('\n').filter(line => line.trim());
}

/**
 * 解析提交信息，按类型分组
 */
function parseCommits(commits) {
  const categories = {
    feat: { title: '✨ 新功能', items: [] },
    fix: { title: '🐞 修复', items: [] },
    docs: { title: '📚 文档', items: [] },
    style: { title: '🎨 代码风格', items: [] },
    refactor: { title: '♻️ 重构', items: [] },
    perf: { title: '⚡ 性能优化', items: [] },
    test: { title: '🧪 测试', items: [] },
    chore: { title: '🔧 构建/工具', items: [] },
    improve: { title: '🔧 改进', items: [] },
    other: { title: '📝 其他', items: [] }
  };

  commits.forEach(commit => {
    const match = commit.match(/^(\w+)\s+(.+)$/);
    if (!match) return;

    const [, hash, message] = match;
    
    // 识别提交类型
    let type = 'other';
    for (const [key, category] of Object.entries(categories)) {
      if (message.toLowerCase().includes(key + ':') || 
          message.toLowerCase().startsWith(key + ' ') ||
          message.toLowerCase().startsWith(key + '(')) {
        type = key;
        break;
      }
    }

    categories[type].items.push(`- **${message.replace(/^(feat|fix|docs|style|refactor|perf|test|chore|improve)[\:\s\(]/i, '')}**`);
  });

  return categories;
}

/**
 * 生成changelog条目
 */
function generateChangelogEntry(version, categories) {
  const date = new Date().toISOString().split('T')[0];
  let entry = `\n## [${version}] - ${date}\n`;

  Object.values(categories).forEach(category => {
    if (category.items.length > 0) {
      entry += `\n### ${category.title}\n`;
      category.items.forEach(item => {
        entry += `${item}\n`;
      });
    }
  });

  return entry;
}

/**
 * 更新CHANGELOG.md
 */
function updateChangelog(newEntry) {
  console.log('📝 更新CHANGELOG.md...');
  
  if (!fs.existsSync(CONFIG.changelogPath)) {
    throw new Error('CHANGELOG.md 文件不存在');
  }

  const content = fs.readFileSync(CONFIG.changelogPath, 'utf8');
  
  // 查找插入位置：在版本信息说明后，第一个版本条目前
  const insertMarker = '**注意**: 从v0.1.13开始，changelog由自动化发布工具维护。使用 `npm run release` 可自动基于git log更新changelog。';
  const insertIndex = content.indexOf(insertMarker);
  
  if (insertIndex === -1) {
    // 如果没找到标记，尝试在第一个##前插入
    const firstVersionIndex = content.indexOf('\n## [');
    if (firstVersionIndex === -1) {
      throw new Error('无法确定changelog插入位置');
    }
    const beforeFirstVersion = content.substring(0, firstVersionIndex);
    const afterFirstVersion = content.substring(firstVersionIndex);
    const updatedContent = beforeFirstVersion + newEntry + afterFirstVersion;
    fs.writeFileSync(CONFIG.changelogPath, updatedContent, 'utf8');
  } else {
    // 在标记行后插入
    const markerEndIndex = insertIndex + insertMarker.length;
    const beforeMarker = content.substring(0, markerEndIndex);
    const afterMarker = content.substring(markerEndIndex);
    const updatedContent = beforeMarker + newEntry + afterMarker;
    fs.writeFileSync(CONFIG.changelogPath, updatedContent, 'utf8');
  }
  
  console.log('✅ CHANGELOG.md 已更新');
}

/**
 * 使用npm version增加版本号
 */
function bumpVersion(type = 'patch') {
  console.log(`📦 使用npm version ${type}增加版本号...`);
  
  try {
    const newVersion = execCommand(`npm version ${type} --no-git-tag-version`);
    console.log(`✅ 版本号已更新为: ${newVersion}`);
    return newVersion;
  } catch (error) {
    throw new Error('npm version 执行失败: ' + error.message);
  }
}

/**
 * 获取当前版本
 */
function getCurrentVersion() {
  const packageJson = JSON.parse(fs.readFileSync(CONFIG.packageJsonPath, 'utf8'));
  return packageJson.version;
}

/**
 * 创建并推送git tag
 */
function createAndPushTag(version) {
  console.log(`🏷️  创建git tag: v${version}`);
  
  try {
    // 添加所有更改
    execCommand('git add .');
    
    // 提交更改
    execCommand(`git commit -m "chore: release v${version}"`);
    
    // 创建tag
    execCommand(`git tag v${version}`);
    
    console.log(`✅ Git tag v${version} 已创建`);
    
    // 询问是否推送
    console.log('📤 推送tag到远程仓库...');
    execCommand('git push origin HEAD');
    execCommand(`git push origin v${version}`);
    
    console.log('✅ Tag已推送到远程仓库');
    
  } catch (error) {
    console.error('❌ Git操作失败:', error.message);
    throw error;
  }
}

/**
 * 主函数
 */
async function main() {
  try {
    console.log('🚀 开始自动发布流程...\n');
    
    // 检查是否在git仓库中
    if (!execCommand('git rev-parse --git-dir')) {
      throw new Error('当前目录不是git仓库');
    }
    
    // 检查工作区是否干净
    const status = execCommand('git status --porcelain');
    if (status && !process.argv.includes('--force')) {
      console.log('⚠️  工作区有未提交的更改:');
      console.log(status);
      console.log('使用 --force 参数忽略此检查');
      process.exit(1);
    }
    
    // 获取git提交记录
    const commits = getGitCommits();
    
    if (commits.length === 0) {
      console.log('⚠️  没有新的提交记录，无需发布');
      process.exit(0);
    }
    
    console.log(`📝 找到 ${commits.length} 个提交记录:`);
    commits.forEach(commit => console.log(`   ${commit}`));
    console.log();
    
    // 增加版本号
    const versionType = process.argv.includes('--minor') ? 'minor' : 
                       process.argv.includes('--major') ? 'major' : 'patch';
    const newVersion = bumpVersion(versionType);
    const version = newVersion.replace('v', '');
    
    // 解析提交信息
    const categories = parseCommits(commits);
    
    // 生成changelog条目
    const changelogEntry = generateChangelogEntry(version, categories);
    
    // 更新CHANGELOG.md
    updateChangelog(changelogEntry);
    
    // 创建并推送tag（如果指定了--tag参数）
    if (process.argv.includes('--tag')) {
      createAndPushTag(version);
      console.log(`\n🎉 发布完成！版本 v${version} 已推送到远程仓库`);
      console.log('GitHub Actions将自动发布到VS Code Marketplace');
    } else {
      console.log(`\n✅ 版本 v${version} 准备完毕`);
      console.log('运行以下命令推送并触发发布:');
      console.log(`   git add . && git commit -m "chore: release v${version}" && git tag v${version} && git push origin HEAD && git push origin v${version}`);
    }
    
  } catch (error) {
    console.error('❌ 发布失败:', error.message);
    process.exit(1);
  }
}

// 显示帮助信息
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
🚀 VS Code扩展自动发布工具

用法:
  node scripts/release.js [选项]

选项:
  --patch     创建patch版本 (默认)
  --minor     创建minor版本  
  --major     创建major版本
  --tag       自动创建并推送git tag
  --force     忽略工作区检查
  --help, -h  显示帮助信息

示例:
  node scripts/release.js                    # 创建patch版本并更新changelog
  node scripts/release.js --minor --tag      # 创建minor版本并推送tag
  node scripts/release.js --force            # 忽略工作区检查

注意：
- 推送tag后会自动触发GitHub Actions发布到VS Code Marketplace
- 确保已设置VSCE_TOKEN secret
`);
  process.exit(0);
}

// 运行主函数
if (require.main === module) {
  main();
}

module.exports = { main, parseCommits, generateChangelogEntry };