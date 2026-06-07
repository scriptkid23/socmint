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
  const picked = collectVisibleElements()[idx];
  if (!picked) throw new Error('No element at index ' + idx);

  // The agent often picks a wrapper/label/custom widget rather than the bare
  // <input> (which dom-collect may dedupe away when it has no text). Resolve to
  // the actual typeable field by checking the element itself, its label target,
  // and any nested/sibling field within its container.
  function resolveField(el) {
    if (!el) return null;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return el;
    if (el.tagName === 'LABEL') {
      const forId = el.getAttribute('for');
      const byFor = forId ? document.getElementById(forId) : null;
      if (byFor && resolveField(byFor)) return byFor;
      if (el.control && resolveField(el.control)) return el.control;
    }
    const nested = el.querySelector('input:not([type="hidden"]), textarea, [contenteditable="true"]');
    if (nested) return nested;
    const container = el.closest('label, [role="group"], [role="spinbutton"], div');
    if (container && container !== el) {
      const inField = container.querySelector('input:not([type="hidden"]), textarea, [contenteditable="true"]');
      if (inField) return inField;
    }
    return null;
  }

  function isVisibleField(el) {
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  }
  // Last resort: the agent picked a label/decoration near the field. Type into
  // the closest visible text input (or the only one on the page).
  function nearestField(from) {
    const cands = [].slice
      .call(
        document.querySelectorAll(
          'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]), textarea, [contenteditable="true"]',
        ),
      )
      .filter(isVisibleField);
    if (cands.length === 0) return null;
    if (cands.length === 1) return cands[0];
    const r = from.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let best = null;
    let bestD = Infinity;
    for (const c of cands) {
      const cr = c.getBoundingClientRect();
      const dx = cr.left + cr.width / 2 - cx;
      const dy = cr.top + cr.height / 2 - cy;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = c; }
    }
    return bestD <= 600 * 600 ? best : null;
  }

  const target = resolveField(picked) || nearestField(picked);
  if (!target) {
    const role = picked.getAttribute('role');
    const type = picked.getAttribute('type');
    const detail =
      picked.tagName +
      (role ? '[role=' + role + ']' : '') +
      (type ? '[type=' + type + ']' : '') +
      ' ' +
      (picked.outerHTML || '').slice(0, 160);
    throw new Error('Element at index ' + idx + ' is not typeable: ' + detail);
  }

  target.focus();
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
    // Use the native value setter so React/Vue controlled inputs register the
    // change (assigning .value directly is swallowed by their re-render).
    const proto = target.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(target, text);
    else target.value = text;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    target.textContent = text;
    target.dispatchEvent(new Event('input', { bubbles: true }));
  }
})`;

export const SCROLL_FN = `(function (dir) {
  window.scrollBy(0, dir === 'down' ? 600 : -600);
})`;

/**
 * Shared in-page target resolver. Tolerates the brittle selectors people copy
 * from devtools ("Copy selector" → a full `a > b:nth-child(n) > …` path with
 * every Tailwind class) by: supporting a `text=` shorthand, trying the selector
 * verbatim first, then progressively dropping leading ancestors of a `>` chain
 * (most-specific suffix first), and polling so late-rendered elements are
 * awaited instead of failing instantly.
 */
const SELECTOR_RESOLVER = `
  function __cloakResolveTarget(selector) {
    const sel = (selector || '').trim();
    if (!sel) return null;
    if (sel.slice(0, 5).toLowerCase() === 'text=') {
      const needle = sel.slice(5).trim().toLowerCase().replace(/\\s+/g, ' ');
      if (!needle) return null;
      const norm = (n) => (n.innerText || n.textContent || '').trim().toLowerCase().replace(/\\s+/g, ' ');
      const queries = [
        "[role='tablist'] [role='tab']",
        "button, a, [role='button'], [role='link'], [role='tab'], input[type='submit'], input[type='button'], label, summary, [onclick]",
      ];
      for (const q of queries) {
        const nodes = Array.prototype.slice.call(document.querySelectorAll(q));
        const exact = nodes.find((n) => norm(n) === needle);
        if (exact) return exact;
        const partial = nodes.find((n) => norm(n).indexOf(needle) !== -1);
        if (partial) return partial;
      }
      return null;
    }
    try { const el = document.querySelector(sel); if (el) return el; } catch (_) {}
    if (sel.charAt(0) === '#') {
      const id = sel.slice(1);
      const triggerMatch = id.match(/-trigger-(.+)$/);
      if (triggerMatch) {
        const suffix = triggerMatch[1];
        try {
          const bySuffix = document.querySelector('[id$="-trigger-' + suffix + '"]');
          if (bySuffix) return bySuffix;
          const tabs = document.querySelectorAll('[role="tab"]');
          const needle = suffix.replace(/-/g, ' ').toLowerCase();
          for (const tab of tabs) {
            const label = (tab.innerText || tab.textContent || '').trim().toLowerCase();
            if (label === needle || label.indexOf(needle) !== -1) return tab;
          }
        } catch (_) {}
      }
    }
    if (sel.indexOf('>') !== -1) {
      const parts = sel.split('>').map((s) => s.trim()).filter(Boolean);
      for (let i = 1; i < parts.length; i++) {
        const sub = parts.slice(i).join(' > ');
        try { const el = document.querySelector(sub); if (el) return el; } catch (_) {}
      }
    }
    return null;
  }
  function __cloakWaitFor(selector, timeoutMs) {
    return new Promise((resolve) => {
      const deadline = Date.now() + (timeoutMs || 0);
      const tick = () => {
        const el = __cloakResolveTarget(selector);
        if (el) return resolve(el);
        if (Date.now() >= deadline) return resolve(null);
        setTimeout(tick, 50);
      };
      tick();
    });
  }
`;

const RESOLVE_TARGET_TAIL = `
  const el = await __cloakWaitFor(selector, 5000);
  if (!el) throw new Error('No element matches selector: ' + selector);
  if (el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'center' });
  return el;
`;

/** Resolve and return a DOM node for Playwright ElementHandle.click (Radix-safe). */
export const RESOLVE_TARGET_FN = `(async function (selector) {
${SELECTOR_RESOLVER}
${RESOLVE_TARGET_TAIL}
})`;

/** Legacy in-page click — prefer RESOLVE_TARGET_FN + ElementHandle.click in Node. */
export const CLICK_BY_SELECTOR_FN = `(async function (selector) {
${SELECTOR_RESOLVER}
  const el = await __cloakWaitFor(selector, 5000);
  if (!el) throw new Error('No element matches selector: ' + selector);
  if (el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'center' });
  el.click();
})`;

export const FILL_BY_SELECTOR_FN = `(async function (selector, text) {
${SELECTOR_RESOLVER}
  const el = await __cloakWaitFor(selector, 2500);
  if (!el) throw new Error('No element matches selector: ' + selector);
  if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && !el.isContentEditable) {
    throw new Error('Element is not an input/textarea/contenteditable: ' + el.tagName);
  }
  el.focus();
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    // Native setter so React/Vue controlled inputs register the change
    // (assigning .value directly is swallowed by their re-render).
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, text);
    else el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    el.textContent = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
})`;

export const SELECTOR_EXISTS_FN = `(function (selector) {
${SELECTOR_RESOLVER}
  return !!__cloakResolveTarget(selector);
})`;

export const RUN_SCRIPT_FN = `(function (code) {
  eval(code);
})`;
