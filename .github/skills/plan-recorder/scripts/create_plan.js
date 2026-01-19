#!/usr/bin/env node
const fs = require('fs').promises;
const path = require('path');

async function main() {
  const args = process.argv.slice(2);
  let outArgIndex = args.findIndex(a => a === '--out' || a === '-o');
  let outPath;
  if (outArgIndex >= 0 && args[outArgIndex + 1]) {
    outPath = args[outArgIndex + 1];
  } else if (args[0] && !args[0].startsWith('-')) {
    outPath = args[0];
  }

  const source = path.join(__dirname, '..', 'references', 'PLAN.md');

  // 默认目录：/Users/wedaren/repositoryDestinationOfGithub/issue-notes
  const defaultDir = path.resolve('/Users/wedaren/repositoryDestinationOfGithub/issue-notes');

  function generateFileName() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
    return `${year}${month}${day}-${hours}${minutes}${seconds}-${milliseconds}.md`;
  }

  let target;
  if (outPath) {
    const resolved = path.resolve(outPath);
    // 如果传入的是目录，则在该目录下生成文件名
    try {
      const stat = require('fs').statSync(resolved);
      if (stat.isDirectory()) {
        target = path.join(resolved, generateFileName());
      } else {
        target = resolved;
      }
    } catch (e) {
      // 路径不存在：如果路径有扩展名，则视为文件，否则视为目录
      if (path.extname(resolved)) {
        target = resolved;
      } else {
        target = path.join(resolved, generateFileName());
      }
    }
  } else {
    target = path.join(defaultDir, generateFileName());
  }

  try {
    const content = await fs.readFile(source, 'utf8');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
    console.log(`Plan written to ${target}`);
  } catch (err) {
    console.error('Failed to write plan:', err.message || err);
    process.exit(1);
  }
}

main();
