const $ = (selector) => document.querySelector(selector);
const canvas = $('#canvas');
const context = canvas.getContext('2d');
const tools = [...document.querySelectorAll('[data-tool]')];
const captureId = new URLSearchParams(location.search).get('id');
const MAX_HISTORY = 60;
const state = {
  capture: null,
  image: null,
  crop: null,
  marks: [],
  history: [],
  tool: 'rect',
  draft: null,
  cropSelection: null,
  pointerId: null,
  savedId: null,
  saving: false,
  revision: 0,
  lastSavedRevision: 0,
};
let toastTimeout;

async function message(type, payload = {}) {
  if (!globalThis.chrome?.runtime?.sendMessage) {
    throw new Error('请先在 Chrome / Edge 中加载拾页扩展，再从网页发起截图。');
  }
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error || '操作没有完成，请重试。');
  return response;
}

function toast(text, error = false) {
  clearTimeout(toastTimeout);
  const element = $('#toast');
  element.textContent = text;
  element.classList.toggle('error', error);
  element.hidden = false;
  toastTimeout = setTimeout(() => { element.hidden = true; }, error ? 6500 : 3500);
}

function setDirty() {
  state.revision += 1;
  $('#save-state').textContent = '有修改尚未保存';
  $('#open-library').hidden = true;
}

function checkpoint() {
  state.history.push({ crop: { ...state.crop }, marks: structuredClone(state.marks) });
  if (state.history.length > MAX_HISTORY) state.history.shift();
}

function syncButtons() {
  const ready = Boolean(state.image);
  $('#undo').disabled = !state.history.length || state.saving;
  $('#reset').disabled = !ready || state.saving || (!state.marks.length && isFullCrop());
  $('#save').disabled = !ready || state.saving;
  $('#download').disabled = !ready || state.saving;
  $('#apply-crop').disabled = !state.cropSelection || state.saving;
}

function isFullCrop() {
  return state.crop && state.crop.x === 0 && state.crop.y === 0
    && state.crop.width === state.image.width && state.crop.height === state.image.height;
}

function chooseTool(tool) {
  if (!tools.some((button) => button.dataset.tool === tool)) return;
  cancelDraft();
  state.tool = tool;
  state.cropSelection = null;
  for (const button of tools) {
    button.classList.toggle('active', button.dataset.tool === tool);
    button.setAttribute('aria-pressed', String(button.dataset.tool === tool));
  }
  $('#text-options').hidden = tool !== 'text';
  $('#apply-crop').hidden = tool !== 'crop';
  $('#cancel-crop').hidden = tool !== 'crop';
  const hints = {
    rect: '拖动鼠标，用矩形框标记重点。',
    arrow: '从起点拖向终点，用箭头指出细节。',
    pen: '按住鼠标自由绘制，松开结束这一笔。',
    text: '输入标注文字，再点击截图放置。',
    crop: '拖动选择需要保留的区域，再点击「应用裁剪」。',
  };
  $('#tool-hint').textContent = hints[tool];
  canvas.style.cursor = tool === 'text' ? 'text' : 'crosshair';
  syncButtons();
  render();
  if (tool === 'text') $('#annotation-text').focus();
}

function getPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: state.crop.x + Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / rect.width)),
    y: state.crop.y + Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / rect.height)),
  };
}

function normalizeRect(start, end) {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
}

function styleForMark() {
  // Keep marks readable when a high-DPI capture is scaled down to CSS pixels.
  const scale = state.image.width / (state.capture.viewport?.width || state.image.width);
  return { color: $('#color').value, width: Number($('#line-width').value) * scale, fontSize: 22 * scale };
}

