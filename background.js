import { assertLibrarySize, authorizeMessage, createMutationQueue, LIMITS, mergeNotes, normalizePageUrl, noteMetadata, parsePageUrl, validateId, validateImport, validateNote } from './store.js';

const NOTES_KEY = 'notes';
const mutation = createMutationQueue();
let captureBusy = false;
const initialization = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).then(() => null, error => error);

async function readNotes() {
  if (await initialization) throw new Error('无法保护本地笔记存储，请更新浏览器后重新加载扩展');
  const stored = (await chrome.storage.local.get(NOTES_KEY))[NOTES_KEY];
  if (stored === undefined) return [];
  if (!Array.isArray(stored)) throw new Error('本地笔记数据异常，请先保留浏览器配置并恢复 JSON 备份');
  return stored;
}
async function importNotes(payload) {
  const incoming = validateImport(payload);
  const result = mergeNotes(await readNotes(), incoming);
  assertLibrarySize(result.notes);
  await chrome.storage.local.set({ [NOTES_KEY]: result.notes });
  await refreshPages();
  const { notes, ...counts } = result;
  return counts;
}
async function refreshPages(pageKey) {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*', 'file:///*'] }).catch(() => []);
  await Promise.allSettled(tabs.filter(tab => {
    try { return !pageKey || normalizePageUrl(tab.url) === pageKey; } catch { return false; }
  }).map(tab => timeout(chrome.tabs.sendMessage(tab.id, { type: 'WN_REFRESH' }), 1500)));
}
function assertOwnPage(note, auth) {
  if (!auth.trusted && normalizePageUrl(note.url) !== auth.pageKey) throw new Error('不能修改其他网页的笔记');
}
async function requirePageAccess(value) {
  const url = parsePageUrl(value);
  if (url.protocol === 'file:' && !await chrome.extension.isAllowedFileSchemeAccess()) throw new Error('请在扩展详情中开启「允许访问文件网址」');
  return url;
}
function timeout(promise, ms = 12_000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('网页响应超时，请刷新网页重试')), ms); })]).finally(() => clearTimeout(timer));
}
async function sendTab(tabId, message) {
  const result = await timeout(chrome.tabs.sendMessage(tabId, message));
  if (result?.ok === false) throw new Error(result.error || '网页操作失败');
  return result;
}
async function readCapture(id) {
  validateId(id);
  const key = `capture:${id}`;
  return (await chrome.storage.session.get(key))[key] || (await chrome.storage.local.get(key))[key];
}
async function dropCapture(id) {
  validateId(id);
  const key = `capture:${id}`;
  await Promise.all([chrome.storage.session.remove(key), chrome.storage.local.remove(key)]);
}
async function cleanCaptures() {
  const before = Date.now() - 24 * 60 * 60 * 1000;
  for (const storage of [chrome.storage.session, chrome.storage.local]) {
    const all = await storage.get(null);
    const expired = Object.keys(all).filter(key => key.startsWith('capture:') && Date.parse(all[key]?.createdAt || 0) < before);
    if (expired.length) await storage.remove(expired);
  }
}
async function captureTab(tabId) {
  if (!Number.isInteger(tabId)) throw new Error('找不到要截图的网页');
  if (captureBusy) throw new Error('正在截图，请稍后重试');
  captureBusy = true;
  let prepared = false;
  try {
    if (await initialization) throw new Error('无法保护本地笔记存储，请更新浏览器后重新加载扩展');
    const tab = await chrome.tabs.get(tabId);
    await requirePageAccess(tab.url);
    const active = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    if (active[0]?.id !== tabId) throw new Error('请保持要截图的网页处于当前标签页');
    prepared = true;
    const response = await sendTab(tabId, { type: 'WN_PREPARE_CAPTURE' });
    const metadata = response?.capture || response?.metadata || response;
    if (!metadata?.viewport || normalizePageUrl(metadata.url) !== normalizePageUrl(tab.url)) throw new Error('截图前网页地址发生变化，请重试');
    const current = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    if (current[0]?.id !== tabId) throw new Error('截图时标签页发生切换，请重试');
    const image = await timeout(chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }));
    const after = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    const tabAfter = await chrome.tabs.get(tabId);
    if (after[0]?.id !== tabId || normalizePageUrl(tabAfter.url) !== normalizePageUrl(metadata.url)) throw new Error('截图时网页发生切换，请重新截图');
    const id = crypto.randomUUID();
    const capture = { id, image, url: parsePageUrl(metadata.url).href, title: metadata.title || tab.title || '', position: metadata.position || { x: 0, y: 0, ratio: 0 }, viewport: metadata.viewport, createdAt: new Date().toISOString() };
    await cleanCaptures();
    const key = `capture:${id}`;
    try { await chrome.storage.session.set({ [key]: capture }); }
    catch { await chrome.storage.local.set({ [key]: capture }); }
    await chrome.tabs.create({ url: chrome.runtime.getURL(`screenshot.html?id=${encodeURIComponent(id)}`) });
    return { captureId: id };
  } catch (error) {
    if (/Receiving end|Could not establish connection|Cannot access|Missing host permission/i.test(error.message)) throw new Error('此页面尚未启用拾页，请刷新网页后重试；浏览器内部页面不支持标记');
    throw error;
  } finally {
    if (prepared) await timeout(chrome.tabs.sendMessage(tabId, { type: 'WN_FINISH_CAPTURE' }), 1500).catch(() => {});
    captureBusy = false;
  }
}

