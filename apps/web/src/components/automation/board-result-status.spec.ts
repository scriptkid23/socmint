import { describe, it, expect } from 'vitest';
import {
  aggregateBoardResult,
  resultNodeStatesFromRecords,
} from './board-result-status';

describe('board-result-status', () => {
  it('maps result records to node states', () => {
    expect(
      resultNodeStatesFromRecords([
        { type: 'result', nodeId: 'a', kind: 'pass' },
        { type: 'goto' },
      ]),
    ).toEqual({ a: 'pass' });
  });

  it('aggregates fail over pass', () => {
    expect(
      aggregateBoardResult([
        { type: 'result', kind: 'pass' },
        { type: 'result', kind: 'fail' },
      ]),
    ).toBe('fail');
  });

  it('returns pass when only pass markers exist', () => {
    expect(aggregateBoardResult([{ type: 'result', kind: 'pass' }])).toBe('pass');
  });

  it('returns undefined when no result markers', () => {
    expect(aggregateBoardResult([{ type: 'goto' }])).toBeUndefined();
  });
});
