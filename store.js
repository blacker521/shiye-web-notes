/** Pure validation and merge helpers, shared by the service worker and tests. */
export const LIMITS = Object.freeze({ notes: 10_000, importBytes: 150 * 1024 * 1024, libraryBytes: 140 * 1024 * 1024, imageBytes: 20 * 1024 * 1024 });
export const COLORS = Object.freeze(['yellow', 'green', 'blue', 'pink']);
const TYPES = new Set(['highlight', 'page', 'screenshot']);
const FORBIDDEN_IDS = new Set(['__proto__', 'prototype', 'constructor']);

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}格式不正确`);
  return value;
}
function string(value, label, max, fallback = '') {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label}须为不超过 ${max} 字的文本`);
  return value;
}
function finite(value, label, min = 0, max = 1e9, fallback = 0) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label}超出有效范围`);
  return value;
}
export function validateId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value) || FORBIDDEN_IDS.has(value)) throw new Error('笔记 ID 格式不正确');
  return value;
}
/** Canonical full URL; file URLs are limited to paths on this machine. */
export function parsePageUrl(value) {
  const address = string(value, '网页地址', 32_768);
  let url;
  try { url = new URL(address); } catch { throw new Error('网页地址无效，请使用完整的 HTTP / HTTPS 或本地 file:/// 地址'); }
  if (!['http:', 'https:', 'file:'].includes(url.protocol)) throw new Error('仅支持 HTTP / HTTPS 网页和本地 HTML 文件');
  if (url.username || url.password) throw new Error('网页地址不能包含用户名或密码');
  // WHATWG URL already normalizes file://localhost/ to file:///.
  if (url.protocol === 'file:' && (url.hostname || !url.pathname.startsWith('/'))) throw new Error('仅支持本机 file:/// 文件，不支持远程文件服务器');
  return url;
}
export function normalizePageUrl(value) {
  const url = parsePageUrl(value);
  url.hash = '';
  return url.href;
}
function date(value, label, fallback) {
  if (value === undefined && fallback) return fallback;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error(`${label}无效`);
  return new Date(value).toISOString();
}
export function validateImage(value) {
  if (typeof value !== 'string' || value.length > Math.ceil(LIMITS.imageBytes / 3) * 4 + 32) throw new Error('每张截图最多 20 MB');
  const comma = value.indexOf(',');
  const mime = value.slice(0, comma);
  if (!['data:image/png;base64', 'data:image/jpeg;base64'].includes(mime)) throw new Error('截图须为 PNG / JPEG 格式');
  const data = value.slice(comma + 1);
  if (!data || data.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(data) || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error('截图的 Base64 数据无效');
  if ((mime.includes('png') && !data.startsWith('iVBORw0KGgo')) || (mime.includes('jpeg') && !data.startsWith('/9j/'))) throw new Error('截图内容与图片格式不符');
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  if (data.length * 3 / 4 - padding > LIMITS.imageBytes) throw new Error('每张截图最多 20 MB');
  return value;
}

export function validateNote(input, options = {}) {
  object(input, '笔记');
  const now = options.now || new Date().toISOString();
  const id = validateId(input.id === undefined && !options.requireId ? (options.id || crypto.randomUUID()) : input.id);
  if (!TYPES.has(input.type)) throw new Error('笔记类型无效');
  const pageKey = normalizePageUrl(input.url);
  const url = parsePageUrl(input.url).href;
  const color = input.color === undefined ? 'yellow' : input.color;
  if (!COLORS.includes(color)) throw new Error('标记颜色无效');
  const position = input.position === undefined ? {} : object(input.position, '页面位置');
  const note = {
    id,
    type: input.type,
    url,
    pageKey,
    title: string(input.title, '网页标题', 8192),
    quote: string(input.quote, '原文摘录', 200_000),
    note: string(input.note, '笔记正文', 200_000),
    color,
    position: {
      x: finite(position.x, '横向位置'),
      y: finite(position.y, '纵向位置'),
      ratio: finite(position.ratio, '页面进度', 0, 1),
    },
    createdAt: date(input.createdAt, '创建时间', options.requireTimestamps ? undefined : now),
    updatedAt: date(input.updatedAt, '修改时间', options.requireTimestamps ? undefined : now),
  };
  if (input.type === 'highlight' && !note.quote.trim()) throw new Error('文字标记必须包含原文摘录');
  if (input.anchor !== undefined) {
    const anchor = object(input.anchor, '文字定位');
    note.anchor = {
      exact: string(anchor.exact, '定位原文', 200_000, note.quote),
      prefix: string(anchor.prefix, '前文', 2048),
      suffix: string(anchor.suffix, '后文', 2048),
      start: finite(anchor.start, '文字起点', 0, Number.MAX_SAFE_INTEGER),
      end: finite(anchor.end, '文字终点', 0, Number.MAX_SAFE_INTEGER),
    };
    if (note.anchor.end < note.anchor.start) throw new Error('文字定位终点不能早于起点');
  }
  if (input.type === 'screenshot') note.image = validateImage(input.image);
  return note;
}

export function validateImport(payload) {
  object(payload, '备份文件');
  if (payload.version !== 1 || !Array.isArray(payload.notes)) throw new Error('请选择 version: 1 的拾页 JSON 备份');
  if (payload.notes.length > LIMITS.notes) throw new Error('一次最多导入 10,000 条笔记');
  let bytes = 0;
  const ids = new Set();
  return payload.notes.map((input, index) => {
    try {
      const note = validateNote(input, { requireId: true, requireTimestamps: true });
      bytes += new TextEncoder().encode(JSON.stringify(note)).byteLength;
      if (bytes > LIMITS.importBytes) throw new Error('备份文件最多 150 MB');
      if (ids.has(note.id)) throw new Error('备份文件中存在重复笔记 ID');
      ids.add(note.id);
      return note;
    } catch (error) {
      throw new Error(`第 ${index + 1} 条笔记：${error.message}`);
    }
  });
}

/** The library stays below the JSON import ceiling, including pretty-print overhead. */
export function assertLibrarySize(notes, limit = LIMITS.libraryBytes) {
  const serialized = JSON.stringify(notes);
  if (serialized.length > limit || new TextEncoder().encode(serialized).byteLength > limit) throw new Error('本地笔记库最多 140 MB，请先导出并整理旧笔记');
  // Exports indent each note two additional spaces inside the wrapper object.
  // Validate the exact backup shape too, leaving room for the export timestamp.
  const backup = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), notes }, null, 2);
  if (backup.length > LIMITS.importBytes || new TextEncoder().encode(backup).byteLength > LIMITS.importBytes) throw new Error('完整备份将超过 150 MB，请先导出并整理旧笔记');
}

export function noteMetadata(note) {
  const { image, ...metadata } = note;
  return metadata;
}

export function mergeNotes(existing, incoming) {
  const records = new Map(existing.map(note => [note.id, note]));
  let imported = 0;
  let updated = 0;
  for (const note of incoming) {
    const previous = records.get(note.id);
    if (!previous) {
      records.set(note.id, note);
      imported++;
    } else if (Date.parse(note.updatedAt) > Date.parse(previous.updatedAt)) {
      records.set(note.id, note);
      updated++;
    }
  }
  if (records.size > LIMITS.notes) throw new Error('本地笔记总数最多 10,000 条，请先导出并整理旧笔记');
  return { notes: [...records.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)), imported, updated, total: records.size, count: imported + updated };
}

/** A rejection must not poison later writes; keep the whole read-modify-write in this queue. */
export function createMutationQueue() {
  let pending = Promise.resolve();
  return task => {
    const result = pending.then(task);
    pending = result.catch(() => {});
    return result;
  };
}

/** Content scripts may only inspect and mutate records of their own page. */
export function authorizeMessage(message, sender, extensionId, extensionRoot) {
  if (sender?.id !== extensionId) throw new Error('消息来源无效');
  const trusted = typeof sender.url === 'string' && sender.url.startsWith(extensionRoot);
  if (trusted) return { trusted: true, pageKey: null };
  if (!sender.tab || sender.frameId && sender.frameId !== 0) throw new Error('此操作需要在网页顶层执行');
  const pageKey = normalizePageUrl(sender.tab.url || sender.url);
  if (!['WN_LIST', 'WN_SAVE', 'WN_DELETE', 'WN_PENDING', 'WN_OPEN_LIBRARY'].includes(message.type)) throw new Error('请通过扩展界面执行此操作');
  if (message.type === 'WN_LIST' && message.url && normalizePageUrl(message.url) !== pageKey) throw new Error('不能读取其他网页的笔记');
  if (message.type === 'WN_SAVE' && normalizePageUrl(message.note?.url) !== pageKey) throw new Error('不能修改其他网页的笔记');
  return { trusted: false, pageKey };
}
