import test from 'node:test';
import assert from 'node:assert/strict';
import { describePage, withTimeout } from '../page-access.js';

test('本地中文HTML被识别为可支持页面，而不是HTTP错误', () => {
  const page = describePage({ url: 'file:///Users/demo/%E5%AE%9E%E9%AA%8C.html?mode=read#section', title: '实验' });
  assert.equal(page.kind, 'local'); assert.equal(page.supported, true); assert.match(page.label, /本地文件 · 实验.html/);
  assert.ok(page.url.endsWith('?mode=read#section'));
});
test('缺少URL显示访问权限提示，不误判为内置页', () => {
  assert.equal(describePage({ title: '本地文章' }).kind, 'unknown');
  assert.equal(describePage({ pendingUrl: 'https://example.com' }).supported, true);
});
test('正常网页保持可用，内置页、商店、PDF及危险地址不给错误的操作入口', () => {
  assert.equal(describePage({ url: 'https://example.com/article' }).supported, true);
  for (const url of ['chrome://settings/', 'chrome-extension://other/page.html', 'javascript:alert(1)', 'file://server/share/article.html', 'file:///tmp/paper.PDF', 'https://chromewebstore.google.com/detail/test']) assert.equal(describePage({ url }).supported, false, url);
});
test('无响应的检测有截止时间，正常完成与错误照常传递', async () => {
  assert.equal(await withTimeout(Promise.resolve('ready'), 30), 'ready');
  await assert.rejects(withTimeout(new Promise(() => {}), 10, '响应超时'), /响应超时/);
  await assert.rejects(withTimeout(Promise.reject(new Error('无权限')), 30), /无权限/);
});
