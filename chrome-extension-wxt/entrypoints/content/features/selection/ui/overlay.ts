/**
 * UI 组件:Overlay 遮罩层
 */

export function createOverlay(): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'issue-manager-overlay';
  document.body.appendChild(overlay);
  return overlay;
}

export function removeOverlay(overlay: HTMLElement | null): void {
  if (overlay?.parentNode) {
    overlay.parentNode.removeChild(overlay);
  }
}
