/** Shared in-page DOM collection (used by readDom and click/type/scroll scripts). */

export const DOM_INTERACTIVE_SELECTOR =
  'a, button, input, textarea, select, [contenteditable="true"], [role="button"], [role="link"], [role="searchbox"], [role="combobox"], [role="textbox"]';

/** Function body only — embedded in page.evaluate strings. */
export const COLLECT_VISIBLE_ELEMENTS = `
  function collectVisibleElements() {
    const nodes = document.querySelectorAll('${DOM_INTERACTIVE_SELECTOR}');
    const visible = [];
    const seen = new Set();
    const searchRoles = ['searchbox', 'combobox', 'textbox'];
    for (let i = 0; i < nodes.length; i++) {
      if (visible.length >= 80) break;
      const el = nodes[i];
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      const text = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim();
      const isField = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
      const isEditable = el.isContentEditable;
      const role = el.getAttribute('role');
      const isSearchRole = role && searchRoles.indexOf(role) >= 0;
      if (!text && !isField && !isEditable && !isSearchRole) continue;
      // Never dedupe form fields: two empty inputs share the same tag+text key,
      // which would drop the real target (e.g. a quantity box) from the list.
      if (!isField && !isEditable && !isSearchRole) {
        const key = el.tagName + (role || '') + text;
        if (seen.has(key)) continue;
        seen.add(key);
      }
      visible.push(el);
    }
    return visible;
  }
`;