async function handleMessage(message, sender) {
  if (!message || typeof message.type !== 'string') throw new Error('消息格式无效');
  const auth = authorizeMessage(message, sender, chrome.runtime.id, chrome.runtime.getURL(''));
  switch (message.type) {
    case 'WN_LIST': {
      const pageKey = auth.trusted ? (message.url ? normalizePageUrl(message.url) : null) : auth.pageKey;
      const notes = await readNotes();
      return { notes: notes.filter(note => !pageKey || normalizePageUrl(note.url) === pageKey).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).map(noteMetadata) };
    }
    case 'WN_SAVE': return mutation(async () => {
      const notes = await readNotes();
      const existing = message.note?.id ? notes.find(note => note.id === message.note.id) : null;
      if (existing) assertOwnPage(existing, auth);
      const now = new Date().toISOString();
      const input = { ...message.note };
      if (input.type === 'screenshot' && input.image === undefined && existing?.type === 'screenshot') input.image = existing.image;
      const note = validateNote({ ...input, createdAt: existing?.createdAt || now, updatedAt: now });
      assertOwnPage(note, auth);
      if (!existing && notes.length >= LIMITS.notes) throw new Error('本地笔记总数最多 10,000 条，请先导出并整理旧笔记');
      const next = [...notes.filter(item => item.id !== note.id), note];
      assertLibrarySize(next);
      await chrome.storage.local.set({ [NOTES_KEY]: next });
      await refreshPages(note.pageKey);
      return { note: noteMetadata(note) };
    });
    case 'WN_DELETE': return mutation(async () => {
      validateId(message.id);
      const notes = await readNotes();
      const existing = notes.find(note => note.id === message.id);
      if (existing) assertOwnPage(existing, auth);
      await chrome.storage.local.set({ [NOTES_KEY]: notes.filter(note => note.id !== message.id) });
      if (existing) await refreshPages(normalizePageUrl(existing.url));
      return { deleted: Boolean(existing) };
    });
    case 'WN_IMPORT': return mutation(() => importNotes(message.payload));
    case 'WN_IMPORT_STAGED': return mutation(async () => {
      if (typeof message.key !== 'string' || !/^import:[A-Za-z0-9_-]{1,128}$/.test(message.key)) throw new Error('导入缓存标识无效');
      validateId(message.key.slice('import:'.length));
      try {
        if (await initialization) throw new Error('无法保护本地笔记存储，请更新浏览器后重新加载扩展');
        const payload = (await chrome.storage.local.get(message.key))[message.key];
        if (payload === undefined) throw new Error('导入缓存已失效，请重新选择备份文件');
        return await importNotes(payload);
      } finally {
        await chrome.storage.local.remove(message.key);
      }
    });
    case 'WN_CAPTURE': return captureTab(message.tabId);
    case 'WN_GET_CAPTURE': {
      const capture = await readCapture(message.id);
      if (!capture) throw new Error('截图缓存已失效，请回到网页重新截图');
      return { capture };
    }
    case 'WN_DROP_CAPTURE': await dropCapture(message.id); return {};
    case 'WN_OPEN_LIBRARY': {
      await chrome.tabs.create({ url: chrome.runtime.getURL('library.html') });
      return {};
    }
    case 'WN_OPEN_NOTE': {
      validateId(message.id);
      const note = (await readNotes()).find(item => item.id === message.id);
      if (!note) throw new Error('这条笔记已被删除');
      const url = await requirePageAccess(note.url);
      // Open a blank tab first so the pending locator exists before content.js initializes.
      const tab = await chrome.tabs.create({ url: 'about:blank' });
      await chrome.storage.session.set({ [`jump:${tab.id}`]: note.id });
      try { await chrome.tabs.update(tab.id, { url: url.href }); }
      catch (error) { await chrome.storage.session.remove(`jump:${tab.id}`); throw error; }
      return { tabId: tab.id };
    }
    case 'WN_PENDING': {
      if (!sender.tab?.id) return {};
      const key = `jump:${sender.tab.id}`;
      const id = (await chrome.storage.session.get(key))[key];
      if (id) await chrome.storage.session.remove(key);
      return { id };
    }
    default: throw new Error('不支持的操作');
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(result => sendResponse({ ok: true, ...result }), error => sendResponse({ ok: false, error: error?.message || '操作失败，请重试' }));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => { chrome.storage.session.remove(`jump:${tabId}`).catch(() => {}); });
