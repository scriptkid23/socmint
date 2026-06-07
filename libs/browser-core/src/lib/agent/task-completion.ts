import type { AgentResult, DomElement } from './types';

/** Action types that can actually change the page (vs. read-only extract/finish). */
const STATE_CHANGING = new Set(['click', 'type', 'navigate', 'pressEnter', 'scroll']);

/**
 * Compact fingerprint of the current page used to detect "no further progress".
 * Combines URL, element count, and the leading element labels so that any
 * meaningful change (navigation, new content, revealed elements) yields a new
 * signature, while a no-op action leaves it unchanged.
 */
export function pageSignature(url: string, dom: DomElement[]): string {
  const head = dom
    .slice(0, 12)
    .map((e) => `${e.tag}:${(e.text ?? '').trim().slice(0, 24)}:${(e.value ?? '').trim().slice(0, 16)}`)
    .join('|');
  return `${url}::${dom.length}::${head}`;
}

/** How many page-changing actions the agent has already executed successfully. */
export function countEffectiveActions(transcript: AgentResult['transcript']): number {
  return transcript.filter((t) => !t.blocked && STATE_CHANGING.has(t.action.type)).length;
}

export { STATE_CHANGING };