function paintMark(ctx, mark) {
  ctx.save();
  ctx.strokeStyle = mark.color;
  ctx.fillStyle = mark.color;
  ctx.lineWidth = mark.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (mark.type === 'rect') {
    const rect = normalizeRect(mark.start, mark.end);
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  } else if (mark.type === 'arrow') {
    const { start, end } = mark;
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const head = Math.max(mark.width * 4, mark.fontSize * .6);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  } else if (mark.type === 'pen') {
    ctx.beginPath();
    const [first, ...rest] = mark.points;
    ctx.moveTo(first.x, first.y);
    for (const point of rest) ctx.lineTo(point.x, point.y);
    if (!rest.length) ctx.lineTo(first.x + .01, first.y + .01);
    ctx.stroke();
  } else if (mark.type === 'text') {
    ctx.font = `600 ${mark.fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif`;
    ctx.textBaseline = 'top';
    // A pale backing keeps labels readable over both photographs and article text.
    const padding = mark.fontSize * .25;
    const width = ctx.measureText(mark.text).width;
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.fillRect(mark.start.x - padding, mark.start.y - padding, width + 2 * padding, mark.fontSize * 1.3 + padding);
    ctx.fillStyle = mark.color;
    ctx.fillText(mark.text, mark.start.x, mark.start.y);
  }
  ctx.restore();
}

function paintImage(ctx, includeDraft = false) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.save();
  ctx.translate(-state.crop.x, -state.crop.y);
  ctx.drawImage(state.image, 0, 0);
  for (const mark of state.marks) paintMark(ctx, mark);
  if (includeDraft && state.draft && state.draft.type !== 'crop') paintMark(ctx, state.draft);
  ctx.restore();
}

function render() {
  if (!state.image) return;
  if (canvas.width !== state.crop.width || canvas.height !== state.crop.height) {
    canvas.width = state.crop.width;
    canvas.height = state.crop.height;
  }
  paintImage(context, true);
  const selection = state.draft?.type === 'crop'
    ? normalizeRect(state.draft.start, state.draft.end) : state.cropSelection;
  if (selection) {
    const x = selection.x - state.crop.x;
    const y = selection.y - state.crop.y;
    context.save();
    context.fillStyle = 'rgba(20,40,30,.38)';
    context.beginPath();
    context.rect(0, 0, canvas.width, canvas.height);
    context.rect(x, y, selection.width, selection.height);
    context.fill('evenodd');
    context.strokeStyle = '#ffffff';
    context.lineWidth = Math.max(2, state.image.width / 600);
    context.setLineDash([context.lineWidth * 3, context.lineWidth * 2]);
    context.strokeRect(x, y, selection.width, selection.height);
    context.restore();
  }
  $('#dimensions').textContent = `${state.crop.width} × ${state.crop.height} px`;
}

function cancelDraft() {
  state.draft = null;
  if (state.pointerId !== null && canvas.hasPointerCapture(state.pointerId)) canvas.releasePointerCapture(state.pointerId);
  state.pointerId = null;
  render();
}

canvas.addEventListener('pointerdown', (event) => {
  if (!state.image || state.saving || event.button !== 0 || state.pointerId !== null) return;
  event.preventDefault();
  canvas.focus({ preventScroll: true });
  const point = getPoint(event);
  if (state.tool === 'text') {
    const text = $('#annotation-text').value.trim();
    if (!text) {
      toast('先在工具栏输入要标注的文字，再点击图片。');
      $('#annotation-text').focus();
      return;
    }
    checkpoint();
    state.marks.push({ type: 'text', start: point, text, ...styleForMark() });
    setDirty();
    render();
    syncButtons();
    return;
  }
  state.pointerId = event.pointerId;
  canvas.setPointerCapture(event.pointerId);
  state.cropSelection = null;
  state.draft = { type: state.tool, start: point, end: point, points: [point], ...styleForMark() };
  syncButtons();
  render();
});

canvas.addEventListener('pointermove', (event) => {
  if (!state.draft || state.pointerId !== event.pointerId) return;
  const point = getPoint(event);
  state.draft.end = point;
  if (state.draft.type === 'pen') {
    const previous = state.draft.points.at(-1);
    if (Math.hypot(point.x - previous.x, point.y - previous.y) > .75) state.draft.points.push(point);
  }
  render();
});

canvas.addEventListener('pointerup', (event) => {
  if (!state.draft || state.pointerId !== event.pointerId) return;
  state.draft.end = getPoint(event);
  const draft = state.draft;
  if (draft.type === 'crop') {
    const selected = normalizeRect(draft.start, draft.end);
    if (selected.width >= 8 && selected.height >= 8) state.cropSelection = selected;
    else toast('裁剪区域太小，请重新拖动选择。');
  } else if (draft.type === 'pen' || Math.hypot(draft.end.x - draft.start.x, draft.end.y - draft.start.y) > 3) {
    checkpoint();
    state.marks.push(draft);
    setDirty();
  }
  cancelDraft();
  syncButtons();
});

