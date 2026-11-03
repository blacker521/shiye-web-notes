/** UI capability detection. An unreadable URL is different from an unsupported one. */
export function describePage(tab) {
  const address = tab?.url || tab?.pendingUrl;
  if (!address) return { kind: 'unknown', supported: false, label: '暂时无法读取页面地址', reason: '请在扩展详情中检查网站访问权限；本地 HTML 还需开启「允许访问文件网址」。' };
  let url;
  try { url = new URL(address); }
  catch { return { kind: 'restricted', supported: false, label: '页面地址无效', reason: '请在普通网页或本地 HTML 中使用。' }; }
  if (url.protocol === 'file:' && !url.hostname && !url.username && !url.password) {
    if (/\.pdf$/i.test(url.pathname)) return { kind: 'restricted', supported: false, label: '本地 PDF 阅读器', reason: '当前支持本地 HTML；浏览器内置 PDF 阅读器暂不支持标记。' };
    let name = url.pathname.split('/').pop() || '本地 HTML';
    try { name = decodeURIComponent(name); } catch { /* Display an encoded filename if it is malformed. */ }
    return { kind: 'local', supported: true, url: url.href, label: `本地文件 · ${name}` };
  }
  if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) {
    const store = url.hostname === 'chromewebstore.google.com' || url.hostname === 'chrome.google.com' && url.pathname.startsWith('/webstore') || url.hostname === 'microsoftedge.microsoft.com' && url.pathname.startsWith('/addons');
    if (!store) return { kind: 'web', supported: true, url: url.href, label: url.hostname };
    return { kind: 'restricted', supported: false, label: '浏览器扩展商店', reason: '浏览器不允许在扩展商店中运行标记工具，请换一个文章页。' };
  }
  return { kind: 'restricted', supported: false, label: '当前页面不支持标记', reason: '请打开 HTTP / HTTPS 网页或本地 HTML。浏览器内置页面不支持标记。' };
}

export function withTimeout(promise, milliseconds, label = '页面响应超时，请刷新后重试。') {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), milliseconds); })]).finally(() => clearTimeout(timer));
}
