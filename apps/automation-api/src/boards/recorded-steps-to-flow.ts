import type { FlowStep } from '../runs/run.types';
import type { RecordedStep } from './board.types';
import { BoardGraphError } from './board.errors';

/** Settle delay after a recorded navigation before the next step. */
const NAV_SETTLE_MS = 300;
/** Settle delay after a click/fill so the DOM reflects the change. */
const ACTION_SETTLE_MS = 150;

/**
 * Compile a captured interaction script into executable flow steps for replay.
 * navigate → goto+wait, click → click+wait, type → fill+wait, scroll → scroll.
 * Empty selectors are a hard error; empty `value` is allowed (clears the field).
 */
export function compileRecordedSteps(steps: RecordedStep[], nodeId = 'record'): FlowStep[] {
  const out: FlowStep[] = [];
  for (const s of steps) {
    if (s.type === 'navigate') {
      const url = s.url?.trim();
      if (!url || url.startsWith('about:')) continue;
      out.push({ type: 'goto', url });
      out.push({ type: 'wait', ms: NAV_SETTLE_MS });
    } else if (s.type === 'click') {
      const selector = s.selector?.trim();
      if (!selector) throw new BoardGraphError(`Recorded click in ${nodeId} has an empty selector`);
      out.push({ type: 'click', selector });
      out.push({ type: 'wait', ms: ACTION_SETTLE_MS });
    } else if (s.type === 'type') {
      const selector = s.selector?.trim();
      if (!selector) throw new BoardGraphError(`Recorded type in ${nodeId} has an empty selector`);
      out.push({ type: 'fill', selector, value: s.value ?? '' });
      out.push({ type: 'wait', ms: ACTION_SETTLE_MS });
    } else if (s.type === 'scroll') {
      out.push({ type: 'scroll', direction: s.direction });
    }
  }
  return out;
}
