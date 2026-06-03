/** Browser-side helpers (evaluated in page context via page.evaluate strings). */

import { COLLECT_VISIBLE_ELEMENTS } from './agent/dom-collect';

export const CLICK_BY_INDEX_FN = `(function (idx) {
${COLLECT_VISIBLE_ELEMENTS}
  const target = collectVisibleElements()[idx];
  if (!target) throw new Error('No element at index ' + idx);
  target.click();
})`;

export const TYPE_BY_INDEX_FN = `(function (idx, text) {
${COLLECT_VISIBLE_ELEMENTS}
  const target = collectVisibleElements()[idx];
  if (!target) throw new Error('No element at index ' + idx);
  target.focus();
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
    target.value = text;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (target.isContentEditable) {
    target.textContent = text;
    target.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    throw new Error('Element at index ' + idx + ' is not typeable');
  }
})`;

export const SCROLL_FN = `(function (dir) {
  window.scrollBy(0, dir === 'down' ? 600 : -600);
})`;
