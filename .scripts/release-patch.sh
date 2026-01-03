#!/usr/bin/env sh
set -euo pipefail

# release-patch.sh
# 简化并可维护的发布脚本：
# 1. 切换并更新 main
# 2. 若有未提交改动则报错并退出（避免影响提交历史）
# 3. 执行 `npm version patch` 并推送 tags

log() {
  if [ $# -eq 0 ]; then
    return
  fi
  if [ $# -ge 2 ]; then
    level="$1"
    shift
    msg="$*"
  else
    level="info"
    msg="$1"
  fi
  case "$level" in
    info) color="$BLUE";;
    warn) color="$YELLOW";;
    error) color="$RED";;
    success) color="$GREEN";;
    *) color="$RESET";;
  esac
  printf "%b%s%b\n" "$color" "$msg" "$RESET"
}

# ANSI 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
RESET='\033[0m'

log success "Starting release-patch flow..."

git fetch origin
git checkout main
git pull origin main

# 如果工作区有未提交改动（包括未追踪文件），则报错并退出以避免意外修改历史
if [ -n "$(git status --porcelain)" ]; then
  log error "检测到本地未提交的改动。为避免影响你的工作，请先提交或运行 'git stash' 临时保存更改，然后重试本脚本。"
  log info "提示：运行 'git status' 查看详细改动，或使用 'git stash' 暂存后重试。"
  exit 1
fi

log "Running: npm version patch"
npm version patch

log "Pushing tags"
git push --follow-tags

log "Release flow finished."
