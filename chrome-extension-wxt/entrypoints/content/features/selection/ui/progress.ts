/**
 * UI 组件：翻译进度提示框
 */

let progressPanel: HTMLElement | null = null;
let totalBlocks = 0;
let completedBlocks = 0;

/**
 * 创建并显示悬浮进度条
 */
export function createTranslateProgress(total: number): void {
    removeTranslateProgress();

    totalBlocks = total;
    completedBlocks = 0;

    progressPanel = document.createElement('div');
    progressPanel.className = 'issue-manager-translate-progress';
    progressPanel.innerHTML = `
    <div class="im-tp-header">
      <span class="im-tp-title">正在翻译选中区域...</span>
      <button class="im-tp-close" title="隐藏进度条">&times;</button>
    </div>
    <div class="im-tp-bar-container">
      <div class="im-tp-bar" style="width: 0%"></div>
    </div>
    <div class="im-tp-status">0 / ${totalBlocks}</div>
  `;

    document.body.appendChild(progressPanel);

    // 绑定关闭按钮
    const closeBtn = progressPanel.querySelector('.im-tp-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeTranslateProgress();
        });
    }
}

/**
 * 增加并更新进度（完成一块时调用）
 */
export function incrementTranslateProgress(): void {
    completedBlocks += 1;
    updateTranslateProgress(completedBlocks, totalBlocks);
}

/**
 * 更新悬浮进度条UI
 */
export function updateTranslateProgress(completed: number, total: number): void {
    if (!progressPanel) { return; }

    const percentage = Math.min(100, Math.round((completed / total) * 100));

    const bar = progressPanel.querySelector('.im-tp-bar') as HTMLElement;
    if (bar) {
        bar.style.width = `${percentage}%`;
    }

    const status = progressPanel.querySelector('.im-tp-status');
    if (status) {
        status.textContent = `${completed} / ${total}`;
    }

    if (completed >= total) {
        const title = progressPanel.querySelector('.im-tp-title');
        if (title) { title.textContent = '翻译完成'; }

        // 完成后延迟消失
        setTimeout(() => {
            removeTranslateProgress();
        }, 3000);
    }
}

/**
 * 移除进度条
 */
export function removeTranslateProgress(): void {
    if (progressPanel?.parentNode) {
        progressPanel.parentNode.removeChild(progressPanel);
    }
    progressPanel = null;
}
