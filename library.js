import { icon, sourceIcon } from './ui-icons.js';

const $ = (selector) => document.querySelector(selector);
const labels = { all: '全部笔记', highlight: '文字高亮', page: '页面笔记', screenshot: '网页截图' };
const typeIcons = { highlight: 'highlighter', page: 'note', screenshot: 'image' };
const colors = new Set(['yellow', 'green', 'blue', 'pink']);
const state = { notes: [], type: 'all', site: '', query: '', sort: 'updated', current: null, refreshing: false, refreshPending: false, notesRevision: 0 };
let toastTimer;
let refreshTimer;
let importBusy = false;
let detailBusy = false;

async function request(type, data = {}) {
  if (!globalThis.chrome?.runtime?.sendMessage) throw new Error('请在浏览器已安装的「拾页」扩展中打开笔记库。');
  // 受信扩展页面直接读取，避免截图累积后突破扩展消息的 64 MiB 上限。
  if (type === 'WN_LIST') {
    const { notes } = await chrome.storage.local.get('notes');
    if (notes === undefined) return { ok: true, notes: [] };
    if (!Array.isArray(notes)) throw new Error('本地笔记数据异常，请先保留浏览器配置并恢复 JSON 备份。');
    return { ok: true, notes };
  }
  const response = await chrome.runtime.sendMessage({ type, ...data });
  if (!response?.ok) throw new Error(response?.error || '操作未完成，请稍后重试。');
  return response;
}

function notify(message, error = false) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.toggle('error', error);
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, error ? 6500 : 3500);
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (['https:', 'http:'].includes(url.protocol)) return url;
    if (url.protocol === 'file:' && !url.hostname && url.pathname.startsWith('/')) return url;
    return null;
  } catch { return null; }
}

function siteOf(note) {
  const url = safeUrl(note.url);
  return url?.protocol === 'file:' ? '本地文件' : url?.hostname || '未知来源';
}
function imageIsSafe(value) { return typeof value === 'string' && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=\r\n]+$/.test(value); }
function dateOf(value, long = false) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '未知日期';
  return new Intl.DateTimeFormat('zh-CN', long ? { dateStyle: 'medium', timeStyle: 'short' } : { month: 'short', day: 'numeric' }).format(date);
}
function timeOf(value) { return new Date(value).getTime() || 0; }
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function refresh() {
  state.refreshPending = true;
  if ($('#detail-dialog').open || state.refreshing) return;
  state.refreshing = true;
  try {
    do {
      state.refreshPending = false;
      const revision = state.notesRevision;
      try {
        const { notes } = await request('WN_LIST');
        // 读取期间发生本地写入或新刷新请求时，丢弃旧快照并重新读取。
        if (revision !== state.notesRevision || state.refreshPending || $('#detail-dialog').open) {
          state.refreshPending = true;
          continue;
        }
        state.notes = Array.isArray(notes) ? notes : [];
        $('#loading').hidden = true;
        render();
      } catch (error) {
        if (revision !== state.notesRevision || state.refreshPending || $('#detail-dialog').open) {
          state.refreshPending = true;
          continue;
        }
        $('#loading').hidden = true;
        $('#empty').hidden = false;
        $('#empty-title').textContent = '暂时无法读取笔记';
        $('#empty-description').textContent = error.message;
        $('#result-count').textContent = '读取失败';
        notify(error.message, true);
      }
    } while (state.refreshPending && !$('#detail-dialog').open);
  } finally { state.refreshing = false; }
}

