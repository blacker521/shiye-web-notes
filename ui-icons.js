const namespace = 'http://www.w3.org/2000/svg';
const names = new Set(['grid', 'highlighter', 'note', 'image', 'globe', 'folder', 'search', 'pencil']);

/** Bundled vectors render consistently without a font or an external icon service. */
export function icon(name, className = '') {
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('class', `ui-icon ${className}`.trim());
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20'); svg.setAttribute('height', '20');
  svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(namespace, 'use');
  use.setAttribute('href', `icons/ui.svg#${names.has(name) ? name : 'globe'}`);
  svg.append(use);
  return svg;
}

/** Resolve only through the browser's favicon resource, never a third-party proxy. */
export function sourceIcon(note, className = '') {
  const wrapper = document.createElement('span');
  wrapper.className = `source-mark ${className}`.trim(); wrapper.setAttribute('aria-hidden', 'true');
  let page;
  try { page = new URL(note?.url); } catch { /* Invalid sources receive the generic symbol. */ }
  if (page?.protocol === 'file:' && !page.hostname) { wrapper.append(icon('folder')); return wrapper; }
  if (!page || !['https:', 'http:'].includes(page.protocol) || page.username || page.password) { wrapper.append(icon('globe')); return wrapper; }
  const fallback = document.createElement('span');
  fallback.className = 'source-fallback';
  fallback.textContent = (page.hostname.replace(/^www\./i, '').charAt(0) || '?').toUpperCase();
  wrapper.append(fallback);
  if (!globalThis.chrome?.runtime?.getURL) return wrapper;
  const image = document.createElement('img');
  image.className = 'source-favicon'; image.alt = ''; image.width = 20; image.height = 20;
  image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
  image.addEventListener('load', () => {
    if (image.naturalWidth) fallback.hidden = true;
    else { image.remove(); fallback.hidden = false; }
  });
  image.addEventListener('error', () => { image.remove(); fallback.hidden = false; });
  const url = new URL(chrome.runtime.getURL('_favicon/'));
  // Chromium's favicon cache keys can include fragments; use the exact visited URL.
  url.searchParams.set('pageUrl', page.href); url.searchParams.set('size', '32');
  image.src = url.href; wrapper.append(image);
  return wrapper;
}
