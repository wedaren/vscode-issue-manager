#!/usr/bin/env sh
set -euo pipefail

# release-patch.sh
# 简化并可维护的发布脚本：
# 1. 切换并更新 main
# 2. 若有未提交改动则 stash（含未追踪文件）
# 3. 执行 `npm version patch` 并推送 tags
# 4. 若创建了 stash 则尝试 pop（失败时提示手动处理）

log() {
  printf "%s\n" "$1"
}

log "Starting release-patch flow..."

git fetch origin
git checkout main
git pull origin main

# 如果工作区有未提交改动（包括未追踪文件），则报错并退出以避免意外修改历史
if [ -n "$(git status --porcelain)" ]; then
  log "Error: working directory is not clean. Commit or stash your changes before running this script."
  exit 1
fi

log "Running: npm version patch"
npm version patch

log "Pushing tags"
git push --follow-tags

log "Release flow finished."
