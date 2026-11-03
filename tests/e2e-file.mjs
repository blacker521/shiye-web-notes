import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const results = path.join(root, 'test-results'); await mkdir(results, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), 'webnotes-file-test-'));
const fileUrl = pathToFileURL(path.join(root, 'demo/article.html')).href + '?mode=local#reading';
let context, checks = 0;
const errors = [];
const pass = label => { checks++; console.log(`✓ ${label}`); };
try {
  context = await chromium.launchPersistentContext(profile, {
    headless: true, viewport: { width: 1440, height: 1000 },
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  });
  context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const base = `chrome-extension://${extensionId}/`;
  assert.equal(await worker.evaluate(() => chrome.extension.isAllowedFileSchemeAccess()), true, '测试浏览器从命令行加载的独立扩展需有文件访问权限');
  const source = await context.newPage(); await source.goto(fileUrl);
  await source.waitForFunction(() => document.querySelector('[data-webnotes-root]'));
  const sourceTab = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url), fileUrl);
  assert.ok(sourceTab?.id); pass('真实 file:// 中文路径可注入页内工具');
  // Render popup as an inspectable tab; keep real Chrome extension messaging and file access.
  async function popup(mode = 'normal') {
    const p = await context.newPage();
    await p.addInitScript(({ sourceTab, mode }) => {
      chrome.tabs.query = async () => mode === 'unknown' ? [{ id: sourceTab.id, title: sourceTab.title }] : [sourceTab];
      if (mode === 'denied') chrome.extension.isAllowedFileSchemeAccess = async () => false;
      if (mode === 'timeout') chrome.tabs.sendMessage = () => new Promise(() => {});
    }, { sourceTab, mode });
    await p.goto(`${base}popup.html`);
    await p.waitForFunction(() => !document.querySelector('#retry').disabled);
    return p;
  }
  const ready = await popup();
  assert.match(await ready.locator('#page-url').textContent(), /本地文件/);
  for (const id of ['new-note', 'capture', 'page-notes', 'toggle']) assert.equal(await ready.locator(`#${id}`).isEnabled(), true);
  assert.equal(await ready.locator('#access-help').isHidden(), true);
  await ready.screenshot({ path: path.join(results, 'popup-local-ready.png') });
  pass('本地HTML弹窗正确识别，四个操作可用，不再显示HTTP限制');
  const denied = await popup('denied');
  assert.equal(await denied.locator('#capture').isDisabled(), true);
  assert.match(await denied.locator('#access-description').textContent(), /允许访问文件/);
  assert.equal(await denied.locator('#library').isEnabled(), true);
  assert.equal(await denied.locator('#capture').evaluate(e => getComputedStyle(e).cursor), 'not-allowed');
  await denied.screenshot({ path: path.join(results, 'popup-file-permission.png') });
  pass('未授权文件访问时有明确指引，禁用按钮不再使用转圈光标');
  const unknown = await popup('unknown'); assert.match(await unknown.locator('#count').textContent(), /权限/); assert.doesNotMatch(await unknown.locator('#count').textContent(), /PDF/); pass('缺失URL时提示权限问题，不误报浏览器内置页');
  const timed = await popup('timeout'); assert.match(await timed.locator('#status').textContent(), /超时/); assert.equal(await timed.locator('#retry').isEnabled(), true); pass('页面无响应时检测超时收尾，可以重新检测');
  await Promise.all([denied.close(), unknown.close(), timed.close()]);
  // The actual popup action sends WN_NEW_PAGE and opens the source page panel.
  await ready.locator('#new-note').click();
  const cdp = await context.newCDPSession(source);
  async function shadow(selector, fn = 'function(){this.click()}') {
    const { root: doc } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    let found;
    function find(n) { if (n.attributes?.includes('data-webnotes-root') && n.shadowRoots) found = n.shadowRoots[0]; for (const c of [...(n.children || []), ...(n.shadowRoots || [])]) find(c); }
    find(doc); assert.ok(found);
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: found.nodeId, selector }); assert.ok(nodeId, selector);
    const { object } = await cdp.send('DOM.resolveNode', { nodeId });
    const result = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: fn, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value;
  }
  await shadow('textarea', 'function(){this.value="本地 HTML 阅读记录"}'); await shadow('.save');
  const list = () => worker.evaluate(() => chrome.storage.local.get('notes').then(r => r.notes || []));
  await source.waitForTimeout(300); assert.equal((await list())[0].type, 'page'); assert.equal((await list())[0].url, fileUrl); pass('弹窗实际打开本地页面笔记并保存完整file地址');
  await source.bringToFront(); await source.locator('#cross').scrollIntoViewIfNeeded();
  await source.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.querySelector('#cross')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
  await source.waitForTimeout(100); await shadow('.toolbar .primary'); await shadow('textarea', 'function(){this.value="本地高亮重点"}'); await shadow('.save'); await source.waitForTimeout(250);
  const highlight = (await list()).find(n => n.type === 'highlight'); assert.ok(highlight.anchor.exact); assert.equal(highlight.url, fileUrl);
  await source.reload(); await source.waitForTimeout(350); assert.match(await shadow('.badge', 'function(){return this.textContent}'), /2/); pass('本地原文高亮保存并在刷新后恢复');
  const png = `data:image/png;base64,${(await source.screenshot()).toString('base64')}`;
  await worker.evaluate(({ png, fileUrl }) => chrome.storage.session.set({ 'capture:file-test': { id: 'file-test', image: png, url: fileUrl, title: '本地文件截图', position: { x: 0, y: 0, ratio: 0 }, viewport: { width: 1440, height: 1000 }, createdAt: new Date().toISOString() } }), { png, fileUrl });
  const editor = await context.newPage(); await editor.goto(`${base}screenshot.html?id=file-test`); await editor.waitForFunction(() => !document.querySelector('#save').disabled);
  await editor.locator('#note').fill('本地截图备注'); await editor.locator('#save').click(); await editor.waitForFunction(() => document.querySelector('#save-state').textContent.includes('已保存'));
  assert.equal((await list()).find(n => n.type === 'screenshot').url, fileUrl); pass('截图编辑器可载入并保存file来源的截图与笔记');
  const library = await context.newPage(); await library.goto(`${base}library.html`); await library.locator('.note-card').nth(2).waitFor();
  assert.equal((await library.locator('#site-list').innerText()).replace(/\s/g, ''), '本地文件3');
  await library.locator('#export-button').click(); const jsonPromise = library.waitForEvent('download'); await library.locator('#export-json').click(); const jsonPath = path.join(results, 'file-backup.json'); await (await jsonPromise).saveAs(jsonPath);
  const backup = JSON.parse(await readFile(jsonPath, 'utf8')); assert.equal(backup.notes.length, 3); assert.ok(backup.notes.every(n => n.url === fileUrl)); assert.ok(backup.notes.find(n => n.type === 'screenshot').image);
  await library.locator('#export-button').click(); const mdPromise = library.waitForEvent('download'); await library.locator('#export-markdown').click(); const mdPath = path.join(results, 'file-notes.md'); await (await mdPromise).saveAs(mdPath); assert.match(await readFile(mdPath, 'utf8'), /file:\/\/\//); pass('本地来源归档及JSON/Markdown导出保留file链接和图片');
  await library.evaluate(async () => { const { notes } = await chrome.runtime.sendMessage({ type: 'WN_LIST' }); for (const n of notes) await chrome.runtime.sendMessage({ type: 'WN_DELETE', id: n.id }); });
  assert.equal((await list()).length, 0);
  await library.waitForFunction(() => document.querySelector('#stat-total').textContent === '0');
  await library.locator('#import-file').setInputFiles(jsonPath);
  await library.waitForFunction(() => document.querySelector('#stat-total').textContent === '3');
  assert.equal((await list()).length, 3); pass('本地文件备份可完整导入恢复');
  const reopenedPromise = context.waitForEvent('page'); const result = await library.evaluate(id => chrome.runtime.sendMessage({ type: 'WN_OPEN_NOTE', id }), highlight.id); assert.equal(result.ok, true);
  const reopened = await reopenedPromise; await reopened.waitForURL(fileUrl); await reopened.waitForTimeout(800); assert.ok(await reopened.evaluate(() => scrollY > 0)); pass('笔记库直接打开本地HTML并定位高亮位置');
  assert.deepEqual(errors, []); pass('本地流程无未捕获JavaScript错误');
  console.log(`通过 ${checks} 项本地文件检查。`);
} finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
