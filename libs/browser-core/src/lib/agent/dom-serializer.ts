import type { AgentDecision, DomElement } from './types';

export function formatDomForPrompt(elements: DomElement[]): string {
  if (elements.length === 0) return '(no interactive elements found)';
  return elements
    .map((el) => {
      const href = el.href ? ` href="${el.href}"` : '';
      const role = el.role ? ` role="${el.role}"` : '';
      const value =
        el.value !== undefined && el.value !== null
          ? ` value="${String(el.value).slice(0, 120)}"`
          : '';
      return `[${el.index}] <${el.tag}${role}${href}${value}> "${el.text.slice(0, 120)}"`;
    })
    .join('\n');
}

/** Script executed inside the browser via page.evaluate. */
export const EXTRACT_DOM_SCRIPT = `(() => {
  const MAX = 80;
  const seen = new Set();
  const out = [];
  const nodes = document.querySelectorAll(
    'a, button, input, textarea, select, [role="button"], [role="link"]'
  );
  for (const el of nodes) {
    if (out.length >= MAX) break;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    const text = (el.innerText || el.getAttribute('aria-label') || '').trim();
    if (!text && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') continue;
    const key = el.tagName + text;
    if (seen.has(key)) continue;
    seen.add(key);
    const isField = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
    out.push({
      index: out.length,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
      text: text.slice(0, 200),
      href: el.tagName === 'A' ? el.href : null,
      value: isField ? (el.value || '') : null,
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