function render() {
  const sites = new Map();
  const counts = { all: state.notes.length, highlight: 0, page: 0, screenshot: 0 };
  for (const note of state.notes) {
    if (Object.hasOwn(counts, note.type)) counts[note.type]++;
    const site = siteOf(note);
    sites.set(site, (sites.get(site) || 0) + 1);
  }
  for (const [type, count] of Object.entries(counts)) $(`#count-${type}`).textContent = String(count);
  $('#stat-total').textContent = String(counts.all);
  $('#stat-sites').textContent = String(sites.size);
  $('#stat-images').textContent = String(counts.screenshot);
  renderSites(sites);
  $('#page-title').textContent = state.type === 'all' ? '我的笔记' : labels[state.type];
  $('#results-title').textContent = state.site ? `${state.site} · ${labels[state.type]}` : labels[state.type];
  const query = state.query.trim().toLocaleLowerCase();
  const visible = state.notes.filter((note) => {
    if (state.type !== 'all' && note.type !== state.type) return false;
    if (state.site && siteOf(note) !== state.site) return false;
    return !query || [note.title, note.quote, note.note, note.url].some(value => String(value || '').toLocaleLowerCase().includes(query));
  }).sort((a, b) => state.sort === 'oldest' ? timeOf(a.createdAt) - timeOf(b.createdAt) : timeOf(b[state.sort === 'created' ? 'createdAt' : 'updatedAt']) - timeOf(a[state.sort === 'created' ? 'createdAt' : 'updatedAt']));
  $('#result-count').textContent = `${visible.length} 条记录`;
  const filtered = state.type !== 'all' || Boolean(state.site) || Boolean(query);
  $('#reset-filters').hidden = !filtered;
  $('#empty').hidden = visible.length !== 0;
  $('#empty-title').textContent = filtered ? '还没有找到相关笔记' : '第一条笔记，从下一次阅读开始';
  $('#empty-description').textContent = filtered ? '试试其他关键词，或清除筛选条件。' : '打开任意文章，选中一段文字，用「拾页」记下重点与想法。\n也可以点击扩展图标，保存整页笔记或截图。';
  $('#empty-reset').hidden = !filtered;
  $('#note-grid').replaceChildren(...visible.map(renderCard));
}

function renderSites(sites) {
  $('#clear-site').hidden = !state.site;
  if (!sites.size) {
    $('#site-list').replaceChildren(el('p', 'no-sites', '收藏后会在这里归档'));
    return;
  }
  const representatives = new Map();
  for (const note of state.notes) {
    const site = siteOf(note);
    if (!representatives.has(site)) representatives.set(site, note);
  }
  const buttons = [...sites.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([site, count]) => {
    const button = el('button', `site-button${site === state.site ? ' selected' : ''}`);
    button.title = site;
    button.setAttribute('aria-pressed', String(site === state.site));
    button.append(sourceIcon(representatives.get(site), 'site-icon'), el('span', 'site-name', site), el('span', 'site-count', String(count)));
    button.addEventListener('click', () => { state.site = state.site === site ? '' : site; render(); });
    return button;
  });
  $('#site-list').replaceChildren(...buttons);
}

function renderCard(note) {
  const color = colors.has(note.color) ? note.color : 'yellow';
  const card = el('article', `note-card ${color}`);
  const top = el('div', 'card-top');
  const typeTag = el('span', `type-tag ${note.type}`);
  typeTag.append(icon(typeIcons[note.type] || 'note'), document.createTextNode(labels[note.type] || '笔记'));
  top.append(typeTag, el('time', 'card-date', dateOf(note.createdAt)));
  const heading = el('h3', 'card-title');
  const title = el('button', '', note.title || '未命名网页');
  title.addEventListener('click', () => openDetail(note));
  heading.append(title);
  card.append(top, heading);
  if (note.type === 'screenshot' && imageIsSafe(note.image)) {
    const button = el('button', 'card-image-button');
    button.setAttribute('aria-label', `查看截图：${note.title || '网页截图'}`);
    const image = el('img');
    image.loading = 'lazy';
    image.src = note.image;
    image.alt = note.title || '网页截图';
    button.append(image);
    button.addEventListener('click', () => openDetail(note));
    card.append(button);
  }
  if (note.quote) card.append(el('blockquote', 'card-quote', note.quote));
  card.append(el('p', `card-note${note.note ? '' : ' card-note-placeholder'}`, note.note || '点击标题，补充你的想法…'));
  const bottom = el('div', 'card-bottom');
  const source = el('div', 'card-source');
  source.title = note.url || '';
  source.append(sourceIcon(note, 'source-icon'), el('span', '', siteOf(note)));
  const jump = el('button', 'source-button', '回到原文 ↗');
  jump.addEventListener('click', () => openSource(note, jump));
  bottom.append(source, jump);
  card.append(bottom);
  return card;
}

