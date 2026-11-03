/* Runs in the content script's isolated world. No page DOM wrappers required. */
(() => {
  if (globalThis.WebNotesAnchors) return;
  const excluded = 'script,style,noscript,textarea,input,select,option,[contenteditable="true"],[hidden],[data-webnotes-root]';
  function index(root = document.body) {
    const entries = [];
    let text = '';
    if (!root) return { text, entries };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.parentElement?.closest(excluded) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    let node;
    while ((node = walker.nextNode())) {
      entries.push({ node, start: text.length, end: text.length + node.length });
      text += node.data;
    }
    return { text, entries };
  }
  function boundaryOffset(container, offset, data) {
    for (const entry of data.entries) {
      if (entry.node === container) return entry.start + Math.min(offset, entry.node.length);
      const test = document.createRange();
      test.selectNodeContents(entry.node);
      const relation = test.comparePoint(container, offset);
      if (relation < 0) return entry.start;
      if (relation === 0) return entry.end;
    }
    return data.text.length;
  }
  function serialize(range, data = index()) {
    const start = boundaryOffset(range.startContainer, range.startOffset, data);
    const end = boundaryOffset(range.endContainer, range.endOffset, data);
    const exact = data.text.slice(start, end);
    if (!exact.trim() || exact.length > 20000) throw new Error('请选择 1～20,000 字的正文内容。');
    return { exact, start, end, prefix: data.text.slice(Math.max(0, start - 64), start), suffix: data.text.slice(end, end + 64) };
  }
  function locate(text, anchor) {
    if (!anchor?.exact) return null;
    const exact = anchor.exact;
    // Context disambiguates repeated text when articles insert content before a mark.
    let best = null;
    let cursor = 0;
    while (cursor <= text.length) {
      const start = text.indexOf(exact, cursor);
      if (start === -1) break;
      const end = start + exact.length;
      let score = 0;
      const prefix = anchor.prefix || '';
      const suffix = anchor.suffix || '';
      for (let n = 1; n <= prefix.length && start >= n; n++) {
        if (text[start - n] !== prefix[prefix.length - n]) break;
        score += 2;
      }
      for (let n = 0; n < suffix.length && end + n < text.length; n++) {
        if (text[end + n] !== suffix[n]) break;
        score += 2;
      }
      score -= Math.min(1, Math.abs(start - (anchor.start || 0)) / Math.max(1, text.length));
      if (!best || score > best.score) best = { start, end, score };
      cursor = start + Math.max(1, exact.length);
    }
    return best && { start: best.start, end: best.end };
  }
  function range(anchor, data = index()) {
    const offsets = locate(data.text, anchor);
    if (!offsets) return null;
    const first = data.entries.find(e => e.end > offsets.start);
    const last = data.entries.find(e => e.end >= offsets.end && e.start < offsets.end);
    if (!first || !last) return null;
    const value = document.createRange();
    value.setStart(first.node, offsets.start - first.start);
    value.setEnd(last.node, offsets.end - last.start);
    return value;
  }
  globalThis.WebNotesAnchors = { index, serialize, locate, range };
})();
