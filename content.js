(() => {
  if (globalThis.__webNotesLoaded) return;
  globalThis.__webNotesLoaded = true;
  const A = globalThis.WebNotesAnchors;
  const colors = { yellow: '#f4cb58', green: '#87bca0', blue: '#86b9e6', pink: '#e8a5b5' };
  const host = document.createElement('div');
  host.dataset.webnotesRoot = '';
  host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483646;color-scheme:light';
  document.documentElement.append(host);
  const shadow = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    :host{all:initial}*{box-sizing:border-box}button,textarea{font:inherit}button{cursor:pointer}button:focus-visible{outline:2px solid #36765b;outline-offset:3px}button:disabled{cursor:not-allowed;opacity:.6}
    .toolbar,.panel,.toast,.badge,.pin{font:13px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;pointer-events:auto;color:#243b32}
    .toolbar{position:fixed;display:flex;align-items:center;gap:4px;background:#fffef9;border:1px solid #dfe4da;box-shadow:0 8px 32px #173c2426;padding:7px;border-radius:12px}
    .toolbar button{border:0;background:transparent;border-radius:7px;padding:7px 10px;color:#243b32}.toolbar button:hover{background:#eef1e8}.toolbar .primary{background:#244c3d;color:white}
    .swatch{display:block;flex:0 0 24px;width:24px;height:24px;border-radius:50%!important;padding:0!important;border:2px solid #fffef9!important}.swatch.selected{box-shadow:0 0 0 2px #244c3d}.palette{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin:18px 0;padding:3px 0}.palette .swatch{flex-basis:26px;width:26px;height:26px}.field-label{display:block;font-size:12px;font-weight:600;color:#65776b;margin:0 0 8px}.palette .field-label{margin:0 5px 0 0}.swatch:focus-visible{outline-offset:4px}
    .panel{position:fixed;right:24px;top:24px;width:340px;max-width:calc(100vw - 24px);max-height:calc(100vh - 48px);overflow:auto;background:#fffef9;border:1px solid #dfe4da;box-shadow:0 14px 64px #19332733;border-radius:16px;padding:20px}
    .head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.brand{font-size:16px;font-weight:700;letter-spacing:2px}.muted{color:#7a847b;font-size:12px}.close{border:0;background:transparent;font-size:22px;color:#68766c}
    blockquote{margin:0 0 14px;padding:10px 12px;background:#f6f3e6;border-left:3px solid #e5bf51;max-height:150px;overflow:auto;white-space:pre-wrap;word-break:break-word}
    textarea{display:block;width:100%;min-height:130px;max-height:55vh;resize:vertical;margin:0;padding:12px;border:1px solid #d8ded4;border-radius:9px;background:#fff;color:#243b32;font-size:14px;line-height:1.7;outline:none;appearance:none;transition:border-color .15s,box-shadow .15s}textarea:focus{border-color:#638c75;box-shadow:0 0 0 3px #36765b1f}textarea::placeholder{color:#929c95}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px;align-items:center}.actions button,.row button{border:1px solid #d8ded4;background:#fffef9;color:#254a3a;border-radius:8px;padding:8px 13px}.actions .save{background:#244c3d;color:white;border-color:#244c3d}.actions .danger{color:#a64c41;margin-left:auto}
    .status{font-size:12px;color:#a64c41;min-height:18px;margin-top:8px;white-space:pre-wrap}.status:empty{display:none}.list{display:grid;gap:10px;margin-top:14px}.row{border-top:1px solid #e7e8df;padding-top:12px}.row p{margin:5px 0 8px;overflow-wrap:anywhere;white-space:pre-wrap;max-height:100px;overflow:auto}.row button{font-size:12px;padding:5px 9px}.row .quote{color:#7a847b;font-size:12px}
    .toast{position:fixed;bottom:26px;left:50%;transform:translateX(-50%);max-width:80vw;background:#244c3d;color:white;padding:11px 18px;border-radius:12px;box-shadow:0 5px 25px #0002}
    .badge{position:fixed;right:20px;bottom:20px;border:1px solid #d9dfd3;background:#fffef9;border-radius:30px;padding:9px 15px;box-shadow:0 4px 18px #0001;font-weight:600}
    .marks{position:fixed;inset:0;pointer-events:none}.fallback{position:absolute;pointer-events:none;mix-blend-mode:multiply;opacity:.45;border-radius:2px}.pin{position:absolute;width:16px;height:16px;min-width:16px;border-radius:50%;border:2px solid white;box-shadow:0 1px 5px #0004;padding:0;cursor:pointer}.flash{position:fixed;border:3px solid #327752;border-radius:5px;pointer-events:none;box-shadow:0 0 0 6px #87bca033;transition:opacity .3s}
    @media(max-width:500px){.panel{right:12px;top:12px}.badge{right:12px;bottom:12px}}
  `);
  shadow.adoptedStyleSheets = [sheet];
  const marks = document.createElement('div'); marks.className = 'marks'; shadow.append(marks);
  let notes = [], activeRanges = [], savedSelection = null, toolbar, panel, badge;
  let color = 'yellow', enabled = true, pageUrl = location.href, loading = false, pendingJump = null;
  let mutationTimer, paintFrame, toastTimer, refreshSeq = 0, captureTimer, pendingUntil = 0, pendingTimer;
  const message = async (type, extra = {}) => {
    const result = await chrome.runtime.sendMessage({ type, ...extra });
    if (!result?.ok) throw new Error(result?.error || '扩展连接已断开，请刷新网页后重试。');
    return result;
  };
  function el(tag, cls, text) { const node = document.createElement(tag); if (cls) node.className = cls; if (text) node.textContent = text; return node; }
  function button(text, fn, cls = '') { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function toast(text) { shadow.querySelector('.toast')?.remove(); const t = el('div', 'toast', text); t.setAttribute('role', 'status'); shadow.append(t); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 4000); }
  function position() { return { x: window.scrollX, y: window.scrollY, ratio: window.scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight) }; }
  function selectionIsEditable(selection) {
    const node = selection.anchorNode?.nodeType === 1 ? selection.anchorNode : selection.anchorNode?.parentElement;
    return node?.closest('input,textarea,select,[contenteditable]');
  }
  function clearToolbar() { toolbar?.remove(); toolbar = null; }
  function swatches(parent, selected, onChange) {
    for (const [key, value] of Object.entries(colors)) {
      const b = button('', () => { onChange(key); parent.querySelectorAll('.swatch').forEach(s => { s.classList.toggle('selected', s === b); s.setAttribute('aria-pressed', String(s === b)); }); }, `swatch ${selected === key ? 'selected' : ''}`);
      b.style.background = value; b.setAttribute('aria-label', { yellow: '黄色', green: '绿色', blue: '蓝色', pink: '粉色' }[key]); b.setAttribute('aria-pressed', String(selected === key)); parent.append(b);
    }
  }
  function showSelection() {
    if (!enabled || panel) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed || selectionIsEditable(selection)) { clearToolbar(); return; }
    const range = selection.getRangeAt(0).cloneRange();
    if (!document.body.contains(range.commonAncestorContainer)) return;
    try {
      const anchor = A.serialize(range);
      savedSelection = { anchor, range, position: position(), url: location.href, title: document.title };
      clearToolbar(); toolbar = el('div', 'toolbar');
      toolbar.addEventListener('pointerdown', e => e.preventDefault());
      swatches(toolbar, color, v => { color = v; });
      toolbar.append(button('高亮', () => saveSelection()), button('写笔记 ↗', () => openEditor(null, savedSelection), 'primary'));
      shadow.append(toolbar);
      const rect = range.getBoundingClientRect();
      toolbar.style.left = `${Math.max(8, Math.min(innerWidth - toolbar.offsetWidth - 8, rect.left))}px`;
      toolbar.style.top = `${Math.max(8, Math.min(innerHeight - toolbar.offsetHeight - 8, rect.bottom + 8))}px`;
    } catch (err) { clearToolbar(); if (selection.toString().length > 20000) toast(err.message); }
  }
  async function saveSelection() {
    const item = savedSelection;
    if (!item) return;
    const b = toolbar?.querySelector('button:not(.swatch)'); if (b) b.disabled = true;
    try {
      await message('WN_SAVE', { note: { type: 'highlight', url: item.url, title: item.title, quote: item.anchor.exact, anchor: item.anchor, position: item.position, note: '', color } });
      clearToolbar(); window.getSelection()?.removeAllRanges(); await refresh(); toast('重点已保存，再访网页时会自动恢复高亮。');
    } catch (err) { toast(err.message); if (b) b.disabled = false; }
  }
  function closePanel() { panel?.remove(); panel = null; }
  function basePanel(label) {
    clearToolbar(); closePanel(); panel = el('section', 'panel'); panel.setAttribute('aria-label', label);
    const head = el('div', 'head'); const close = button('×', closePanel, 'close'); close.setAttribute('aria-label', '关闭笔记面板'); head.append(el('span', 'brand', label), close); panel.append(head); shadow.append(panel); return panel;
  }
  function openEditor(existing = null, selected = null) {
    const sourceUrl = selected?.url || location.href, sourceTitle = selected?.title || document.title;
    const p = basePanel(existing ? '编辑拾页' : '新建拾页');
    const quote = existing?.quote || selected?.anchor.exact;
    if (quote) p.append(el('blockquote', '', quote));
    else p.append(el('p', 'muted', '记录当前页面的想法，原文链接与阅读位置会一并保存。'));
    const palette = el('div', 'palette'); palette.setAttribute('role', 'group'); palette.setAttribute('aria-label', '标记颜色'); palette.append(el('span', 'field-label', '标记颜色')); let noteColor = existing?.color || color;
    swatches(palette, noteColor, value => { noteColor = value; }); p.append(palette);
    const input = el('textarea'); input.id = 'webnotes-note-content'; input.placeholder = '此刻的想法，留给以后的自己…'; input.maxLength = 100000; input.value = existing?.note || ''; input.setAttribute('aria-label', '笔记内容'); const fieldLabel = el('label', 'field-label', '笔记内容'); fieldLabel.htmlFor = input.id; p.append(fieldLabel, input);
    const status = el('div', 'status'); status.setAttribute('role', 'status');
    const actions = el('div', 'actions'); const save = button('保存拾页', async () => {
      if (!quote && !input.value.trim()) { status.textContent = '请写一点笔记。'; input.focus(); return; }
      save.disabled = true; status.textContent = '正在保存…';
      try {
        await message('WN_SAVE', { note: existing ? { ...existing, note: input.value.trim(), color: noteColor } : { type: selected ? 'highlight' : 'page', url: sourceUrl, title: sourceTitle, quote: quote || '', note: input.value.trim(), color: noteColor, ...(selected ? { anchor: selected.anchor } : {}), position: selected?.position || position() } });
        closePanel(); window.getSelection()?.removeAllRanges(); await refresh(); toast('拾页已保存在本机。');
      } catch (err) { status.textContent = err.message; save.disabled = false; }
    }, 'save'); actions.append(save, button('取消', closePanel));
    if (existing) actions.append(button('删除', async () => {
      if (!confirm('删除这条拾页？此操作无法撤销。')) return;
      try { await message('WN_DELETE', { id: existing.id }); closePanel(); await refresh(); toast('拾页已删除。'); } catch (err) { status.textContent = err.message; }
    }, 'danger'));
    p.append(actions, status); input.focus();
    input.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') save.click(); });
  }
  function showList() {
    const p = basePanel('此页笔记'); p.append(el('div', 'muted', `${notes.length} 条记录 · 保存在浏览器本地`));
    const actions = el('div', 'actions'); actions.append(button('＋ 页面笔记', () => openEditor()), button('笔记库 ↗', () => chrome.runtime.sendMessage({ type: 'WN_OPEN_LIBRARY' }))); p.append(actions);
    if (!notes.length) p.append(el('p', 'muted', '选中正文后即可高亮或写笔记。'));
    const list = el('div', 'list');
    for (const note of notes) {
      const row = el('div', 'row'); row.append(el('span', 'muted', `${{ highlight: '文字高亮', page: '页面笔记', screenshot: '网页截图' }[note.type]} · ${new Date(note.createdAt).toLocaleDateString('zh-CN')}`));
      if (note.quote) row.append(el('p', 'quote', note.quote)); if (note.note) row.append(el('p', '', note.note));
      if (note.type === 'screenshot') row.append(el('p', 'muted', '截图可在笔记库中预览和下载。'));
      row.append(button('回到位置', () => { closePanel(); jump(note); }), document.createTextNode(' '), button('编辑', () => openEditor(note))); list.append(row);
    }
    p.append(list);
  }
  function updateBadge() {
    badge?.remove(); badge = null;
    if (notes.length) { badge = button(`拾页 · ${notes.length}`, showList, 'badge'); shadow.append(badge); }
  }
  function clearHighlights() { for (const key of Object.keys(colors)) CSS.highlights?.delete(`webnotes-${key}`); marks.replaceChildren(); activeRanges = []; }
  function restore() {
    clearHighlights(); if (!enabled || !notes.length) return;
    const data = A.index(), groups = {};
    for (const note of notes) {
      if (!note.anchor) continue;
      const range = A.range(note.anchor, data);
      if (range) { activeRanges.push({ note, range }); (groups[note.color] ||= []).push(range); }
    }
    if (globalThis.Highlight && CSS.highlights) {
      for (const [key, ranges] of Object.entries(groups)) CSS.highlights.set(`webnotes-${key}`, new Highlight(...ranges));
    }
    paint();
    tryPendingJump();
  }
  function paint() {
    marks.replaceChildren(); if (!enabled) return;
    const fallback = !globalThis.Highlight || !CSS.highlights;
    for (const { note, range } of activeRanges) {
      let rects;
      try { rects = [...range.getClientRects()].filter(r => r.width && r.height); } catch { continue; }
      const visible = rects.filter(r => r.bottom > 0 && r.top < innerHeight);
      if (fallback) for (const r of visible) { const h = el('div', 'fallback'); h.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;background:${colors[note.color]}`; marks.append(h); }
      if (visible[0]) { const r = visible[0]; const pin = button('', () => openEditor(note), 'pin'); pin.title = note.note || '查看或编辑拾页'; pin.setAttribute('aria-label', pin.title); pin.style.cssText = `left:${Math.max(0, Math.min(innerWidth - 20, r.right + 3))}px;top:${Math.max(0, r.top)}px;background:${colors[note.color]}`; marks.append(pin); }
    }
  }
  async function refresh() {
    const seq = ++refreshSeq;
    try {
      const result = await message('WN_LIST', { url: location.href });
      if (seq !== refreshSeq) return;
      notes = result.notes; updateBadge(); restore();
    } catch (err) { if (loading) toast(err.message); }
  }
  function tryPendingJump() {
    if (!pendingJump) return;
    const note = notes.find(n => n.id === pendingJump);
    if (!note) { pendingJump = null; return; }
    if (!note.anchor || activeRanges.some(item => item.note.id === note.id) || Date.now() >= pendingUntil) {
      pendingJump = null; clearTimeout(pendingTimer); jump(note);
    }
  }
  function jump(note) {
    const range = note.anchor && A.range(note.anchor);
    if (range) {
      range.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(() => {
        const rect = range.getBoundingClientRect(); const flash = el('div', 'flash'); flash.style.cssText = `left:${rect.left - 4}px;top:${rect.top - 4}px;width:${rect.width + 8}px;height:${rect.height + 8}px`; shadow.append(flash); setTimeout(() => flash.remove(), 2200);
      }, 400);
      toast(note.note || '已定位到原文标记。');
    } else {
      const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
      const y = Math.min(max, note.position?.y ?? (note.position?.ratio || 0) * max);
      scrollTo({ left: note.position?.x || 0, top: y, behavior: 'smooth' });
      toast(note.anchor ? '原文可能已改动，已回到保存时的页面位置。' : '已回到保存时的页面位置。');
    }
  }
  document.addEventListener('mouseup', e => { if (e.composedPath().includes(host)) return; setTimeout(showSelection, 20); });
  document.addEventListener('keyup', e => { if (e.key === 'Shift' || e.key.startsWith('Arrow')) showSelection(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { clearToolbar(); closePanel(); } });
  document.addEventListener('pointerdown', e => { if (!e.composedPath().includes(host)) clearToolbar(); });
  document.addEventListener('scroll', () => { clearToolbar(); cancelAnimationFrame(paintFrame); paintFrame = requestAnimationFrame(paint); }, { passive: true, capture: true });
  window.addEventListener('resize', () => { clearToolbar(); paint(); });
  const observer = new MutationObserver(records => {
    if (records.every(r => r.target === host || r.target === document.documentElement && [...r.addedNodes, ...r.removedNodes].every(n => n === host))) return;
    clearTimeout(mutationTimer); mutationTimer = setTimeout(restore, 350);
  }); observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  // pushState navigation does not notify isolated content scripts; track URL changes too.
  setInterval(() => { if (location.href !== pageUrl) { pageUrl = location.href; savedSelection = null; closePanel(); clearToolbar(); refresh(); } }, 800);
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return;
    if (msg.type === 'WN_PREPARE_CAPTURE') {
      host.style.visibility = 'hidden'; for (const key of Object.keys(colors)) CSS.highlights?.delete(`webnotes-${key}`);
      clearTimeout(captureTimer); captureTimer = setTimeout(() => { host.style.visibility = ''; restore(); }, 5000);
      requestAnimationFrame(() => requestAnimationFrame(() => reply({ url: location.href, title: document.title, position: position(), viewport: { width: innerWidth, height: innerHeight } })));
      return true;
    }
    if (msg.type === 'WN_FINISH_CAPTURE') { clearTimeout(captureTimer); host.style.visibility = ''; restore(); reply({ ok: true }); }
    if (msg.type === 'WN_NEW_PAGE') { openEditor(); reply({ ok: true }); }
    if (msg.type === 'WN_SHOW_LIST') { showList(); reply({ ok: true }); }
    if (msg.type === 'WN_JUMP') { const n = notes.find(n => n.id === msg.id); if (n) jump(n); reply({ ok: true }); }
    if (msg.type === 'WN_REFRESH') { refresh(); reply({ ok: true }); }
    if (msg.type === 'WN_TOGGLE') { enabled = !enabled; clearToolbar(); restore(); reply({ ok: true, enabled }); }
    if (msg.type === 'WN_PING') reply({ ok: true, enabled, count: notes.length });
  });
  loading = true;
  message('WN_PENDING').then(result => {
    pendingJump = result.id || null;
    pendingUntil = Date.now() + 10000;
    if (pendingJump) pendingTimer = setTimeout(tryPendingJump, 10100);
    return refresh();
  }).catch(() => refresh()).finally(() => { loading = false; });
})();