function selectedColor() { return $('input[name="color"]:checked')?.value || 'yellow'; }
function isDirty() { return state.current && ($('#detail-note').value !== (state.current.note || '') || selectedColor() !== (state.current.color || 'yellow')); }

function openDetail(note) {
  state.current = note;
  $('#detail-title').textContent = note.title || '未命名网页';
  $('#detail-kind').className = `type-tag ${note.type}`;
  $('#detail-kind').replaceChildren(icon(typeIcons[note.type] || 'note'), document.createTextNode(labels[note.type] || '笔记'));
  const sourceUrl = safeUrl(note.url);
  $('#detail-url').textContent = note.url || '';
  $('#detail-url').title = sourceUrl?.protocol === 'file:' ? '本地文件 · 点击回到原文位置（需要允许扩展访问文件网址）' : note.url || '';
  if (sourceUrl) $('#detail-url').href = sourceUrl.href;
  else $('#detail-url').removeAttribute('href');
  $('#detail-date').textContent = `收藏于 ${dateOf(note.createdAt, true)} · 更新于 ${dateOf(note.updatedAt, true)}`;
  $('#detail-quote').hidden = !note.quote;
  $('#detail-quote').textContent = note.quote || '';
  $('#detail-quote').className = `detail-quote ${colors.has(note.color) ? note.color : 'yellow'}`;
  const hasImage = note.type === 'screenshot' && imageIsSafe(note.image);
  $('#detail-image-wrap').hidden = !hasImage;
  if (hasImage) {
    $('#detail-image').src = note.image;
    // Use a download link because Chromium blocks top-level navigation to data URLs.
    $('#detail-image-link').href = note.image;
    $('#detail-image-link').download = screenshotFilename(note).replace(/\.png$/, note.image.startsWith('data:image/jpeg;') ? '.jpg' : '.png');
    $('#detail-image-link').title = '下载原始截图';
  } else {
    $('#detail-image').removeAttribute('src');
    $('#detail-image-link').removeAttribute('href');
  }
  $('#detail-note').value = note.note || '';
  for (const radio of document.querySelectorAll('input[name="color"]')) radio.checked = radio.value === (colors.has(note.color) ? note.color : 'yellow');
  $('#detail-error').hidden = true;
  $('#detail-dialog').showModal();
  $('#close-detail').focus();
}

function closeDetail() {
  if (detailBusy) return;
  if (isDirty() && !confirm('笔记还没有保存，确定关闭并放弃这次修改吗？')) return;
  $('#detail-dialog').close();
}

async function openSource(note, button) {
  if (!safeUrl(note.url)) return notify('这条笔记的来源地址无效。', true);
  if (button) button.disabled = true;
  try { await request('WN_OPEN_NOTE', { id: note.id }); }
  catch (error) { notify(error.message, true); }
  finally { if (button) button.disabled = false; }
}

function setDetailBusy(busy) {
  detailBusy = busy;
  for (const id of ['save-note', 'delete-note', 'close-detail', 'open-source']) $(`#${id}`).disabled = busy;
  $('#detail-note').disabled = busy;
  for (const radio of document.querySelectorAll('input[name="color"]')) radio.disabled = busy;
  $('#save-note').textContent = busy ? '处理中…' : '保存笔记';
}

async function saveNote() {
  if (!state.current || detailBusy) return;
  const note = { ...state.current, note: $('#detail-note').value, color: selectedColor() };
  setDetailBusy(true);
  try {
    const result = await request('WN_SAVE', { note });
    // 写入已确认，先更新卡片与搜索索引；后台的轻量响应省略图片。
    state.current = { ...note, ...result.note };
    state.notesRevision++;
    state.notes = [state.current, ...state.notes.filter(item => item.id !== state.current.id)];
    render();
    $('#detail-dialog').close();
    notify('笔记已保存');
  } catch (error) {
    $('#detail-error').hidden = false;
    $('#detail-error').textContent = error.message;
  } finally { setDetailBusy(false); }
}

