import test from 'node:test';
import assert from 'node:assert/strict';
await import('../anchors.js');
const { locate } = globalThis.WebNotesAnchors;
test('使用上下文区分重复原文，插入前文后仍定位正确', () => {
  const text = '新增内容 / 第一处 好笔记 错误上下文 / 第二处 好笔记 正确上下文';
  assert.deepEqual(locate(text, { exact: '好笔记', prefix: '第二处 ', suffix: ' 正确上下文', start: 0 }), { start: text.lastIndexOf('好笔记'), end: text.lastIndexOf('好笔记') + 3 });
});
test('文字已被移除时返回未匹配，不随意定位到其他内容', () => {
  assert.equal(locate('文章已重写', { exact: '旧文章摘录', start: 1 }), null);
});
test('缺少上下文时使用最接近原位置的重复文本', () => {
  assert.deepEqual(locate('a重点bc重点d', { exact: '重点', start: 5 }), { start: 5, end: 7 });
});
