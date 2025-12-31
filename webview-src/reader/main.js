(function () {
  const vscode = acquireVsCodeApi();

  const $ = sel => document.querySelector(sel);
  $('#load').addEventListener('click', () => loadUrl());
  $('#url').addEventListener('keydown', e => { if (e.key === 'Enter') loadUrl(); });
  $('#ask').addEventListener('click', () => {
    const prompt = $('#prompt').value.trim();
    if (!prompt) return;
    vscode.postMessage({ command: 'llm', prompt });
  });

  function loadUrl() {
    const url = $('#url').value.trim();
    if (!url) return;
    $('#info').textContent = '加载中...';
    $('#segments').innerHTML = '';
    vscode.postMessage({ command: 'fetchArticle', url });
  }

  window.addEventListener('message', event => {
    const msg = event.data;
    if (msg.type === 'article') {
      const a = msg.payload;
      $('#info').textContent = `标题：${a.title}`;
      const segs = a.segments || [];
      const container = $('#segments');
      container.innerHTML = '';
      segs.forEach((s, i) => {
        const el = document.createElement('div');
        el.className = 'segment';
        el.innerHTML = `<div class="seg-index">${i+1}</div><div class="seg-text">${escapeHtml(s)}</div><div class="seg-actions"><button data-idx="${i}">翻译</button></div>`;
        container.appendChild(el);
      });
      container.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', e => {
          const idx = e.currentTarget.getAttribute('data-idx');
          const text = segs[idx];
          $('#prompt').value = `请把下面这段翻译成中文并解释要点：\n${text}`;
        });
      });
    } else if (msg.type === 'llmResult') {
      const p = msg.payload;
      const container = $('#answer');
      if (p && typeof p === 'object') {
        const translation = p.translation || '';
        const explanation = p.explanation || '';
        const keyPoints = Array.isArray(p.keyPoints) ? p.keyPoints : [];
        const difficulty = p.difficulty || '';
        container.innerHTML = '';
        const tEl = document.createElement('div');
        tEl.innerHTML = `<h4>翻译</h4><div class="translation">${escapeHtml(translation)}</div>`;
        const eEl = document.createElement('div');
        eEl.innerHTML = `<h4>解释</h4><div class="explanation">${escapeHtml(explanation)}</div>`;
        const kEl = document.createElement('div');
        kEl.innerHTML = `<h4>要点</h4><ul>${keyPoints.map(k=>`<li>${escapeHtml(k)}</li>`).join('')}</ul>`;
        const dEl = document.createElement('div');
        dEl.innerHTML = `<h4>难度</h4><div>${escapeHtml(difficulty)}</div>`;
        container.appendChild(tEl);
        container.appendChild(eEl);
        container.appendChild(kEl);
        container.appendChild(dEl);
      } else {
        container.textContent = p;
      }
    } else if (msg.type === 'error') {
      $('#info').textContent = '错误：' + msg.message;
    }
  });

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  }
})();
