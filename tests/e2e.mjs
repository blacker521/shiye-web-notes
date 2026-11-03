import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const results = path.join(root, 'test-results');
await mkdir(results, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), 'webnotes-test-'));
const article = await readFile(path.join(root, 'demo/article.html'));
const server = createServer((req, res) => {
  const headers = { 'content-type': 'text/html;charset=utf-8' };
  if (req.url.startsWith('/strict')) headers['content-security-policy'] = "default-src 'none'; style-src 'none'; script-src 'none'";
  let html = article.toString();
  if (req.url.startsWith('/delayed')) {
    const original = html.match(/<p id="cross">[\s\S]*?<\/p>/)[0];
    html = html.replace(original, '<p id="loading-article">文章正在加载</p>');
    html = html.replace('</body>', `<script>setTimeout(()=>document.getElementById('loading-article').outerHTML=${JSON.stringify(original)},1400)</script></body>`);
  }
  res.writeHead(200, headers); res.end(html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/article?source=test#reading`;
let context;
const errors = [];
let checks = 0;
const pass = text => { checks++; console.log(`✓ ${text}`); };
try {
  context = await chromium.launchPersistentContext(profile, {
    headless: true, viewport: { width: 1440, height: 1000 },
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const extension = `chrome-extension://${extensionId}/`;
  const page = await context.newPage();
  await page.goto(url);
  const cdp = await context.newCDPSession(page);
  async function shadow(selector, fn = 'function(){this.click()}', args = []) {
    const { root: doc } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    let found;
    function find(node) {
      if (node.attributes?.includes('data-webnotes-root') && node.shadowRoots) found = node.shadowRoots[0];
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) find(child);
    }
    find(doc); assert.ok(found, '页内扩展的隔离界面已加载');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: found.nodeId, selector });
    assert.ok(nodeId, `找到页内控件 ${selector}`);
    const { object } = await cdp.send('DOM.resolveNode', { nodeId });
    const result = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: fn, arguments: args.map(value => ({ value })), returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  await page.waitForFunction(() => document.querySelector('[data-webnotes-root]'));
  // Select across inline elements; use actual content-script toolbar to save.
  const quote = await page.locator('#cross').textContent();
  await page.locator('#cross').scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const range = document.createRange(); range.selectNodeContents(document.getElementById('cross'));
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.waitForTimeout(150);
  await shadow('.toolbar .primary');
  await shadow('textarea', 'function(){this.value="跨节点摘录：保留上下文和阅读位置";this.dispatchEvent(new Event("input",{bubbles:true}))}');
  await shadow('.save');
  const list = () => worker.evaluate(() => chrome.storage.local.get('notes').then(x => x.notes || []));
  await page.waitForTimeout(400);
  let notes = await list(); assert.equal(notes.length, 1); assert.equal(notes[0].quote, quote); assert.equal(notes[0].url, url); assert.ok(notes[0].anchor.prefix);
  const highlightId = notes[0].id;
  pass('跨文本节点摘录 + 笔记 + URL/上下文/位置持久保存');
  await page.reload(); await page.waitForFunction(() => document.querySelector('[data-webnotes-root]'));
  await page.waitForTimeout(350); assert.match(await shadow('.badge', 'function(){return this.textContent}'), /1/);
  const { root: doc } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true }); assert.ok(doc);
  const worlds = [];
  cdp.on('Runtime.executionContextCreated', ({ context }) => worlds.push(context));
  await cdp.send('Runtime.enable');
  let highlightCount = 0;
  for (const world of worlds) {
    try { const r = await cdp.send('Runtime.evaluate', { expression: 'globalThis.WebNotesAnchors ? CSS.highlights.get("webnotes-yellow")?.size : 0', contextId: world.id, returnByValue: true }); highlightCount = Math.max(highlightCount, r.result.value || 0); } catch { /* A navigation may retire an execution world. */ }
  }
  assert.equal(highlightCount, 1);
  pass('刷新后自动恢复原生文字高亮与页内记录');
  // Mutate article then ensure the original range still resolves in isolated world.
  await page.evaluate(() => { const p = document.createElement('p'); p.textContent = '文章新增的一段前言。'; document.querySelector('main').prepend(p); });
  await page.waitForTimeout(500);
  await shadow('.badge');
  const rowText = await shadow('.list', 'function(){return this.textContent}'); assert.ok(rowText.includes(quote));
  await shadow('.close');
  pass('正文插入新内容后标记保持可用');
  const library = await context.newPage(); await library.goto(`${extension}library.html`);
  await library.locator('.note-card').waitFor();
  await library.locator('.card-title button').first().click();
  await library.locator('#detail-note').fill('真正需要复习的核心观点'); await library.locator('#save-note').click();
  await library.locator('#detail-dialog').waitFor({ state: 'hidden' });
  await library.locator('#search').fill('需要复习'); assert.equal(await library.locator('.note-card').count(), 1);
  await library.locator('#search').fill('不存在的搜索词'); assert.equal(await library.locator('.note-card').count(), 0);
  await library.locator('#search').fill(''); pass('笔记库编辑和全文搜索');
  await library.locator('#export-button').click();
  const downloadPromise = library.waitForEvent('download'); await library.locator('#export-json').click();
  const download = await downloadPromise; const backupPath = path.join(results, 'backup.json'); await download.saveAs(backupPath);
  const backup = JSON.parse(await readFile(backupPath, 'utf8')); assert.equal(backup.notes[0].id, highlightId); assert.equal(backup.version, 1);
  await library.locator('#import-file').setInputFiles(backupPath); await library.waitForTimeout(250); assert.equal((await list()).length, 1);
  pass('JSON 导出、导入合并与去重');
  const invalid = await library.evaluate(async () => chrome.runtime.sendMessage({ type: 'WN_IMPORT', payload: { version: 1, notes: [{ id: 'bad', type: 'page', url: 'javascript:alert(1)' }] } }));
  assert.equal(invalid.ok, false); assert.equal((await list()).length, 1); pass('无效导入被拒绝且不破坏已有数据');
  // An actual captureVisibleTab call has activeTab only after clicking the toolbar action.
  // Automated runs without a browser-action user gesture use a real page PNG as the editor input.
  await page.bringToFront(); await page.evaluate(() => scrollTo(0, 0));
  const image = `data:image/png;base64,${(await page.screenshot()).toString('base64')}`;
  await worker.evaluate(async ({ url, image }) => chrome.storage.session.set({ 'capture:e2e': { id: 'e2e', image, url, title: '让阅读留下痕迹', position: { x: 0, y: 0, ratio: 0 }, viewport: { width: 1440, height: 1000 }, createdAt: new Date().toISOString() } }), { url, image });
  const editor = await context.newPage(); await editor.goto(`${extension}screenshot.html?id=e2e`);
  await editor.waitForFunction(() => document.querySelector('#canvas').width > 100 && !document.querySelector('#save').disabled);
  const canvas = editor.locator('#canvas');
  async function drag(tool, from, to) {
    await editor.locator(`[data-tool="${tool}"]`).click(); const box = await canvas.boundingBox();
    await editor.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]); await editor.mouse.down();
    await editor.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 8 }); await editor.mouse.up();
  }
  await drag('rect', [.15, .20], [.65, .38]);
  await drag('arrow', [.72, .5], [.55, .35]);
  await drag('pen', [.25, .55], [.55, .58]);
  await editor.locator('[data-tool="text"]').click(); await editor.locator('#annotation-text').fill('这个观点值得复习');
  await canvas.click({ position: { x: 70, y: 70 } });
  await drag('crop', [.08, .08], [.9, .85]); await editor.locator('#apply-crop').click();
  const size = await canvas.evaluate(c => ({ width: c.width, height: c.height })); assert.ok(size.width < 1440 && size.height < 1000);
  await editor.locator('#note').fill('截图中的框线、箭头和文字都需要保留'); await editor.locator('#save').click();
  await editor.waitForFunction(() => document.querySelector('#save-state').textContent.includes('已保存'));
  notes = await list(); assert.equal(notes.length, 2); const shot = notes.find(n => n.type === 'screenshot'); assert.ok(shot.image.startsWith('data:image/png;base64,')); assert.ok(shot.position.x > 0 && shot.position.y > 0);
  await editor.locator('#note').fill('修改截图备注'); await editor.locator('#save').click(); await editor.waitForTimeout(300); assert.equal((await list()).length, 2);
  await editor.screenshot({ path: path.join(results, 'screenshot-editor.png'), fullPage: true });
  pass('截图矩形/箭头/画笔/文字、裁剪、PNG持久保存和重复保存更新同一条记录');
  await editor.locator('#undo').click(); assert.equal(await canvas.evaluate(c => c.width), 1440); pass('撤销裁剪恢复原图尺寸');
  const pngPromise = editor.waitForEvent('download'); await editor.locator('#download').click(); await (await pngPromise).saveAs(path.join(results, 'annotated.png')); pass('标注图片下载');
  await library.bringToFront(); await library.reload(); await library.locator('.note-card').nth(1).waitFor();
  await library.screenshot({ path: path.join(results, 'library.png'), fullPage: true });
  await library.locator('#export-button').click(); const allBackupPromise = library.waitForEvent('download'); await library.locator('#export-json').click(); const allBackup = await allBackupPromise; const allPath = path.join(results, 'full-backup.json'); await allBackup.saveAs(allPath);
  const payload = JSON.parse(await readFile(allPath, 'utf8')); assert.equal(payload.notes.length, 2); assert.ok(payload.notes.find(n => n.type === 'screenshot').image);
  // Clear through trusted extension UI, then actually restore full JSON including image bytes.
  await library.evaluate(async () => { const { notes } = await chrome.runtime.sendMessage({ type: 'WN_LIST' }); for (const n of notes) await chrome.runtime.sendMessage({ type: 'WN_DELETE', id: n.id }); });
  assert.equal((await list()).length, 0); await library.locator('#import-file').setInputFiles(allPath); await library.waitForTimeout(350); assert.equal((await list()).length, 2); assert.equal((await list()).find(n => n.id === shot.id).image, shot.image); pass('完整备份恢复文字、定位和截图字节');
  await library.reload(); await library.locator('.note-card').nth(1).waitFor();
  const newPage = context.waitForEvent('page');
  await library.evaluate(id => chrome.runtime.sendMessage({ type: 'WN_OPEN_NOTE', id }), highlightId);
  const reopened = await newPage; await reopened.waitForURL(url); await reopened.waitForTimeout(900);
  assert.ok(await reopened.evaluate(() => window.scrollY > 0)); pass('从笔记库打开完整原文URL并自动跳到标记位置');
  const delayedUrl = `http://127.0.0.1:${server.address().port}/delayed`;
  const original = (await list()).find(n => n.id === highlightId);
  const delayedResult = await library.evaluate(note => chrome.runtime.sendMessage({ type: 'WN_SAVE', note }), { ...original, id: undefined, url: delayedUrl });
  assert.equal(delayedResult.ok, true);
  const delayedPagePromise = context.waitForEvent('page');
  await library.evaluate(id => chrome.runtime.sendMessage({ type: 'WN_OPEN_NOTE', id }), delayedResult.note.id);
  const delayedPage = await delayedPagePromise; await delayedPage.waitForURL(delayedUrl);
  await delayedPage.locator('#cross').waitFor(); await delayedPage.waitForTimeout(700);
  assert.ok(await delayedPage.evaluate(() => window.scrollY > 100)); pass('异步正文加载后仍能自动定位，而非提前放弃');
  // A strict host CSP must not disable the content script's constructed shadow styles.
  await page.goto(`http://127.0.0.1:${server.address().port}/strict`);
  await page.waitForFunction(() => document.querySelector('[data-webnotes-root]'));
  await library.evaluate(async strictUrl => { const tab = (await chrome.tabs.query({ url: strictUrl }))[0]; return chrome.tabs.sendMessage(tab.id, { type: 'WN_NEW_PAGE' }); }, page.url());
  assert.equal(await shadow('.panel', 'function(){return getComputedStyle(this).position}'), 'fixed'); pass('严格网页CSP下页内面板仍正常工作');
  await library.bringToFront(); await library.locator('#export-button').click(); const mdPromise = library.waitForEvent('download'); await library.locator('#export-markdown').click(); const md = await mdPromise; const mdPath = path.join(results, 'notes.md'); await md.saveAs(mdPath); assert.match(await readFile(mdPath, 'utf8'), /真正需要复习/); pass('Markdown 导出');
  assert.deepEqual(errors, []); pass('扩展页面无未捕获 JavaScript 错误');
  console.log(`完成 ${checks} 项浏览器端检查。预览位于 test-results/。`);
} finally {
  await context?.close(); server.close(); await rm(profile, { recursive: true, force: true });
}
