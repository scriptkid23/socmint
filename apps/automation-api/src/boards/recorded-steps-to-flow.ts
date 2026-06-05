import type { FlowStep } from '../runs/run.types';
import type { RecordedStep } from './board.types';
import { BoardGraphError } from './board.errors';

/** Default delay inserted after each replayed step (ms) when the node sets none. */
export const DEFAULT_REPLAY_DELAY_MS = 500;

/**
 * Compile a captured interaction script into executable flow steps for replay.
 * navigate → goto+wait, click → click+wait, type → fill+wait, scroll → scroll+wait.
 * A configurable `delayMs` (default 0.5s) is inserted after every step so replays
 * pace themselves; pass 0 to disable the pacing waits entirely.
 * Empty selectors are a hard error; empty `value` is allowed (clears the field).
 */
export function compileRecordedSteps(
  steps: RecordedStep[],
  nodeId = 'record',
  delayMs: number = DEFAULT_REPLAY_DELAY_MS,
): FlowStep[] {
  const out: FlowStep[] = [];
  const delay = Number.isFinite(delayMs) && delayMs > 0 ? Math.round(delayMs) : 0;
  const pushDelay = () => {
    if (delay > 0) out.push({ type: 'wait', ms: delay });
  };
  for (const s of steps) {
    if (s.type === 'navigate') {
      const url = s.url?.trim();
      if (!url || url.startsWith('about:')) continue;
      out.push({ type: 'goto', url });
      pushDelay();
    } else if (s.type === 'click') {
      const selector = s.selector?.trim();
      if (!selector) throw new BoardGraphError(`Recorded click in ${nodeId} has an empty selector`);
      out.push({ type: 'click', selector });
      pushDelay();
    } else if (s.type === 'type') {
      const selector = s.selector?.trim();
      if (!selector) throw new BoardGraphError(`Recorded type in ${nodeId} has an empty selector`);
      out.push({ type: 'fill', selector, value: s.value ?? '' });
      pushDelay();
    } else if (s.type === 'scroll') {
      out.push({ type: 'scroll', direction: s.direction });
      pushDelay();
    }
  }
  return out;
}
