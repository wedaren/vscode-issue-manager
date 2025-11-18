/**
 * UI 组件:Highlight 高亮框
 */

export function createHighlightBox(): HTMLElement {
  const highlightBox = document.createElement('div');
  highlightBox.className = 'issue-manager-highlight';
  document.body.appendChild(highlightBox);
  return highlightBox;
}

export function removeHighlightBox(highlightBox: HTMLElement | null): void {
  if (highlightBox?.parentNode) {
    highlightBox.parentNode.removeChild(highlightBox);
  }
}

export function updateHighlight(highlightBox: HTMLElement | null, element: HTMLElement | null): void {
  if (!highlightBox) return;
  
  if (!element) {
    highlightBox.style.display = 'none';
    return;
  }
  
  const rect = element.getBoundingClientRect();
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

  highlightBox.style.display = 'block';
  highlightBox.style.top = (rect.top + scrollTop) + 'px';
  highlightBox.style.left = (rect.left + scrollLeft) + 'px';
  highlightBox.style.width = rect.width + 'px';
  highlightBox.style.height = rect.height + 'px';
}
