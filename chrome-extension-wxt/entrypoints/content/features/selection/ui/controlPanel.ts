/**
 * UI 组件:Control Panel 控制面板
 */

export interface ControlPanelCallbacks {
  onConfirm: () => void;
  onCancel: () => void;
}

export function createControlPanel(callbacks: ControlPanelCallbacks): HTMLElement {
  const controlPanel = document.createElement('div');
  controlPanel.className = 'issue-manager-control';

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'issue-manager-control-confirm';
  confirmBtn.textContent = '确认';
  confirmBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    callbacks.onConfirm();
  }, true);

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'issue-manager-control-cancel';
  cancelBtn.textContent = '重新选择';
  cancelBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    callbacks.onCancel();
  }, true);

  controlPanel.appendChild(confirmBtn);
  controlPanel.appendChild(cancelBtn);
  document.body.appendChild(controlPanel);
  
  return controlPanel;
}

export function removeControlPanel(controlPanel: HTMLElement | null): void {
  if (controlPanel?.parentNode) {
    controlPanel.parentNode.removeChild(controlPanel);
  }
}
