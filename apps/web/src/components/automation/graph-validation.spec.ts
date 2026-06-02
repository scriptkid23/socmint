import { describe, it, expect } from 'vitest';
import { validateGraph } from './graph-validation';
import type { BoardGraph } from '../../api/client';

const pos = { x: 0, y: 0 };

describe('validateGraph', () => {
  it('returns no errors for a valid linear chain', () => {
    const g: BoardGraph = {
      nodes: [
        { id: 'p', type: 'profile', position: pos, data: { profileId: 'a' } },
        { id: 'g', type: 'goto', position: pos, data: { url: 'https://e' } },
      ],
      edges: [{ id: 'e1', source: 'p', target: 'g' }],
    };
    expect(validateGraph(g)).toEqual([]);
  });

  it('flags a profile node with no profile', () => {
    const g: BoardGraph = {
      nodes: [{ id: 'p', type: 'profile', position: pos, data: { profileId: null } }],
      edges: [],
    };
    const errs = validateGraph(g);
    expect(errs.some((e) => e.nodeId === 'p')).toBe(true);
  });

  it('flags a node with multiple outgoing edges', () => {
    const g: BoardGraph = {
      nodes: [
        { id: 'p', type: 'profile', position: pos, data: { profileId: 'a' } },
        { id: 'g1', type: 'goto', position: pos, data: { url: 'https://1' } },
        { id: 'g2', type: 'goto', position: pos, data: { url: 'https://2' } },
      ],
      edges: [
        { id: 'e1', source: 'p', target: 'g1' },
        { id: 'e2', source: 'p', target: 'g2' },
      ],
    };
    expect(validateGraph(g).some((e) => e.nodeId === 'p')).toBe(true);
  });

  it('flags an empty goto url and a duplicate profile', () => {
    const g: BoardGraph = {
      nodes: [
        { id: 'p1', type: 'profile', position: pos, data: { profileId: 'dup' } },
        { id: 'p2', type: 'profile', position: pos, data: { profileId: 'dup' } },
        { id: 'g', type: 'goto', position: pos, data: { url: '' } },
      ],
      edges: [
        { id: 'e1', source: 'p1', target: 'g' },
        { id: 'e2', source: 'p2', target: 'g' },
      ],
    };
    const errs = validateGraph(g);
    expect(errs.length).toBeGreaterThan(0);
  });
});
