import type { RecordedStep } from '../api/client';

/** Keep in sync with libs/browser-core/src/lib/replay-selector.ts (browser-safe copy). */
const UNSTABLE_DOM_ID_SELECTOR =
  /^#(?:radix-|:r[0-9a-z]+:|[\w-]+-_r_[a-z0-9]+-)/i;

const SUFFIX_TRIGGER_SELECTOR = /\[id\$="-trigger-[^"]+"\]/i;

function radixTriggerSuffix(id: string): string | null {
  const match = id.trim().match(/-trigger-(.+)$/i);
  return match ? match[1] : null;
}

function stableRadixTriggerSelector(tag: string, suffix: string, role?: string | null): string {
  const safe = suffix.replace(/"/g, '\\"');
  if (role === 'tab') return `[role="tab"][id$="-trigger-${safe}"]`;
  const t = tag.toLowerCase() || 'button';
  return `${t}[id$="-trigger-${safe}"]`;
}

function labelToTriggerSuffix(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, '-');
}

function replayClickSelector(step: Extract<RecordedStep, { type: 'click' }>): string {
  const sel = step.selector?.trim() ?? '';
  if (SUFFIX_TRIGGER_SELECTOR.test(sel)) return sel;

  const id = sel.startsWith('#') ? sel.slice(1) : sel;
  const fromId = radixTriggerSuffix(id);
  if (fromId) {
    return stableRadixTriggerSelector(step.tag, fromId);
  }

  const text = step.text?.trim();
  if (text && (UNSTABLE_DOM_ID_SELECTOR.test(sel) || sel === '' || sel.startsWith('text='))) {
    return stableRadixTriggerSelector(step.tag, labelToTriggerSuffix(text));
  }

  return sel;
}

/** Normalize stored steps so replay uses stable selectors. */
export function normalizeRecordedSteps(steps: RecordedStep[]): RecordedStep[] {
  return steps.map((s) => {
    if (s.type !== 'click') return s;
    const selector = replayClickSelector(s);
    return selector === s.selector ? s : { ...s, selector };
  });
}