canvas.addEventListener('pointercancel', () => { cancelDraft(); syncButtons(); });
canvas.addEventListener('lostpointercapture', () => {
  if (state.pointerId !== null) { state.draft = null; state.pointerId = null; render(); }
});

for (const tool of tools) tool.addEventListener('click', () => chooseTool(tool.dataset.tool));

$('#apply-crop').addEventListener('click', () => {
  if (!state.cropSelection || state.saving) return;
  checkpoint();
  const rect = state.cropSelection;
  const x = Math.max(state.crop.x, Math.floor(rect.x));
  const y = Math.max(state.crop.y, Math.floor(rect.y));
  state.crop = {
    x, y,
    width: Math.min(state.crop.x + state.crop.width, Math.ceil(rect.x + rect.width)) - x,
    height: Math.min(state.crop.y + state.crop.height, Math.ceil(rect.y + rect.height)) - y,
  };
  state.cropSelection = null;
  setDirty();
  render();
  syncButtons();
  updatePosition();
  toast('已裁剪。可用撤销恢复原区域。');
});

$('#cancel-crop').addEventListener('click', () => {
  cancelDraft();
  state.cropSelection = null;
  render();
  syncButtons();
});

function undo() {
  if (!state.history.length || state.saving) return;
  cancelDraft();
  const previous = state.history.pop();
  state.crop = previous.crop;
  state.marks = previous.marks;
  state.cropSelection = null;
  setDirty();
  render();
  syncButtons();
  updatePosition();
}

$('#undo').addEventListener('click', undo);
$('#reset').addEventListener('click', () => {
  if (!state.image || state.saving || (!state.marks.length && isFullCrop())) return;
  checkpoint();
  cancelDraft();
  state.crop = { x: 0, y: 0, width: state.image.width, height: state.image.height };
  state.marks = [];
  state.cropSelection = null;
  setDirty();
  render();
  syncButtons();
  updatePosition();
  toast('已重置图片标记。笔记保留，可撤销此操作。');
});

document.addEventListener('keydown', (event) => {
  const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement;
  if (event.key === 'Escape') {
    cancelDraft();
    state.cropSelection = null;
    render();
    syncButtons();
    return;
  }
  if (editing) return;
  if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    undo();
  } else if (!event.metaKey && !event.ctrlKey && !event.altKey) {
    const shortcuts = { r: 'rect', a: 'arrow', p: 'pen', t: 'text', c: 'crop' };
    if (shortcuts[event.key.toLowerCase()]) { event.preventDefault(); chooseTool(shortcuts[event.key.toLowerCase()]); }
  }
});

$('#note').addEventListener('input', () => {
  $('#note-count').textContent = `${$('#note').value.length} / 20000`;
  setDirty();
});

function finalCanvas() {
  const result = document.createElement('canvas');
  result.width = state.crop.width;
  result.height = state.crop.height;
  paintImage(result.getContext('2d'));
  return result;
}

function croppedPosition() {
  const position = state.capture.position || { x: 0, y: 0, ratio: 0 };
  return {
    ...position,
    x: Math.round((Number(position.x) || 0) + state.crop.x * (state.capture.viewport?.width || state.image.width) / state.image.width),
    y: Math.round((Number(position.y) || 0) + state.crop.y * (state.capture.viewport?.height || state.image.height) / state.image.height),
  };
}

function updatePosition() {
  const position = croppedPosition();
  $('#source-position').textContent = `距页顶 ${position.y.toLocaleString('zh-CN')} px`;
}

$('#download').addEventListener('click', async () => {
  if (!state.image || state.saving) return;
  try {
    const blob = await new Promise((resolve, reject) => finalCanvas().toBlob((result) => result ? resolve(result) : reject(new Error('PNG 生成失败，请重试。')), 'image/png'));
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    const title = (state.capture.title || '网页截图').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 70);
    anchor.download = `拾页-${title}-${new Date().toISOString().slice(0, 10)}.png`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(href), 30000);
    toast('已发起 PNG 下载。');
  } catch (error) { toast(error.message, true); }
});

