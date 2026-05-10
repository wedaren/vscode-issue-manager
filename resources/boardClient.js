// 调查板 Webview 客户端：canvas 拖拽/缩放/撤销/minimap/lightbox。
// 入口：index HTML 通过 window.__BOARD_STATE__ 传入初始状态（ImageBoardEditorProvider._buildHtml 中注入）。

(function() {
    const api = acquireVsCodeApi();
    const viewport = document.getElementById('viewport');
    const canvas = document.getElementById('canvas');
    const btnAdd = document.getElementById('btnAdd');
    const btnAddIssue = document.getElementById('btnAddIssue');
    const btnUndo = document.getElementById('btnUndo');
    const btnRedo = document.getElementById('btnRedo');
    const btnClear = document.getElementById('btnClear');
    const btnZen = document.getElementById('btnZen');
    const lightbox = document.getElementById('lightbox');
    const lbImg = document.getElementById('lbImg');
    const btnZoomIn = document.getElementById('btnZoomIn');
    const btnZoomOut = document.getElementById('btnZoomOut');
    const btnZoom100 = document.getElementById('btnZoom100');
    const btnZoomFit = document.getElementById('btnZoomFit');
    const minimapCanvas = document.getElementById('minimap');
    const mmCtx = minimapCanvas ? minimapCanvas.getContext('2d') : null;
    const zoomLabel = document.getElementById('zoomLabel');

    lightbox.addEventListener('click', () => lightbox.classList.remove('active'));

    let state = window.__BOARD_STATE__ || { canvasX: 0, canvasY: 0, canvasScale: 1, items: [] };
    let items = state.items;
    let camX = state.canvasX, camY = state.canvasY, scale = state.canvasScale;
    let idCounter = Date.now();
    function newId() { return 'i' + (idCounter++); }

    const MAX_HISTORY = 30;
    let undoStack = [];
    let redoStack = [];
    let _persistTimer = null;
    function debouncePersist() {
        if (_persistTimer) { clearTimeout(_persistTimer); }
        _persistTimer = setTimeout(() => { _persistTimer = null; persistState(); }, 300);
    }

    function snapshot() {
        return JSON.stringify({ canvasX: camX, canvasY: camY, canvasScale: scale, items: JSON.parse(JSON.stringify(items)) });
    }
    function syncButtons() {
        btnUndo.disabled = undoStack.length === 0;
        btnRedo.disabled = redoStack.length === 0;
    }
    function recordChange() {
        undoStack.push(snapshot());
        if (undoStack.length > MAX_HISTORY) { undoStack.shift(); }
        redoStack = [];
        syncButtons();
    }
    function restoreSnapshot(s) {
        const parsed = JSON.parse(s);
        camX = parsed.canvasX; camY = parsed.canvasY; scale = parsed.canvasScale;
        applyTransform();
        canvas.innerHTML = '';
        items = parsed.items;
        items.forEach(item => createEl(item));
        persistState();
        syncButtons();
    }
    function undo() { if (!undoStack.length) { return; } redoStack.push(snapshot()); restoreSnapshot(undoStack.pop()); }
    function redo() { if (!redoStack.length) { return; } undoStack.push(snapshot()); restoreSnapshot(redoStack.pop()); }

    function bringForward(item) {
        recordChange();
        item.zIndex = (item.zIndex || 1) + 1;
        const el = canvas.querySelector('[data-id="' + item.id + '"]');
        if (el) { el.style.zIndex = item.zIndex; }
        persistState();
    }
    function sendBackward(item) {
        if ((item.zIndex || 1) <= 1) { return; }
        recordChange();
        item.zIndex = (item.zIndex || 1) - 1;
        const el = canvas.querySelector('[data-id="' + item.id + '"]');
        if (el) { el.style.zIndex = item.zIndex; }
        persistState();
    }
    function bringToTop(item) {
        recordChange();
        const maxZ = items.reduce((m, i) => Math.max(m, i.zIndex || 1), 0);
        item.zIndex = maxZ + 1;
        const el = canvas.querySelector('[data-id="' + item.id + '"]');
        if (el) { el.style.zIndex = item.zIndex; }
        persistState();
    }
    function showLightbox(src) { lbImg.src = src; lightbox.classList.add('active'); }

    function applyTransform() {
        canvas.style.transform = 'translate(' + camX + 'px,' + camY + 'px) scale(' + scale + ')';
        if (zoomLabel) { zoomLabel.textContent = Math.round(scale * 100) + '%'; }
        drawMinimap();
    }
    function getWorldBounds() {
        if (items.length === 0) { return { minX: -200, minY: -200, maxX: 1200, maxY: 1000 }; }
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        items.forEach(function(i) {
            minX = Math.min(minX, i.x); minY = Math.min(minY, i.y);
            maxX = Math.max(maxX, i.x + (i.width || 200)); maxY = Math.max(maxY, i.y + (i.height || 160));
        });
        return { minX: minX - 200, minY: minY - 200, maxX: maxX + 200, maxY: maxY + 200 };
    }
    function drawMinimap() {
        if (!mmCtx || !minimapCanvas) { return; }
        const MM_W = minimapCanvas.width, MM_H = minimapCanvas.height;
        const b = getWorldBounds(), wW = b.maxX - b.minX, wH = b.maxY - b.minY;
        mmCtx.clearRect(0, 0, MM_W, MM_H);
        mmCtx.fillStyle = 'rgba(30,30,30,0.7)'; mmCtx.fillRect(0, 0, MM_W, MM_H);
        items.forEach(function(item) {
            const mx = ((item.x - b.minX) / wW) * MM_W, my = ((item.y - b.minY) / wH) * MM_H;
            const mw = Math.max(2, ((item.width || 200) / wW) * MM_W), mh = Math.max(2, ((item.height || 160) / wH) * MM_H);
            mmCtx.fillStyle = item.type === 'issue' ? 'rgba(74,158,255,.85)' : 'rgba(120,200,80,.85)';
            mmCtx.fillRect(mx, my, mw, mh);
        });
        const vpX = -camX / scale, vpY = -camY / scale;
        const vpW = viewport.clientWidth / scale, vpH = viewport.clientHeight / scale;
        mmCtx.strokeStyle = 'rgba(255,255,255,.7)'; mmCtx.lineWidth = 1.5;
        mmCtx.strokeRect(((vpX - b.minX) / wW) * MM_W, ((vpY - b.minY) / wH) * MM_H, (vpW / wW) * MM_W, (vpH / wH) * MM_H);
    }
    function fitToContent() {
        if (items.length === 0) { camX = 0; camY = 0; scale = 1; applyTransform(); persistState(); return; }
        const b = getWorldBounds(), wW = b.maxX - b.minX, wH = b.maxY - b.minY;
        scale = Math.max(0.1, Math.min(viewport.clientWidth / wW, viewport.clientHeight / wH, 2) * 0.9);
        camX = (viewport.clientWidth - wW * scale) / 2 - b.minX * scale;
        camY = (viewport.clientHeight - wH * scale) / 2 - b.minY * scale;
        applyTransform(); persistState();
    }
    applyTransform();
    items.forEach(item => createEl(item));
    syncButtons();

    function createEl(item) {
        const el = document.createElement('div');
        el.className = 'board-item type-' + (item.type || 'image');
        el.dataset.id = item.id;
        el.style.left = item.x + 'px'; el.style.top = item.y + 'px';
        el.style.width = (item.width || 300) + 'px'; el.style.height = (item.height || 200) + 'px';
        el.style.zIndex = item.zIndex || 1;

        if (item.type === 'issue') {
            const inner = document.createElement('div'); inner.className = 'issue-card-inner';
            const header = document.createElement('div'); header.className = 'issue-card-header'; header.textContent = '📄 Issue';
            const title = document.createElement('div'); title.className = 'issue-card-title'; title.textContent = item.title || '(无标题)';
            const excerpt = document.createElement('div'); excerpt.className = 'issue-card-excerpt'; excerpt.textContent = item.excerpt || '';
            // 鼠标在摘要区域时，如果内容可滚动则让滚轮滚动摘要，不传到画布缩放
            excerpt.addEventListener('wheel', e => {
                if (excerpt.scrollHeight > excerpt.clientHeight) { e.stopPropagation(); }
            }, { passive: true });
            const openBtn = document.createElement('button'); openBtn.className = 'issue-card-open'; openBtn.textContent = '打开文档';
            openBtn.addEventListener('click', e => { e.stopPropagation(); api.postMessage({ type: 'openIssue', filePath: item.filePath }); });
            inner.appendChild(header); inner.appendChild(title); inner.appendChild(excerpt); inner.appendChild(openBtn);
            el.appendChild(inner);
        } else {
            const img = document.createElement('img');
            img.src = item.webviewUri || ''; img.alt = '';
            el.appendChild(img);
        }

        const rh = document.createElement('div'); rh.className = 'resize-handle';
        const dh = document.createElement('div'); dh.className = 'delete-handle';
        dh.innerHTML = '<svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="1" y1="1" x2="8" y2="8"/><line x1="8" y1="1" x2="1" y2="8"/></svg>';
        const actions = document.createElement('div'); actions.className = 'item-actions';

        if (item.type === 'issue') {
            const btnOpen = document.createElement('button'); btnOpen.className = 'ia-btn'; btnOpen.title = '打开文档';
            btnOpen.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8zM1.173 8a13.133 13.133 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.133 13.133 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5c-2.12 0-3.879-1.168-5.168-2.457A13.134 13.134 0 0 1 1.172 8z"/><path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0z"/></svg>';
            btnOpen.addEventListener('click', e => { e.stopPropagation(); api.postMessage({ type: 'openIssue', filePath: item.filePath }); });
            actions.appendChild(btnOpen);
        }

        if (item.type === 'image') {
            const btnPreview = document.createElement('button'); btnPreview.className = 'ia-btn'; btnPreview.title = '全屏预览';
            btnPreview.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8zM1.173 8a13.133 13.133 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.133 13.133 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5c-2.12 0-3.879-1.168-5.168-2.457A13.134 13.134 0 0 1 1.172 8z"/><path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0z"/></svg>';
            btnPreview.addEventListener('click', e => { e.stopPropagation(); const imgEl = el.querySelector('img'); if (imgEl) { showLightbox(imgEl.src); } });
            actions.appendChild(btnPreview);
        }
        const btnTop = document.createElement('button'); btnTop.className = 'ia-btn'; btnTop.title = '置顶';
        btnTop.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M7.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1-.708.708L8 2.707 2.354 8.354a.5.5 0 1 1-.708-.708l6-6z"/><path fill-rule="evenodd" d="M7.646 5.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1-.708.708L8 6.707l-5.646 5.647a.5.5 0 0 1-.708-.708l6-6z"/></svg>';
        const btnUp = document.createElement('button'); btnUp.className = 'ia-btn'; btnUp.title = '上移一层';
        btnUp.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M7.646 4.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1-.708.708L8 5.707l-5.646 5.647a.5.5 0 0 1-.708-.708l6-6z"/></svg>';
        const btnDown = document.createElement('button'); btnDown.className = 'ia-btn'; btnDown.title = '下移一层';
        btnDown.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/></svg>';
        btnTop.addEventListener('click', e => { e.stopPropagation(); bringToTop(item); });
        btnUp.addEventListener('click', e => { e.stopPropagation(); bringForward(item); });
        btnDown.addEventListener('click', e => { e.stopPropagation(); sendBackward(item); });
        actions.appendChild(btnTop); actions.appendChild(btnUp); actions.appendChild(btnDown);

        el.appendChild(rh); el.appendChild(dh); el.appendChild(actions);
        canvas.appendChild(el);

        makeDraggable(el, item);
        makeResizable(el, rh, item);
        dh.addEventListener('click', e => {
            e.stopPropagation();
            recordChange();
            el.remove();
            items = items.filter(i => i.id !== item.id);
            persistState();
        });
        return el;
    }

    function makeDraggable(el, item) {
        let dragging = false, sx, sy, ox, oy, moved = false, snap = null;
        el.addEventListener('pointerdown', e => {
            if (e.button !== 0) { return; }  // ignore right-click
            if (e.target.classList.contains('resize-handle') || e.target.classList.contains('delete-handle') || e.target.closest('button')) { return; }
            snap = snapshot(); moved = false;
            dragging = true; sx = e.clientX; sy = e.clientY; ox = item.x; oy = item.y;
            el.setPointerCapture(e.pointerId); el.classList.add('selected'); e.stopPropagation();
        });
        el.addEventListener('pointermove', e => {
            if (!dragging) { return; }
            if (!moved) { undoStack.push(snap); if (undoStack.length > MAX_HISTORY) { undoStack.shift(); } redoStack = []; syncButtons(); moved = true; }
            item.x = ox + (e.clientX - sx) / scale; item.y = oy + (e.clientY - sy) / scale;
            el.style.left = item.x + 'px'; el.style.top = item.y + 'px';
        });
        el.addEventListener('pointerup', () => { if (dragging) { dragging = false; if (moved) { persistState(); } } });
    }

    function makeResizable(el, handle, item) {
        let resizing = false, sx, sy, ow, oh, moved = false, snap = null;
        handle.addEventListener('pointerdown', e => {
            snap = snapshot(); moved = false;
            resizing = true; sx = e.clientX; sy = e.clientY;
            ow = item.width || el.offsetWidth; oh = item.height || el.offsetHeight;
            handle.setPointerCapture(e.pointerId); e.stopPropagation();
        });
        handle.addEventListener('pointermove', e => {
            if (!resizing) { return; }
            if (!moved) { undoStack.push(snap); if (undoStack.length > MAX_HISTORY) { undoStack.shift(); } redoStack = []; syncButtons(); moved = true; }
            const minW = item.type === 'issue' ? 200 : 80;
            const minH = item.type === 'issue' ? 140 : 60;
            item.width = Math.max(minW, ow + (e.clientX - sx) / scale);
            item.height = Math.max(minH, oh + (e.clientY - sy) / scale);
            el.style.width = item.width + 'px'; el.style.height = item.height + 'px';
        });
        handle.addEventListener('pointerup', () => { if (resizing) { resizing = false; if (moved) { persistState(); } } });
    }

    let panning = false, psx, psy, pcx, pcy;
    viewport.addEventListener('pointerdown', e => {
        if (e.target !== viewport && e.target !== canvas) { return; }
        panning = true; psx = e.clientX; psy = e.clientY; pcx = camX; pcy = camY;
        viewport.classList.add('grabbing'); viewport.setPointerCapture(e.pointerId);
    });
    viewport.addEventListener('pointermove', e => {
        if (!panning) { return; }
        camX = pcx + e.clientX - psx; camY = pcy + e.clientY - psy; applyTransform();
    });
    viewport.addEventListener('pointerup', () => {
        if (panning) { panning = false; viewport.classList.remove('grabbing'); persistState(); }
    });

    viewport.addEventListener('contextmenu', e => { e.preventDefault(); });

    viewport.addEventListener('wheel', e => {
        e.preventDefault();
        const rect = viewport.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const ns = Math.min(Math.max(scale * delta, 0.1), 5);
        camX = mx - (mx - camX) * (ns / scale); camY = my - (my - camY) * (ns / scale);
        scale = ns; applyTransform(); debouncePersist();
    }, { passive: false });

    document.addEventListener('paste', e => {
        const clips = e.clipboardData?.items;
        if (!clips) { return; }
        // text paste → create new Issue markdown
        for (const clip of clips) {
            if (clip.type === 'text/plain') {
                clip.getAsString(text => {
                    const t = text.trim();
                    if (!t) { return; }
                    e.preventDefault();
                    const cx = (viewport.clientWidth / 2 - camX) / scale;
                    const cy = (viewport.clientHeight / 2 - camY) / scale;
                    api.postMessage({ type: 'newIssue', title: t.slice(0, 200), cx, cy });
                });
                return;
            }
        }
        // image paste
        for (const clip of clips) {
            if (clip.type.startsWith('image/')) {
                e.preventDefault();
                const blob = clip.getAsFile();
                if (!blob) { return; }
                const reader = new FileReader();
                reader.onload = () => {
                    const b64 = reader.result.split(',')[1];
                    const cx = (viewport.clientWidth / 2 - camX) / scale;
                    const cy = (viewport.clientHeight / 2 - camY) / scale;
                    api.postMessage({ type: 'saveImage', data: b64, x: cx, y: cy });
                };
                reader.readAsDataURL(blob);
                return;
            }
        }
    });

    viewport.addEventListener('dragover', e => e.preventDefault());
    viewport.addEventListener('drop', e => {
        e.preventDefault();
        const files = e.dataTransfer?.files;
        if (!files) { return; }
        for (const f of files) {
            if (!f.type.startsWith('image/')) { continue; }
            const reader = new FileReader();
            reader.onload = () => {
                const b64 = reader.result.split(',')[1];
                const rect = viewport.getBoundingClientRect();
                const cx = (e.clientX - rect.left - camX) / scale;
                const cy = (e.clientY - rect.top - camY) / scale;
                api.postMessage({ type: 'saveImage', data: b64, fileName: f.name, x: cx, y: cy });
            };
            reader.readAsDataURL(f);
        }
    });

    btnAdd.addEventListener('click', () => {
        api.postMessage({ type: 'pickFiles', cx: (viewport.clientWidth / 2 - camX) / scale, cy: (viewport.clientHeight / 2 - camY) / scale });
    });
    btnAddIssue.addEventListener('click', () => {
        api.postMessage({ type: 'pickIssue', cx: (viewport.clientWidth / 2 - camX) / scale, cy: (viewport.clientHeight / 2 - camY) / scale });
    });
    btnUndo.addEventListener('click', undo);
    btnRedo.addEventListener('click', redo);
    btnZen.addEventListener('click', () => api.postMessage({ type: 'toggleZenMode' }));
    btnClear.addEventListener('click', () => api.postMessage({ type: 'clearBoard' }));
    if (btnZoomOut) {
        btnZoomOut.addEventListener('click', () => {
            const cx = viewport.clientWidth / 2, cy = viewport.clientHeight / 2;
            const ns = Math.max(scale * 0.8, 0.1);
            camX = cx - (cx - camX) * (ns / scale); camY = cy - (cy - camY) * (ns / scale);
            scale = ns; applyTransform(); persistState();
        });
    }
    if (btnZoomIn) {
        btnZoomIn.addEventListener('click', () => {
            const cx = viewport.clientWidth / 2, cy = viewport.clientHeight / 2;
            const ns = Math.min(scale * 1.25, 5);
            camX = cx - (cx - camX) * (ns / scale); camY = cy - (cy - camY) * (ns / scale);
            scale = ns; applyTransform(); persistState();
        });
    }
    if (btnZoom100) {
        btnZoom100.addEventListener('click', () => {
            const cx = viewport.clientWidth / 2, cy = viewport.clientHeight / 2;
            camX = cx - (cx - camX) * (1 / scale); camY = cy - (cy - camY) * (1 / scale);
            scale = 1; applyTransform(); persistState();
        });
    }
    if (btnZoomFit) { btnZoomFit.addEventListener('click', fitToContent); }
    const mmWrap = document.getElementById('minimap-wrap');
    if (mmWrap) {
        let mmDragging = false;
        mmWrap.addEventListener('pointerdown', e => {
            mmDragging = true; mmWrap.setPointerCapture(e.pointerId); navigateMinimap(e); e.stopPropagation();
        });
        mmWrap.addEventListener('pointermove', e => { if (mmDragging) { navigateMinimap(e); } });
        mmWrap.addEventListener('pointerup', () => { if (mmDragging) { mmDragging = false; persistState(); } });
    }
    function navigateMinimap(e) {
        const rect = minimapCanvas.getBoundingClientRect();
        const cx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const cy = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
        const b = getWorldBounds();
        camX = viewport.clientWidth / 2 - (b.minX + cx * (b.maxX - b.minX)) * scale;
        camY = viewport.clientHeight / 2 - (b.minY + cy * (b.maxY - b.minY)) * scale;
        applyTransform();
    }

    document.addEventListener('keydown', e => {
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'z') { e.preventDefault(); undo(); }
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'z') { e.preventDefault(); redo(); }
        if ((e.metaKey || e.ctrlKey) && e.key === 'y') { e.preventDefault(); redo(); }
        if (e.key === 'F11') { e.preventDefault(); api.postMessage({ type: 'toggleZenMode' }); }
        if (e.key === 'Escape') { lightbox.classList.remove('active'); }
    });

    window.addEventListener('message', e => {
        const msg = e.data;
        if (msg.type === 'imageAdded') {
            recordChange();
            const newItem = { type: 'image', id: newId(), filePath: msg.filePath, webviewUri: msg.webviewUri, x: msg.x || 100, y: msg.y || 100, width: 300, height: 200, zIndex: 1 };
            items.push(newItem);
            createEl(newItem);
            persistState();
        } else if (msg.type === 'issueAdded') {
            recordChange();
            const newItem = { type: 'issue', id: newId(), filePath: msg.filePath, title: msg.title, excerpt: msg.excerpt || '', x: msg.x || 100, y: msg.y || 100, width: 300, height: 360, zIndex: 1 };
            items.push(newItem);
            createEl(newItem);
            persistState();
        } else if (msg.type === 'uriResolved') {
            const imgEl = canvas.querySelector('[data-id="' + msg.id + '"] img');
            if (imgEl) { imgEl.src = msg.webviewUri; }
        } else if (msg.type === 'boardCleared') {
            recordChange();
            items = []; canvas.innerHTML = '';
            camX = 0; camY = 0; scale = 1;
            applyTransform(); persistState();
        }
    });

    function persistState() {
        drawMinimap();
        const serialized = items.map(i => {
            if (i.type === 'issue') {
                return { type: 'issue', id: i.id, filePath: i.filePath, title: i.title, excerpt: i.excerpt || '', x: i.x, y: i.y, width: i.width || 300, height: i.height || 360, zIndex: i.zIndex || 1 };
            }
            return { type: 'image', id: i.id, filePath: i.filePath, x: i.x, y: i.y, width: i.width || 300, height: i.height || 200, zIndex: i.zIndex || 1 };
        });
        api.postMessage({ type: 'updateState', canvasX: camX, canvasY: camY, canvasScale: scale, items: serialized });
    }
})();