async function deleteNote() {
  if (!state.current || detailBusy) return;
  if (!confirm('确定删除这条笔记吗？已导出的备份文件不会受到影响。')) return;
  setDetailBusy(true);
  try {
    const id = state.current.id;
    await request('WN_DELETE', { id });
    state.notesRevision++;
    state.notes = state.notes.filter(note => note.id !== id);
    render();
    state.current = null;
    $('#detail-dialog').close();
    notify('笔记已删除');
  } catch (error) {
    $('#detail-error').hidden = false;
    $('#detail-error').textContent = error.message;
  } finally { setDetailBusy(false); }
}

function dateStamp() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = el('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function screenshotFilename(note) { return `拾页-截图-${String(note.id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 50) || dateStamp()}.png`; }
async function downloadScreenshot() {
  const note = state.current;
  if (!note || !imageIsSafe(note.image)) return;
  try {
    const blob = await (await fetch(note.image)).blob();
    const extension = blob.type === 'image/jpeg' ? '.jpg' : '.png';
    downloadBlob(blob, screenshotFilename(note).replace(/\.png$/, extension));
    notify('已开始下载截图');
  } catch (error) { notify(`截图下载失败：${error.message}`, true); }
}

function escapeMarkdown(value) { return String(value || '').replace(/[\\`*_[\]<>#]/g, '\\$&'); }
function toMarkdown(notes) {
  const lines = ['# 拾页 · 我的网页笔记', '', `导出时间：${dateOf(new Date(), true)}`, `共 ${notes.length} 条记录`, ''];
  for (const note of notes) {
    lines.push(`## ${escapeMarkdown(note.title || '未命名网页')}`, '', `- 类型：${labels[note.type] || '笔记'}`, `- 收藏时间：${dateOf(note.createdAt, true)}`, `- 更新时间：${dateOf(note.updatedAt, true)}`);
    const url = safeUrl(note.url);
    if (url) {
      const localFile = url.protocol === 'file:';
      if (localFile) lines.push('- 来源：本地文件（需要在原设备保留文件）');
      lines.push(`- 原文：[${localFile ? '打开本地文件' : '打开网页'}](<${url.href.replace(/</g, '%3C').replace(/>/g, '%3E')}>)`);
    }
    if (note.position && Number.isFinite(note.position.y)) lines.push(`- 页面位置：距顶部约 ${Math.round(note.position.y)} px`);
    if (note.anchor?.exact) lines.push(`- 定位原文：${escapeMarkdown(note.anchor.exact).replace(/\n/g, ' ')}`);
    lines.push('');
    if (note.quote) lines.push(...String(note.quote).split(/\r?\n/).map(line => `> ${escapeMarkdown(line)}`), '');
    if (note.note) lines.push(escapeMarkdown(note.note), '');
    if (note.type === 'screenshot') lines.push('📷 此记录含截图。请在笔记详情中单独下载图片；JSON 完整备份包含截图。', '');
    lines.push('---', '');
  }
  return lines.join('\n');
}

async function exportNotes(format) {
  closeExportMenu();
  try {
    const { notes } = await request('WN_LIST');
    if (!Array.isArray(notes) || !notes.length) return notify('还没有可导出的笔记');
    if (format === 'json') {
      const json = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), notes }, null, 2);
      downloadBlob(new Blob([json], { type: 'application/json;charset=utf-8' }), `拾页-完整备份-${dateStamp()}.json`);
    } else {
      downloadBlob(new Blob([toMarkdown(notes)], { type: 'text/markdown;charset=utf-8' }), `拾页-我的笔记-${dateStamp()}.md`);
    }
    notify(`已导出全部 ${notes.length} 条笔记${format === 'json' ? '（包含截图）' : ''}`);
  } catch (error) { notify(`导出失败：${error.message}`, true); }
}