$('#save').addEventListener('click', async () => {
  if (!state.image || state.saving) return;
  state.saving = true;
  syncButtons();
  const button = $('#save');
  button.textContent = '正在保存…';
  const revision = state.revision;
  try {
    const image = finalCanvas().toDataURL('image/png');
    const encodedImage = image.slice(image.indexOf(',') + 1);
    const padding = encodedImage.endsWith('==') ? 2 : encodedImage.endsWith('=') ? 1 : 0;
    if (encodedImage.length * .75 - padding > 20 * 1024 * 1024) throw new Error('图片超过 20 MB，请先裁剪后再保存。');
    const { note } = await message('WN_SAVE', {
      note: {
        ...(state.savedId ? { id: state.savedId } : {}),
        type: 'screenshot',
        url: state.capture.url,
        title: state.capture.title,
        quote: '',
        note: $('#note').value,
        color: 'yellow',
        position: croppedPosition(),
        image,
      },
    });
    state.savedId = note.id;
    // Save the revision actually sent, so edits made while awaiting storage stay dirty.
    state.lastSavedRevision = revision;
    const unchanged = revision === state.revision;
    $('#save-state').textContent = unchanged ? '已保存到本机' : '截图已保存，还有新修改待保存';
    $('#open-library').hidden = !unchanged;
    toast(unchanged ? '截图与笔记已保存，原文位置也一起记下了。' : '已保存。刚刚输入的新笔记仍需再次保存。');
  } catch (error) {
    toast(`保存失败：${error.message} 编辑内容已保留。`, true);
    $('#save-state').textContent = '保存未完成，请重试';
  } finally {
    state.saving = false;
    button.textContent = state.savedId ? '更新笔记' : '保存到笔记库 ↗';
    syncButtons();
  }
});

window.addEventListener('beforeunload', (event) => {
  // Keep the original capture for reloads; the background expires old captures after 24 hours.
  if (state.revision === state.lastSavedRevision) return;
  event.preventDefault();
  event.returnValue = '';
});

async function init() {
  try {
    if (!captureId) throw new Error('没有找到截图编号。请回到原网页，点击拾页扩展中的截图按钮。');
    const { capture } = await message('WN_GET_CAPTURE', { id: captureId });
    if (!capture?.image || !/^data:image\/(png|jpeg);base64,/.test(capture.image)) throw new Error('截图已过期或格式无效，请重新截取。');
    const url = new URL(capture.url);
    const localFile = url.protocol === 'file:' && ['', 'localhost'].includes(url.hostname);
    if ((!['http:', 'https:'].includes(url.protocol) && !localFile) || url.username || url.password) {
      throw new Error('截图来源须为 HTTP / HTTPS 网页或本机文件，且地址不能包含用户名或密码。');
    }
    const image = new Image();
    image.src = capture.image;
    await image.decode();
    if (!image.width || !image.height) throw new Error('截图尺寸无效，请重新截取。');
    state.capture = capture;
    state.image = image;
    state.crop = { x: 0, y: 0, width: image.width, height: image.height };
    let sourcePath = url.pathname;
    if (localFile) {
      try { sourcePath = decodeURIComponent(sourcePath); } catch { /* Keep malformed escapes readable without blocking a valid file URL. */ }
    }
    $('#source-title').textContent = capture.title || (localFile ? sourcePath.split('/').pop() || '本地文件' : '未命名网页');
    $('#source-url').textContent = localFile ? `本地文件 · ${sourcePath}${url.search}${url.hash}` : url.href;
    $('#source-url').title = url.href;
    $('#source-url').href = url.href;
    $('#note').disabled = false;
    $('#loading').hidden = true;
    canvas.hidden = false;
    $('#canvas-area').setAttribute('aria-busy', 'false');
    render();
    syncButtons();
    updatePosition();
  } catch (error) {
    $('#loading').hidden = true;
    $('#load-error').hidden = false;
    $('#load-error-text').textContent = error.message;
    $('#source-title').textContent = '尚未载入截图';
    $('#dimensions').textContent = '未载入';
    $('#canvas-area').setAttribute('aria-busy', 'false');
  }
}

await init();
