import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const results = path.join(root, 'test-results');
await mkdir(results, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), 'webnotes-icons-test-'));

// Generate an identifiable PNG locally: a cream bookmark on a deep green square.
// No image library, icon service, or external network is needed for this test.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, body) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(body.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, body])));
  return Buffer.concat([length, name, body, crc]);
}
function faviconPng() {
  const size = 32;
  const pixels = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = y * (1 + size * 4) + 1 + x * 4;
      const bookmark = x >= 10 && x <= 21 && y >= 7 && y <= 24 && (y < 21 || Math.abs(x - 15.5) >= y - 21);
      pixels.set(bookmark ? [255, 235, 158, 255] : [37, 78, 59, 255], offset);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
const favicon = faviconPng();
let faviconRequests = 0;
const server = createServer((req, res) => {
  if (req.url.startsWith('/favicon.png') || req.url.startsWith('/favicon.ico')) {
    faviconRequests++;
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600' });
    res.end(favicon);
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html;charset=utf-8' });
  res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>留住阅读时的好想法</title><link rel="icon" href="/favicon.png" type="image/png" sizes="32x32"><style>body{margin:0;background:#f8f8f3;color:#263c32;font:17px/1.9 sans-serif}main{max-width:800px;margin:90px auto;padding:55px;background:white;border:1px solid #e5e8df;border-radius:16px}small{color:#839076;letter-spacing:3px}h1{font-size:38px;font-weight:600}blockquote{border-left:3px solid #decf77;margin:35px 0;padding:15px 24px;background:#fffbed}</style></head><body><main><small>READING NOTES</small><h1>留住阅读时的好想法</h1><p>阅读的价值，常常发生在停下来思考的那一刻。给重点留个标记，也给当时的自己留下一条线索。</p><blockquote>记录的不只是信息，还有自己如何理解这些信息。</blockquote><p>下次回来时，从笔记跳到原文，继续这场尚未结束的对话。</p></main></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const articleUrl = `${origin}/article?mode=icons#reading`;
const localUrl = `${pathToFileURL(path.join(root, 'demo/article.html')).href}?mode=icons#reading`;
let context;
let checks = 0;
const errors = [];
const externalRequests = [];
const pass = label => { checks++; console.log(`✓ ${label}`); };

async function waitUntil(predicate, label, timeout = 10_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`等待超时：${label}`);
}

try {
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    viewport: { width: 1440, height: 1000 },
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route(/^https?:\/\//, route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    externalRequests.push(route.request().url());
    return route.abort();
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extension = `chrome-extension://${new URL(worker.url()).host}/`;
  assert.ok(await worker.evaluate(() => chrome.runtime.getManifest().permissions.includes('favicon')), '扩展声明 favicon 权限');

  // Visit a real article before opening the library: Chromium's favicon database
  // must have seen this tab's icon; a generic browser default would be a weak test.
  const article = await context.newPage();
  await article.goto(articleUrl);
  await waitUntil(() => faviconRequests > 0, '浏览器缓存本地文章 favicon');
  pass('访问本地 HTTP 文章并缓存自带 PNG favicon');
  const screenshot = `data:image/png;base64,${(await article.screenshot()).toString('base64')}`;

  const library = await context.newPage();
  await library.goto(`${extension}library.html`);
  await library.locator('#loading').waitFor({ state: 'hidden' });
  const saved = await library.evaluate(async ({ articleUrl, localUrl, screenshot }) => {
    const base = { position: { x: 0, y: 180, ratio: .1 }, color: 'yellow', quote: '' };
    const notes = [
      { ...base, type: 'highlight', url: articleUrl, title: '把网页读成自己的知识', quote: '记录的不只是信息，还有自己如何理解这些信息。', note: '记下原句，再加上自己的理解。重点就成为了可以再次出发的线索。' },
      { ...base, type: 'page', url: articleUrl, title: '阅读时留下问题', color: 'green', note: '这个观点还可以用在哪些场景？下次回来时，沿着问题继续阅读。' },
      { ...base, type: 'screenshot', url: articleUrl, title: '值得保存的阅读现场', color: 'blue', image: screenshot, note: '把上下文一起留下，帮助自己重新找到当时的想法。' },
      { ...base, type: 'page', url: localUrl, title: '本地 HTML 阅读笔记', color: 'pink', note: '本地文件使用文件夹图标；原始文件路径和位置仍然随笔记保存。' },
    ];
    const responses = [];
    for (const note of notes) responses.push(await chrome.runtime.sendMessage({ type: 'WN_SAVE', note }));
    return responses;
  }, { articleUrl, localUrl, screenshot });
  for (const response of saved) assert.equal(response.ok, true, response.error);
  await waitUntil(async () => await library.locator('.note-card').count() === 4, '四条记录渲染');

  async function assertBundledIcons(selector, names) {
    assert.equal(await library.locator(selector).count(), names.length, `${selector} SVG 数量`);
    await library.waitForFunction(selector => [...document.querySelectorAll(selector)].every(svg => {
      const box = svg.getBBox();
      return box.width > 0 && box.height > 0;
    }), selector);
    const icons = await library.locator(selector).evaluateAll(elements => elements.map(svg => {
      const use = svg.querySelector('use');
      const href = new URL(use?.getAttribute('href') || '', location.href);
      const rect = svg.getBoundingClientRect();
      return { origin: href.protocol + '//' + href.host + '/', path: href.pathname, id: href.hash.slice(1), width: rect.width, height: rect.height, hidden: svg.getAttribute('aria-hidden') };
    }));
    assert.deepEqual(icons.map(icon => icon.id), names);
    for (const icon of icons) {
      assert.equal(icon.origin, extension);
      assert.equal(icon.path, '/icons/ui.svg');
      assert.ok(icon.width >= 14 && icon.height >= 14, '本地 SVG 实际可见尺寸');
      assert.equal(icon.hidden, 'true');
    }
  }
  await assertBundledIcons('#type-nav svg.nav-icon', ['grid', 'highlighter', 'note', 'image']);
  pass('侧边栏四个分类使用实际渲染的本地 SVG 图标');
  await assertBundledIcons('.summary svg.stat-icon', ['note', 'globe', 'image']);
  await assertBundledIcons('.search-box svg', ['search']);
  pass('统计区三个图标和搜索图标均使用本地 SVG');

  const site = library.locator('#site-list .site-button[title="127.0.0.1"]');
  const localSite = library.locator('#site-list .site-button[title="本地文件"]');
  const websiteCards = library.locator('.note-card').filter({ has: library.locator('.card-source[title^="http:"]') });
  const localCard = library.locator('.note-card').filter({ has: library.locator('.card-title', { hasText: '本地 HTML 阅读笔记' }) });
  const siteImage = site.locator('img.source-favicon');
  await siteImage.waitFor();
  await waitUntil(() => siteImage.evaluate(image => image.complete && image.naturalWidth > 0), '来源网站 favicon 加载');
  assert.equal(await websiteCards.locator('img.source-favicon').count(), 3);
  await waitUntil(() => websiteCards.locator('img.source-favicon').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)), '卡片 favicon 加载');
  const faviconMetadata = await siteImage.evaluate(async image => {
    await image.decode();
    const url = new URL(image.src);
    const c = document.createElement('canvas'); c.width = 32; c.height = 32;
    const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0, 32, 32);
    return { origin: url.protocol + '//' + url.host + '/', pathname: url.pathname, size: url.searchParams.get('size'), pageUrl: url.searchParams.get('pageUrl'), background: [...ctx.getImageData(3, 3, 1, 1).data], bookmark: [...ctx.getImageData(15, 12, 1, 1).data] };
  });
  assert.equal(faviconMetadata.origin, extension);
  assert.equal(faviconMetadata.pathname, '/_favicon/');
  assert.equal(faviconMetadata.size, '32');
  assert.equal(faviconMetadata.pageUrl, articleUrl, 'favicon 缓存必须使用包含片段的原始文章 URL');
  assert.deepEqual(faviconMetadata.background, [37, 78, 59, 255], '网站真实 favicon 的绿色背景');
  assert.deepEqual(faviconMetadata.bookmark, [255, 235, 158, 255], '网站真实 favicon 的书签图案');
  assert.equal(await site.locator('.source-fallback').isHidden(), true);
  pass('来源网站及三张卡片从 Chrome favicon 缓存加载真实站点图标');

  assert.equal(await localSite.locator('img').count(), 0);
  assert.equal(await localCard.locator('.source-mark img').count(), 0);
  assert.equal(await localSite.locator('svg use').getAttribute('href'), 'icons/ui.svg#folder');
  assert.equal(await localCard.locator('.source-mark svg use').getAttribute('href'), 'icons/ui.svg#folder');
  const localFaviconRequest = await library.evaluate(() => performance.getEntriesByType('resource').some(entry => {
    const url = new URL(entry.name);
    return url.pathname === '/_favicon/' && url.searchParams.get('pageUrl')?.startsWith('file:');
  }));
  assert.equal(localFaviconRequest, false, '本地文件不请求 favicon');
  pass('本地文件的来源和卡片均显示文件夹 SVG，且未请求 favicon');

  await library.screenshot({ path: path.join(results, 'library-icons.png'), fullPage: true });
  await library.locator('.sidebar').screenshot({ path: path.join(results, 'sidebar-icons.png') });

  // Force the browser error path after a successful load, exercising the actual
  // listener rather than a synthetic substitute or a network-only assertion.
  await siteImage.evaluate(image => image.dispatchEvent(new Event('error')));
  assert.equal(await site.locator('img.source-favicon').count(), 0);
  assert.equal(await site.locator('.source-fallback').isVisible(), true);
  assert.equal(await site.locator('.source-fallback').textContent(), '1');
  const card = websiteCards.first();
  await card.locator('img.source-favicon').evaluate(image => image.dispatchEvent(new Event('error')));
  assert.equal(await card.locator('img.source-favicon').count(), 0);
  assert.equal(await card.locator('.source-fallback').isVisible(), true);
  pass('网站和卡片图标加载失败时移除图片，显示可见的首字母回退');

  await site.click();
  assert.equal(await library.locator('.note-card').count(), 3);
  assert.match(await library.locator('#results-title').textContent(), /127\.0\.0\.1/);
  await library.locator('[data-type="highlight"]').click();
  assert.equal(await library.locator('.note-card').count(), 1);
  await library.locator('[data-type="screenshot"]').click();
  assert.equal(await library.locator('.note-card').count(), 1);
  await library.locator('[data-type="all"]').click();
  await localSite.click();
  assert.equal(await library.locator('.note-card').count(), 1);
  assert.match(await library.locator('.card-title').textContent(), /本地 HTML/);
  await library.locator('#reset-filters').click();
  assert.equal(await library.locator('.note-card').count(), 4);
  await library.locator('#search').fill('留下问题');
  assert.equal(await library.locator('.note-card').count(), 1);
  await library.locator('#search').fill('');
  assert.equal(await library.locator('.note-card').count(), 4);
  pass('网站筛选、分类切换、本地来源筛选及搜索保持可用');
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
  pass('无未捕获 JavaScript 错误，也没有外部 HTTP 请求');
  console.log(`完成 ${checks} 项图标专项浏览器检查，预览位于 test-results/library-icons.png 和 test-results/sidebar-icons.png。`);
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
