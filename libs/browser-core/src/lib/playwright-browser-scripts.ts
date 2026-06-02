/** Browser-side helpers (evaluated in page context via page.evaluate strings). */

const COLLECT_VISIBLE_ELEMENTS = `
  function collectVisibleElements() {
    const nodes = document.querySelectorAll(
      'a, button, input, textarea, select, [role="button"], [role="link"]'
    );
    const visible = [];
    const seen = new Set();
    for (let i = 0; i < nodes.length; i++) {
      if (visible.length >= 80) break;
      const el = nodes[i];
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      const text = (el.innerText || el.getAttribute('aria-label') || '').trim();
      if (!text && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') continue;
      const key = el.tagName + text;
      if (seen.has(key)) continue;
      seen.add(key);
      visible.push(el);
    }
    return visible;
  }
`;

export const CLICK_BY_INDEX_FN = `(function (idx) {
${COLLECT_VISIBLE_ELEMENTS}
  const target = collectVisibleElements()[idx];
  if (!target) throw new Error('No element at index ' + idx);
  target.click();
})`;

export const FOCUS_INPUT_BY_INDEX_FN = `(function (idx) {
${COLLECT_VISIBLE_ELEMENTS}
  const target = collectVisibleElements()[idx];
  if (!target) throw new Error('No element at index ' + idx);
  target.focus();
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
    if (typeof target.select === 'function') target.select();
  }
})`;

export const SCROLL_FN = `(function (dir) {
  window.scrollBy(0, dir === 'down' ? 600 : -600);
})`;
