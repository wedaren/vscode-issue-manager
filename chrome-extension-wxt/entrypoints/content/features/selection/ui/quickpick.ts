/**
 * 快速命令选择 (QuickPick)
 * 提供一个简洁的命令面板用于快速执行预定义命令。
 */

export interface QuickPickOption {
  id: string;
  label: string;
  description?: string;
}

let qpOverlay: HTMLElement | null = null;
let qpPanel: HTMLElement | null = null;
let inputEl: HTMLInputElement | null = null;
let listEl: HTMLElement | null = null;
let optionsCache: QuickPickOption[] = [];
let activeIndex = -1;

function createPanel(): void {
  removePanel();

  qpOverlay = document.createElement('div');
  qpOverlay.className = 'issue-manager-quickpick-overlay';

  qpPanel = document.createElement('div');
  qpPanel.className = 'issue-manager-quickpick-panel';

  inputEl = document.createElement('input');
  inputEl.className = 'issue-manager-quickpick-input';
  inputEl.placeholder = '输入命令... (Cmd+Shift+P 切换)';

  listEl = document.createElement('div');
  listEl.className = 'issue-manager-quickpick-list';

  qpPanel.appendChild(inputEl);
  qpPanel.appendChild(listEl);
  qpOverlay.appendChild(qpPanel);
  document.body.appendChild(qpOverlay);

  // 强制面板定位和列表绝对定位，避免被页面布局或阴影遮挡
  try {
    qpPanel.style.position = 'relative';
    qpPanel.style.zIndex = '10000002';
    if (listEl) {
      listEl.style.position = 'absolute';
      listEl.style.left = '0';
      listEl.style.right = '0';
      listEl.style.top = (inputEl ? (inputEl.offsetHeight + 0) + 'px' : '48px');
      listEl.style.zIndex = '10000003';
      listEl.style.maxHeight = '360px';
      listEl.style.overflow = 'auto';
      listEl.style.background = '#ffffff';
      listEl.style.boxShadow = '0 6px 20px rgba(2,6,23,0.12)';
      listEl.style.border = '1px solid rgba(0,0,0,0.06)';
      listEl.style.borderTop = '1px solid rgba(0,0,0,0.08)';
      listEl.style.padding = '6px 0';
    }
  } catch (e) {
    // ignore
  }

  // focus
  setTimeout(() => inputEl?.focus(), 0);

  // events
  inputEl.addEventListener('keydown', onInputKeyDown);
  inputEl.addEventListener('input', onInputChange);
  // 当窗口尺寸或字体改变时，重新计算列表位置
  window.addEventListener('resize', () => {
    if (listEl && inputEl) {
      listEl.style.top = (inputEl.offsetHeight) + 'px';
    }
  });
  qpOverlay.addEventListener('click', (e) => {
    if (e.target === qpOverlay) { removePanel(); }
  });
}

function removePanel(): void {
  if (inputEl) {
    inputEl.removeEventListener('keydown', onInputKeyDown);
    inputEl.removeEventListener('input', onInputChange);
  }
  if (qpOverlay?.parentNode) qpOverlay.parentNode.removeChild(qpOverlay);
  qpOverlay = null;
  qpPanel = null;
  inputEl = null;
  listEl = null;
  optionsCache = [];
  activeIndex = -1;
}

