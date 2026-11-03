import { describePage, withTimeout } from './page-access.js';
const $ = id => document.getElementById(id);
const pageActions = ['new-note', 'capture', 'page-notes', 'toggle'];
let tab, available = false, initializing = false, acting = false;
const status = text => { $('status').textContent = text; };
function enablePageActions(enabled) {
  available = enabled;
  for (const id of pageActions) $(id).disabled = !enabled;
}
function help(title, description) {
  $('access-title').textContent = title; $('access-description').textContent = description; $('access-help').hidden = false;
}
async function runtime(type, extra = {}) {
  const result = await withTimeout(chrome.runtime.sendMessage({ type, ...extra }), type === 'WN_CAPTURE' ? 25000 : 8000, '扩展响应超时，请重新加载拾页后重试。');
  if (!result?.ok) throw new Error(result?.error || '操作失败，请刷新网页后重试。');
  return result;
}
async function send(type) {
  if (!tab?.id) throw new Error('请先打开普通网页或本地 HTML。');
  const talk = async () => {
    const result = await withTimeout(chrome.tabs.sendMessage(tab.id, { type }), 5000);
    if (!result?.ok) throw new Error(result?.error || '页面未就绪，请刷新后重试。');
    return result;
  };
  try { return await talk(); }
  catch (error) {
    // Only a missing receiver permits reinjection; a timeout must not repeat an action.
    if (!/Receiving end|Could not establish connection|message port closed/i.test(error.message)) throw error;
    await withTimeout(chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content.css'] }), 5000);
    await withTimeout(chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['anchors.js', 'content.js'] }), 5000);
    return talk();
  }
}
async function action(id, fn) {
  if (!available || acting) return;
  acting = true; const b = $(id); pageActions.map($).forEach(c => { c.disabled = true; });
  b.setAttribute('aria-busy', 'true'); status('');
  try { await fn(); } catch (err) { status(err.message || '无法访问此页面，请刷新后重试。'); }
  finally { acting = false; b.removeAttribute('aria-busy'); enablePageActions(available); }
}
$('library').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('library.html') }));
$('extension-settings').addEventListener('click', () => {
  const scheme = /Edg\//.test(navigator.userAgent) ? 'edge' : 'chrome';
  chrome.tabs.create({ url: `${scheme}://extensions/?id=${chrome.runtime.id}` }).catch(error => status(error.message));
});
$('retry').addEventListener('click', initialize);
$('new-note').addEventListener('click', () => action('new-note', async () => { await send('WN_NEW_PAGE'); window.close(); }));
$('page-notes').addEventListener('click', () => action('page-notes', async () => { await send('WN_SHOW_LIST'); window.close(); }));
$('capture').addEventListener('click', () => action('capture', async () => {
  status('正在截取当前可见区域…'); await send('WN_PING');
  await runtime('WN_CAPTURE', { tabId: tab.id }); window.close();
}));
$('toggle').addEventListener('click', () => action('toggle', async () => {
  const response = await send('WN_TOGGLE'); $('toggle').textContent = response.enabled ? '隐藏高亮' : '显示高亮';
}));
async function initialize() {
  if (initializing || acting) return;
  initializing = true; enablePageActions(false); status(''); $('access-help').hidden = true;
  $('retry').disabled = true; $('page-title').textContent = '正在连接当前页面…'; $('count').textContent = '正在检查页面访问权限…';
  try {
    [tab] = await withTimeout(chrome.tabs.query({ active: true, currentWindow: true }), 5000);
    const page = describePage(tab);
    $('page-title').textContent = tab?.title || '当前页面'; $('page-url').textContent = page.label;
    if (!page.supported) {
      $('count').textContent = page.reason;
      if (page.kind === 'unknown') help('无法读取当前页面', '请检查「拾页」的网站访问权限；如果打开的是本地 HTML，请开启「允许访问文件网址」，刷新后重试。');
      return;
    }
    if (page.kind === 'local' && !await withTimeout(chrome.extension.isAllowedFileSchemeAccess(), 5000)) {
      $('count').textContent = '这是本地 HTML，尚未开启文件访问权限。';
      help('需要开启本地文件访问', '在扩展详情中开启「允许访问文件网址」（部分浏览器显示「允许访问文件 URL」），刷新文章后重新打开拾页。');
      return;
    }
    try {
      const result = await send('WN_PING'); $('toggle').textContent = result.enabled ? '隐藏高亮' : '显示高亮';
    } catch (error) {
      $('count').textContent = '尚未连接到页面，请检查权限或刷新文章。';
      help('页面连接未完成', page.kind === 'local' ? '请开启「允许访问文件网址」并刷新本地 HTML。内置 PDF 阅读器暂不支持标记。' : '请在扩展详情中允许访问当前网站，再刷新文章。浏览器内置页、PDF 阅读器和扩展商店不支持标记。');
      status(error.message); return;
    }
    enablePageActions(true);
    $('count').textContent = '选中正文，即可高亮并写下笔记';
    try {
      const { notes } = await runtime('WN_LIST', { url: page.url });
      if (notes.length) $('count').textContent = `此页已有 ${notes.length} 条拾页 · 选中文字继续标记`;
    } catch (error) { status(`页面已连接，笔记统计暂不可用：${error.message}`); }
  } catch (error) {
    $('page-title').textContent = tab?.title || '页面连接未完成'; $('count').textContent = '连接失败，可重新检测；已保存的笔记仍可从笔记库打开。';
    help('请检查页面访问权限', '点击「重新检测」重试，或打开扩展详情检查权限。'); status(error.message);
  } finally { initializing = false; $('retry').disabled = false; }
}
await initialize();
