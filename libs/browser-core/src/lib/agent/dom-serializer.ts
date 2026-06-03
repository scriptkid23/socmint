import { COLLECT_VISIBLE_ELEMENTS } from './dom-collect';
import type { AgentDecision, DomElement } from './types';

export function formatDomForPrompt(elements: DomElement[]): string {
  if (elements.length === 0) return '(no interactive elements found)';
  return elements
    .map((el) => {
      const href = el.href ? ` href="${el.href}"` : '';
      const role = el.role ? ` role="${el.role}"` : '';
      const value =
        el.value !== undefined && el.value !== null && String(el.value).length > 0
          ? ` value="${String(el.value).slice(0, 120)}"`
          : '';
      return `[${el.index}] <${el.tag}${role}${href}${value}> "${el.text.slice(0, 120)}"`;
    })
    .join('\n');
}

/** Script executed inside the browser via page.evaluate. */
export const EXTRACT_DOM_SCRIPT = `(() => {
${COLLECT_VISIBLE_ELEMENTS}
  const searchRoles = ['searchbox', 'combobox', 'textbox'];
  const nodes = collectVisibleElements();
  const out = [];
  for (const el of nodes) {
    const text = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim();
    const isField = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
    const isEditable = el.isContentEditable;
    const role = el.getAttribute('role');
    const isSearchRole = role && searchRoles.indexOf(role) >= 0;
    let value = null;
    if (isField) value = el.value || '';
    else if (isEditable || isSearchRole) value = (el.innerText || el.textContent || '').trim();
    out.push({
      index: out.length,
      tag: el.tagName.toLowerCase(),
      role: role,
      text: text.slice(0, 200),
      href: el.tagName === 'A' ? el.href : null,
      value: value,
    });
  }
  return out;
})()`;

export function parseAgentDecision(raw: string): AgentDecision {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fence ? fence[1].trim() : trimmed;
  const parsed = JSON.parse(jsonText) as AgentDecision;
  if (!parsed?.action?.type) throw new Error('LLM response missing action.type');
  return parsed;
}
