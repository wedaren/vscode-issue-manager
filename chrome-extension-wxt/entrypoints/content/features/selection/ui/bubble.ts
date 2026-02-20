/**
 * UI 组件：悬浮流式打字气泡
 */

let bubblePanel: HTMLElement | null = null;
let contentArea: HTMLElement | null = null;

/**
 * 创创建悬浮打字气泡
 */
export function createTranslateBubble(): void {
    removeTranslateBubble();

    bubblePanel = document.createElement('div');
    bubblePanel.className = 'issue-manager-translate-bubble';
    bubblePanel.innerHTML = `
    <div class="im-tb-header">
      <span class="im-tb-title">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
        AI 正在极速翻译中...
      </span>
      <button class="im-tb-close" title="取消并关闭">&times;</button>
    </div>
    <div class="im-tb-content issue-manager-markdown-body">
      <span class="im-tb-cursor"></span>
    </div>
  `;

    document.body.appendChild(bubblePanel);

    contentArea = bubblePanel.querySelector('.im-tb-content');

    // 绑定关闭按钮（临时取消用，不发送后端中止）
    const closeBtn = bubblePanel.querySelector('.im-tb-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeTranslateBubble();
        });
    }
}

/**
 * 实时更新气泡中的文本
 * @param chunkHtml 积累的纯文本或 HTML 源码
 */
export function updateTranslateBubble(chunkHtml: string): void {
    if (!contentArea) return;

    // 简单处理，移除 markdown 包裹符，显示纯文本式样
    let displayText = chunkHtml.replace(/^```html\n?/i, '').replace(/```$/i, '');

    // 为了安全和避免 HTML 没闭合把界面搞崩，我们在气泡里全当 textContent 展示（或者用innerText）
    // 这样用户能看到源码的生成过程，也是一种 hacker 风格的酷炫
    contentArea.textContent = displayText;

    // 加回光标
    const cursor = document.createElement('span');
    cursor.className = 'im-tb-cursor';
    contentArea.appendChild(cursor);

    // 自动滚动到最下面
    contentArea.scrollTop = contentArea.scrollHeight;
}

/**
 * 移除打字气泡
 */
export function removeTranslateBubble(): void {
    if (bubblePanel?.parentNode) {
        bubblePanel.parentNode.removeChild(bubblePanel);
    }
    bubblePanel = null;
    contentArea = null;
}