async function importFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file || importBusy) return;
  if (file.size > 150 * 1024 * 1024) return notify('备份文件过大，请选择不超过 150 MiB 的 JSON 文件。本地笔记库上限为 140 MiB。', true);
  importBusy = true;
  let stagingKey;
  for (const id of ['import-button', 'import-sidebar']) $(`#${id}`).disabled = true;
  notify('正在读取并检查备份… 本地笔记库上限为 140 MiB。');
  try {
    let payload;
    try { payload = JSON.parse(await file.text()); }
    catch { throw new Error('文件不是有效的 JSON 备份。'); }
    if (payload?.version !== 1 || !Array.isArray(payload.notes)) throw new Error('请选择拾页导出的 JSON 完整备份（version: 1）。');
    // 大备份先暂存，由后台校验后合并；跨上下文只传小体积的键名。
    stagingKey = `import:${crypto.randomUUID()}`;
    await chrome.storage.local.set({ [stagingKey]: payload });
    const result = await request('WN_IMPORT_STAGED', { key: stagingKey });
    await refresh();
    notify(`导入完成，已合并 ${result.count ?? payload.notes.length} 条记录；相同 ID 保留较新版本。`);
  } catch (error) { notify(`导入失败：${error.message}`, true); }
  finally {
    if (stagingKey) {
      try { await chrome.storage.local.remove(stagingKey); }
      catch { /* 后台同样会清理暂存项，清理失败不覆盖导入结果。 */ }
    }
    importBusy = false;
    for (const id of ['import-button', 'import-sidebar']) $(`#${id}`).disabled = false;
  }
}

function resetFilters() {
  state.type = 'all'; state.site = ''; state.query = '';
  $('#search').value = '';
  for (const button of document.querySelectorAll('#type-nav button')) {
    button.classList.toggle('selected', button.dataset.type === 'all');
    button.setAttribute('aria-pressed', String(button.dataset.type === 'all'));
  }
  render();
}
function closeExportMenu() { $('#export-menu').hidden = true; $('#export-button').setAttribute('aria-expanded', 'false'); }

for (const button of document.querySelectorAll('#type-nav button')) {
  button.setAttribute('aria-pressed', String(button.dataset.type === state.type));
  button.addEventListener('click', () => {
    state.type = button.dataset.type;
    for (const sibling of document.querySelectorAll('#type-nav button')) {
      sibling.classList.toggle('selected', sibling === button);
      sibling.setAttribute('aria-pressed', String(sibling === button));
    }
    render();
  });
}
$('#search').addEventListener('input', event => { state.query = event.target.value; render(); });
$('#sort').addEventListener('change', event => { state.sort = event.target.value; render(); });
$('#clear-site').addEventListener('click', () => { state.site = ''; render(); });
for (const id of ['reset-filters', 'empty-reset']) $(`#${id}`).addEventListener('click', resetFilters);
for (const id of ['import-button', 'import-sidebar']) $(`#${id}`).addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', importFile);
$('#export-button').addEventListener('click', () => {
  const hidden = !$('#export-menu').hidden;
  $('#export-menu').hidden = hidden;
  $('#export-button').setAttribute('aria-expanded', String(!hidden));
});
$('#export-json').addEventListener('click', () => exportNotes('json'));
$('#export-markdown').addEventListener('click', () => exportNotes('markdown'));
document.addEventListener('click', event => { if (!event.target.closest('.export-wrap')) closeExportMenu(); });
$('#close-detail').addEventListener('click', closeDetail);
$('#detail-dialog').addEventListener('cancel', event => { event.preventDefault(); closeDetail(); });
$('#detail-dialog').addEventListener('close', () => { state.current = null; refresh(); });
$('#save-note').addEventListener('click', saveNote);
$('#delete-note').addEventListener('click', deleteNote);
$('#open-source').addEventListener('click', () => { if (state.current) openSource(state.current, $('#open-source')); });
$('#detail-url').addEventListener('click', event => {
  if (state.current && safeUrl(state.current.url)?.protocol === 'file:') {
    // Chrome 对扩展页面直接导航到 file: 有限制，通过后台定位并检查文件访问授权。
    event.preventDefault();
    void openSource(state.current);
  }
});
$('#download-image').addEventListener('click', downloadScreenshot);
document.addEventListener('keydown', event => {
  if (event.key === '/' && !$('#detail-dialog').open && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
    event.preventDefault(); $('#search').focus();
  }
  if (event.key === 'Escape') closeExportMenu();
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && $('#detail-dialog').open) { event.preventDefault(); saveNote(); }
});
globalThis.chrome?.storage?.onChanged?.addListener((changes, area) => {
  if (area !== 'local' || !Object.hasOwn(changes, 'notes')) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 120);
});
void refresh();
