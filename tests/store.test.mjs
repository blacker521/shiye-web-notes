import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLibrarySize, authorizeMessage, createMutationQueue, LIMITS, mergeNotes, normalizePageUrl, noteMetadata, parsePageUrl, validateImport, validateNote } from '../store.js';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1sAAAAASUVORK5CYII=';
const base = { id: 'note-a', type: 'highlight', url: 'https://example.com/article?q=1#part', title: '文章', quote: '重点原文', note: '想法', color: 'yellow', anchor: { exact: '重点原文', prefix: '之前', suffix: '之后', start: 10, end: 14 }, position: { x: 0, y: 100, ratio: 0.25 }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' };
const localUrl = new URL('file:///Users/test/企业微信缓存/本地文章.html?source=cache#重点').href;

test('URL 保留查询参数、去除锚点，拒绝脚本和带凭据地址', () => {
  assert.equal(normalizePageUrl(base.url), 'https://example.com/article?q=1');
  assert.throws(() => normalizePageUrl('javascript:alert(1)'));
  assert.throws(() => normalizePageUrl('https://user:secret@example.com/'));
});
test('本地文件 URL 规范化、笔记及备份保留完整路径和片段，不接受远程文件服务器', () => {
  const key = localUrl.slice(0, localUrl.indexOf('#'));
  assert.equal(normalizePageUrl(localUrl), key);
  assert.equal(parsePageUrl(localUrl).href, localUrl);
  assert.equal(normalizePageUrl(localUrl.replace('file:///', 'file://localhost/')), key);
  const note = validateNote({ ...base, url: localUrl.replace('file:///', 'file://localhost/') });
  assert.equal(note.url, localUrl);
  assert.equal(note.pageKey, key);
  assert.equal(validateImport({ version: 1, notes: [note] })[0].url, localUrl);
  for (const url of ['file://remote-server/share/article.html', 'file://user:secret@localhost/tmp/article.html', 'file://127.0.0.1/article.html', 'javascript:alert(1)', 'data:text/html,article', 'chrome://extensions', 'chrome-extension://ext/library.html']) {
    assert.throws(() => normalizePageUrl(url), url);
    assert.throws(() => validateNote({ ...base, url }), url);
  }
});
test('白名单字段阻止导入污染及任意图片 URL', () => {
  const note = validateNote({ ...base, unrelated: true, constructor: { polluted: true } });
  assert.equal(Object.hasOwn(note, 'constructor'), false);
  assert.equal(Object.hasOwn(note, 'unrelated'), false);
  assert.throws(() => validateNote({ ...base, id: '__proto__' }));
  assert.throws(() => validateNote({ ...base, type: 'screenshot', image: 'https://example.com/x.png' }));
  assert.throws(() => validateNote({ ...base, type: 'screenshot', image: 'data:image/svg+xml;base64,AAAA' }));
  assert.equal(validateNote({ ...base, type: 'screenshot', image: png }).image, png);
});
test('坏锚点、时间、位置和类型均被拒绝', () => {
  assert.throws(() => validateNote({ ...base, anchor: { ...base.anchor, end: 2 } }));
  assert.throws(() => validateNote({ ...base, position: { ratio: 2 } }));
  assert.throws(() => validateNote({ ...base, updatedAt: 'tomorrow-ish' }));
  assert.throws(() => validateNote({ ...base, type: 'unknown' }));
  assert.throws(() => validateNote({ ...base, quote: '' }));
});
test('整批导入先验证，重复 ID 与缺失版本/时间不接受', () => {
  const original = [{ ...base }];
  assert.throws(() => validateImport({ version: 1, notes: [base, { ...base, id: 'bad', url: 'javascript:bad' }] }));
  assert.deepEqual(original, [base]);
  assert.throws(() => validateImport({ version: 1, notes: [base, base] }));
  assert.throws(() => validateImport({ notes: [base] }));
  assert.throws(() => validateImport({ version: 1, notes: [{ ...base, createdAt: undefined }] }));
  assert.equal(validateImport({ version: 1, notes: [base] }).length, 1);
});
test('导入合并保留本地较新记录，加入新记录，不修改输入', () => {
  const newer = { ...base, updatedAt: '2026-03-01T00:00:00.000Z', note: '最新本地笔记' };
  const incoming = [{ ...base }, { ...base, id: 'note-b' }];
  const merged = mergeNotes([newer], incoming);
  assert.equal(merged.notes.find(n => n.id === 'note-a').note, '最新本地笔记');
  assert.equal(merged.imported, 1);
  assert.equal(merged.updated, 0);
  assert.equal(incoming.length, 2);
  assert.equal(mergeNotes([base], [newer]).updated, 1);
});
test('全库限额按 UTF-8 字节计数，边界可保存，超额拒绝', () => {
  assert.equal(LIMITS.libraryBytes, 140 * 1024 * 1024);
  assert.equal(LIMITS.importBytes, 150 * 1024 * 1024);
  const notes = [{ ...base, note: '中文🙂引号"和换行\n' }];
  const bytes = new TextEncoder().encode(JSON.stringify(notes)).byteLength;
  assert.ok(bytes > JSON.stringify(notes).length);
  assert.doesNotThrow(() => assertLibrarySize(notes, bytes));
  assert.throws(() => assertLibrarySize(notes, bytes - 1), /140 MB/);
  const compact = noteMetadata({ ...base, type: 'screenshot', image: png });
  assert.equal(Object.hasOwn(compact, 'image'), false);
  assert.equal(compact.quote, base.quote);
});
test('串行队列不丢并发更新，失败后仍可保存', async () => {
  const enqueue = createMutationQueue();
  let stored = [];
  const task = id => enqueue(async () => {
    const read = [...stored];
    await new Promise(resolve => setTimeout(resolve, 5));
    stored = [...read, id];
  });
  await Promise.all([task('a'), task('b'), task('c')]);
  assert.deepEqual(stored, ['a', 'b', 'c']);
  await assert.rejects(enqueue(() => { throw new Error('写入失败'); }));
  await task('d');
  assert.deepEqual(stored, ['a', 'b', 'c', 'd']);
});
test('网页端消息只能访问同页记录，不能导入或读取截图缓存', () => {
  const sender = { id: 'ext', frameId: 0, tab: { id: 1, url: base.url }, url: base.url };
  assert.equal(authorizeMessage({ type: 'WN_LIST' }, sender, 'ext', 'chrome-extension://ext/').pageKey, 'https://example.com/article?q=1');
  assert.throws(() => authorizeMessage({ type: 'WN_LIST', url: 'https://other.com/' }, sender, 'ext', 'chrome-extension://ext/'));
  assert.throws(() => authorizeMessage({ type: 'WN_SAVE', note: { ...base, url: 'https://other.com/' } }, sender, 'ext', 'chrome-extension://ext/'));
  assert.throws(() => authorizeMessage({ type: 'WN_IMPORT' }, sender, 'ext', 'chrome-extension://ext/'));
  assert.throws(() => authorizeMessage({ type: 'WN_IMPORT_STAGED', key: 'import:safe-id' }, sender, 'ext', 'chrome-extension://ext/'));
  assert.throws(() => authorizeMessage({ type: 'WN_GET_CAPTURE' }, sender, 'ext', 'chrome-extension://ext/'));
  assert.throws(() => authorizeMessage({ type: 'WN_LIST' }, { ...sender, id: 'other' }, 'ext', 'chrome-extension://ext/'));
  assert.throws(() => authorizeMessage({ type: 'WN_LIST' }, { ...sender, frameId: 1 }, 'ext', 'chrome-extension://ext/'));
  assert.equal(authorizeMessage({ type: 'WN_IMPORT' }, { id: 'ext', url: 'chrome-extension://ext/library.html' }, 'ext', 'chrome-extension://ext/').trusted, true);
});
test('本地 content 消息也按完整文件路径和查询参数隔离', () => {
  const sender = { id: 'ext', frameId: 0, tab: { id: 1, url: localUrl }, url: localUrl };
  assert.equal(authorizeMessage({ type: 'WN_LIST' }, sender, 'ext', 'chrome-extension://ext/').pageKey, normalizePageUrl(localUrl));
  assert.doesNotThrow(() => authorizeMessage({ type: 'WN_SAVE', note: { ...base, url: localUrl.replace('file:///', 'file://localhost/').replace(/#.*$/, '#其他片段') } }, sender, 'ext', 'chrome-extension://ext/'));
  assert.throws(() => authorizeMessage({ type: 'WN_LIST', url: 'file:///Users/test/other.html' }, sender, 'ext', 'chrome-extension://ext/'));
  assert.throws(() => authorizeMessage({ type: 'WN_SAVE', note: { ...base, url: localUrl.replace('source=cache', 'source=other') } }, sender, 'ext', 'chrome-extension://ext/'));
  assert.throws(() => authorizeMessage({ type: 'WN_IMPORT' }, sender, 'ext', 'chrome-extension://ext/'));
});

test('后台消息流程：并发保存、原子导入、跨页保护、截图清理及回跳竞态', async t => {
  let listener;
  let nextTabId = 2;
  const calls = [];
  const storage = () => {
    const values = new Map();
    return {
      values,
      async setAccessLevel() {},
      async get(key) {
        if (key === null) return Object.fromEntries(values);
        return values.has(key) ? { [key]: structuredClone(values.get(key)) } : {};
      },
      async set(items) {
        await new Promise(resolve => setTimeout(resolve, 1));
        for (const [key, value] of Object.entries(items)) values.set(key, structuredClone(value));
      },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key); },
    };
  };
  const local = storage();
  const session = storage();
  const tabs = new Map([[1, { id: 1, url: base.url, windowId: 1 }]]);
  let prepareFailure = false;
  let fileAccessAllowed = false;
  const chromeMock = {
    storage: { local, session },
    extension: { async isAllowedFileSchemeAccess() { return fileAccessAllowed; } },
    runtime: { id: 'ext', getURL: path => `chrome-extension://ext/${path}`, onMessage: { addListener(fn) { listener = fn; } } },
    tabs: {
      async query(options) {
        calls.push({ operation: 'query', options });
        return options.active ? [tabs.get(1)] : [...tabs.values()].filter(tab => /^(https?|file):/.test(tab.url));
      },
      async get(id) { return tabs.get(id); },
      async sendMessage(id, message) {
        calls.push({ operation: message.type, id });
        if (message.type === 'WN_PREPARE_CAPTURE') {
          if (prepareFailure) throw new Error('Receiving end does not exist');
          return { url: tabs.get(id).url, title: base.title, position: base.position, viewport: { width: 800, height: 600 } };
        }
        return { ok: true };
      },
      async captureVisibleTab() { calls.push({ operation: 'capture' }); return png; },
      async create({ url }) { const tab = { id: nextTabId++, url, windowId: 1 }; tabs.set(tab.id, tab); return tab; },
      async update(id, { url }) {
        calls.push({ operation: 'navigate', id, url, jumpAlreadyStored: session.values.has(`jump:${id}`) });
        const tab = { ...tabs.get(id), url }; tabs.set(id, tab); return tab;
      },
      onRemoved: { addListener() {} },
    },
  };
  globalThis.chrome = chromeMock;
  await import(`../background.js?integration=${Date.now()}`);
  const ui = { id: 'ext', url: 'chrome-extension://ext/library.html' };
  const page = { id: 'ext', url: base.url, frameId: 0, tab: tabs.get(1) };
  const request = (message, sender = ui) => new Promise(resolve => listener(message, sender, resolve));

  await t.test('多个同时保存不会覆盖其他笔记', async () => {
    const replies = await Promise.all(['a', 'b', 'c'].map(id => request({ type: 'WN_SAVE', note: { ...base, id } })));
    assert.ok(replies.every(reply => reply.ok));
    assert.equal((await request({ type: 'WN_LIST' })).notes.length, 3);
  });
  await t.test('导入中任何一条无效就不写入', async () => {
    const reply = await request({ type: 'WN_IMPORT', payload: { version: 1, notes: [{ ...base, id: 'new' }, { ...base, id: 'bad', color: 'evil' }] } });
    assert.equal(reply.ok, false);
    assert.equal((await request({ type: 'WN_LIST' })).notes.length, 3);
  });
  await t.test('分离截图字节与元数据，页内改备注保留原图', async () => {
    const saved = await request({ type: 'WN_SAVE', note: { ...base, id: 'shot', type: 'screenshot', image: png } });
    assert.equal(saved.ok, true);
    assert.equal(Object.hasOwn(saved.note, 'image'), false);
    const listed = await request({ type: 'WN_LIST' });
    const listedPage = await request({ type: 'WN_LIST' }, page);
    for (const result of [listed, listedPage]) assert.equal(Object.hasOwn(result.notes.find(note => note.id === 'shot'), 'image'), false);
    const edited = await request({ type: 'WN_SAVE', note: { ...listedPage.notes.find(note => note.id === 'shot'), note: '截图备注已修改' } }, page);
    assert.equal(edited.ok, true);
    const stored = local.values.get('notes').find(note => note.id === 'shot');
    assert.equal(stored.image, png);
    assert.equal(stored.note, '截图备注已修改');
    // Empty/corrupt image updates must not silently fall back to an old image.
    assert.equal((await request({ type: 'WN_SAVE', note: { ...stored, image: '' } })).ok, false);
    await request({ type: 'WN_DELETE', id: 'shot' });
  });
  await t.test('暂存导入只允许可信界面，成功失败均清理缓存且原子合并', async () => {
    const successKey = 'import:trusted-test';
    const good = { ...base, id: 'staged-new' };
    await local.set({ [successKey]: { version: 1, notes: [good] } });
    assert.equal((await request({ type: 'WN_IMPORT_STAGED', key: successKey }, page)).ok, false);
    assert.ok(local.values.has(successKey), '无权限请求不能删除可信缓存');
    const result = await request({ type: 'WN_IMPORT_STAGED', key: successKey });
    assert.equal(result.ok, true);
    assert.equal(result.imported, 1);
    assert.equal(local.values.has(successKey), false);
    const before = structuredClone(local.values.get('notes'));
    const failureKey = 'import:invalid-test';
    await local.set({ [failureKey]: { version: 1, notes: [{ ...base, id: 'should-not-persist' }, { ...base, id: 'bad', type: 'invalid' }] } });
    const failed = await request({ type: 'WN_IMPORT_STAGED', key: failureKey });
    assert.equal(failed.ok, false);
    assert.equal(local.values.has(failureKey), false);
    assert.deepEqual(local.values.get('notes'), before);
    assert.equal((await request({ type: 'WN_IMPORT_STAGED', key: 'notes' })).ok, false);
    assert.deepEqual(local.values.get('notes'), before, '无效 key 不能触碰主笔记库');
    const missing = await request({ type: 'WN_IMPORT_STAGED', key: 'import:missing' });
    assert.equal(missing.ok, false);
    assert.match(missing.error, /缓存已失效/);
    await request({ type: 'WN_DELETE', id: 'staged-new' });
  });
  await t.test('content 不能借用同页新 URL 覆盖别页已有 ID', async () => {
    await request({ type: 'WN_SAVE', note: { ...base, id: 'private', url: 'https://private.example/note' } });
    const reply = await request({ type: 'WN_SAVE', note: { ...base, id: 'private', note: 'attempt overwrite' } }, page);
    assert.equal(reply.ok, false);
    assert.equal((await request({ type: 'WN_LIST' }, page)).notes.some(note => note.id === 'private'), false);
    assert.equal((await request({ type: 'WN_DELETE', id: 'private' }, page)).ok, false);
  });
  await t.test('定位 ID 在导航之前写入，网页端只能消费一次', async () => {
    const opened = await request({ type: 'WN_OPEN_NOTE', id: 'a' });
    assert.equal(opened.ok, true);
    const navigation = calls.find(call => call.operation === 'navigate' && call.id === opened.tabId);
    assert.equal(navigation.jumpAlreadyStored, true);
    const sender = { ...page, tab: tabs.get(opened.tabId) };
    assert.equal((await request({ type: 'WN_PENDING' }, sender)).id, 'a');
    assert.equal((await request({ type: 'WN_PENDING' }, sender)).id, undefined);
  });
  await t.test('截图准备失败也恢复UI，之后可再次截图并清理临时缓存', async () => {
    prepareFailure = true;
    const failed = await request({ type: 'WN_CAPTURE', tabId: 1 });
    assert.equal(failed.ok, false);
    assert.equal(calls.at(-1).operation, 'WN_FINISH_CAPTURE');
    prepareFailure = false;
    const captured = await request({ type: 'WN_CAPTURE', tabId: 1 });
    assert.equal(captured.ok, true);
    const read = await request({ type: 'WN_GET_CAPTURE', id: captured.captureId });
    assert.equal(read.capture.image, png);
    assert.equal(read.capture.url, base.url);
    assert.equal(calls.at(-1).operation, 'WN_FINISH_CAPTURE');
    await request({ type: 'WN_DROP_CAPTURE', id: captured.captureId });
    assert.equal((await request({ type: 'WN_GET_CAPTURE', id: captured.captureId })).ok, false);
  });
  await t.test('本地HTML保存、同页访问、导入和回跳，截图授权失败后可重试', async () => {
    const originalTab = tabs.get(1);
    tabs.set(1, { ...originalTab, url: localUrl });
    const fileSender = { id: 'ext', url: localUrl, frameId: 0, tab: tabs.get(1) };
    try {
      const saved = await request({ type: 'WN_SAVE', note: { ...base, id: 'local-note', url: localUrl } }, fileSender);
      assert.equal(saved.ok, true);
      assert.equal(saved.note.url, localUrl);
      assert.ok(calls.some(call => call.operation === 'query' && call.options.url?.includes('file:///*')));
      assert.ok(calls.some(call => call.operation === 'WN_REFRESH' && call.id === 1));
      const listed = await request({ type: 'WN_LIST', url: localUrl.replace(/#.*$/, '#另一个位置') }, fileSender);
      assert.deepEqual(listed.notes.map(note => note.id), ['local-note']);
      const otherFile = { ...fileSender, url: 'file:///Users/test/other.html', tab: { ...fileSender.tab, url: 'file:///Users/test/other.html' } };
      assert.deepEqual((await request({ type: 'WN_LIST' }, otherFile)).notes, []);
      assert.equal((await request({ type: 'WN_DELETE', id: 'local-note' }, otherFile)).ok, false);
      assert.equal((await request({ type: 'WN_SAVE', note: { ...base, id: 'local-note', url: otherFile.url } }, otherFile)).ok, false);

      const beforeTabs = tabs.size;
      const beforeCaptureCount = calls.filter(call => call.operation === 'capture').length;
      const beforePrepareCount = calls.filter(call => call.operation === 'WN_PREPARE_CAPTURE').length;
      const deniedOpen = await request({ type: 'WN_OPEN_NOTE', id: 'local-note' });
      assert.equal(deniedOpen.ok, false);
      assert.equal(deniedOpen.error, '请在扩展详情中开启「允许访问文件网址」');
      assert.equal(tabs.size, beforeTabs, '授权失败不应创建空白标签页');
      const deniedCapture = await request({ type: 'WN_CAPTURE', tabId: 1 });
      assert.equal(deniedCapture.ok, false);
      assert.equal(deniedCapture.error, '请在扩展详情中开启「允许访问文件网址」');
      assert.equal(calls.filter(call => call.operation === 'capture').length, beforeCaptureCount);
      assert.equal(calls.filter(call => call.operation === 'WN_PREPARE_CAPTURE').length, beforePrepareCount);

      fileAccessAllowed = true;
      const opened = await request({ type: 'WN_OPEN_NOTE', id: 'local-note' });
      assert.equal(opened.ok, true);
      const navigation = calls.find(call => call.operation === 'navigate' && call.id === opened.tabId);
      assert.equal(navigation.url, localUrl);
      assert.equal(navigation.jumpAlreadyStored, true);
      const openedSender = { ...fileSender, tab: tabs.get(opened.tabId) };
      assert.equal((await request({ type: 'WN_PENDING' }, openedSender)).id, 'local-note');
      assert.equal((await request({ type: 'WN_PENDING' }, openedSender)).id, undefined);
      const captured = await request({ type: 'WN_CAPTURE', tabId: 1 });
      assert.equal(captured.ok, true, '之前拒绝授权不能阻塞后续截图');
      const cache = (await request({ type: 'WN_GET_CAPTURE', id: captured.captureId })).capture;
      assert.equal(cache.url, localUrl);
      assert.equal(cache.image, png);
      await request({ type: 'WN_DROP_CAPTURE', id: captured.captureId });

      const stored = structuredClone(local.values.get('notes').find(note => note.id === 'local-note'));
      await request({ type: 'WN_DELETE', id: 'local-note' }, fileSender);
      const imported = await request({ type: 'WN_IMPORT', payload: { version: 1, notes: [stored] } });
      assert.equal(imported.ok, true);
      assert.equal((await request({ type: 'WN_LIST' }, fileSender)).notes[0].url, localUrl);
      assert.equal((await request({ type: 'WN_OPEN_NOTE', id: 'local-note' })).ok, true);
      await request({ type: 'WN_DELETE', id: 'local-note' }, fileSender);
    } finally {
      tabs.set(1, originalTab);
      fileAccessAllowed = false;
    }
  });
  delete globalThis.chrome;
});