function renderList(filtered: QuickPickOption[]): void {
  if (!listEl) return;
  console.log('[QuickPick] renderList items:', filtered.length);
  listEl.innerHTML = '';
  // debug header so user can visually see list exists
  const dbg = document.createElement('div');
  dbg.style.padding = '6px 12px';
  dbg.style.fontSize = '12px';
  dbg.style.color = '#334155';
  dbg.style.background = '#fffbdd';
  dbg.style.borderBottom = '1px solid rgba(0,0,0,0.04)';
  dbg.textContent = `Commands: ${filtered.length}`;
  listEl.appendChild(dbg);

  filtered.forEach((opt, idx) => {
    const item = document.createElement('div');
    item.className = 'issue-manager-quickpick-item';
    if (idx === activeIndex) item.classList.add('active');

    // inline styles to avoid page CSS hiding items
    item.style.padding = '10px 14px';
    item.style.display = 'block';
    item.style.cursor = 'pointer';
    item.style.background = idx === activeIndex ? 'linear-gradient(90deg, rgba(102,126,234,0.08), rgba(118,75,162,0.04))' : '#ffffff';
    item.style.color = '#0f172a';
    item.style.borderBottom = '1px solid rgba(0,0,0,0.03)';

    const label = document.createElement('div');
    label.className = 'issue-manager-quickpick-item-label';
    label.textContent = opt.label;
    label.style.fontWeight = '600';
    label.style.color = '#0f172a';

    const desc = document.createElement('div');
    desc.className = 'issue-manager-quickpick-item-desc';
    desc.textContent = opt.description || '';
    desc.style.fontSize = '12px';
    desc.style.color = '#6b7280';

    item.appendChild(label);
    item.appendChild(desc);

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      triggerPick(opt);
    });

    listEl!.appendChild(item);
  });
}

function filterOptions(query: string): QuickPickOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return optionsCache.slice(0, 50);
  return optionsCache
    .filter(o => (o.label + ' ' + (o.description || '')).toLowerCase().includes(q))
    .slice(0, 50);
}

let onPickCb: ((id: string) => void) | null = null;

function triggerPick(opt: QuickPickOption): void {
  removePanel();
  if (onPickCb) onPickCb(opt.id);
}

function onInputChange(): void {
  if (!inputEl) return;
  const filtered = filterOptions(inputEl.value);
  activeIndex = Math.min(activeIndex, filtered.length - 1);
  renderList(filtered);
}

function onInputKeyDown(ev: KeyboardEvent): void {
  if (!inputEl) return;
  const filtered = filterOptions(inputEl.value);

  if (ev.key === 'ArrowDown') {
    ev.preventDefault();
    activeIndex = Math.min(filtered.length - 1, activeIndex + 1);
    renderList(filtered);
    scrollActiveIntoView();
    return;
  }

  // Ctrl+N (下一项)
  if (ev.ctrlKey && ev.key.toLowerCase() === 'n') {
    ev.preventDefault();
    activeIndex = Math.min(filtered.length - 1, activeIndex + 1);
    renderList(filtered);
    scrollActiveIntoView();
    return;
  }

  if (ev.key === 'ArrowUp') {
    ev.preventDefault();
    activeIndex = Math.max(0, activeIndex - 1);
    renderList(filtered);
    scrollActiveIntoView();
    return;
  }

  // Ctrl+P (上一项)
  if (ev.ctrlKey && ev.key.toLowerCase() === 'p') {
    ev.preventDefault();
    activeIndex = Math.max(0, activeIndex - 1);
    renderList(filtered);
    scrollActiveIntoView();
    return;
  }

  if (ev.key === 'Enter') {
    ev.preventDefault();
    const target = filtered[activeIndex] ?? filtered[0];
    if (target) triggerPick(target);
    return;
  }

  if (ev.key === 'Escape') {
    ev.preventDefault();
    removePanel();
    return;
  }
}

function scrollActiveIntoView(): void {
  if (!listEl) return;
  const items = Array.from(listEl.querySelectorAll('.issue-manager-quickpick-item')) as HTMLElement[];
  if (activeIndex >= 0 && items[activeIndex]) {
    const el = items[activeIndex];
    const rect = listEl.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    if (elRect.top < rect.top) el.scrollIntoView({ block: 'nearest' });
    else if (elRect.bottom > rect.bottom) el.scrollIntoView({ block: 'nearest' });
  }
}

/**
 * 显示 QuickPick
 */
export function showQuickPick(options: QuickPickOption[], onPick: (id: string) => void): void {
  // Ensure panel is created first (createPanel calls removePanel which clears state),
  // then populate options and render.
  onPickCb = onPick;
  createPanel();
  optionsCache = options.slice();
  activeIndex = 0;
  renderList(optionsCache.slice(0, 50));
}

/**
 * 隐藏 QuickPick
 */
export function hideQuickPick(): void {
  removePanel();
}
