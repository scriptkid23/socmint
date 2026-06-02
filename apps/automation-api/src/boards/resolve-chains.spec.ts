import { resolveChains } from './resolve-chains';
import { BoardGraphError } from './board.errors';
import type { BoardGraph } from './board.types';

const pos = { x: 0, y: 0 };

function graph(nodes: BoardGraph['nodes'], edges: BoardGraph['edges']): BoardGraph {
  return { nodes, edges };
}

describe('resolveChains', () => {
  it('builds a linear chain from a profile node', () => {
    const g = graph(
      [
        { id: 'p', type: 'profile', position: pos, data: { profileId: 'prof-1' } },
        { id: 'g', type: 'goto', position: pos, data: { url: 'https://e' } },
        { id: 's', type: 'screenshot', position: pos, data: {} },
      ],
      [
        { id: 'e1', source: 'p', target: 'g' },
        { id: 'e2', source: 'g', target: 's' },
      ],
    );

    expect(resolveChains(g)).toEqual([
      { profileId: 'prof-1', steps: [{ type: 'goto', url: 'https://e' }, { type: 'screenshot' }] },
    ]);
  });

  it('returns one job per profile node', () => {
    const g = graph(
      [
        { id: 'p1', type: 'profile', position: pos, data: { profileId: 'a' } },
        { id: 'p2', type: 'profile', position: pos, data: { profileId: 'b' } },
        { id: 'g1', type: 'goto', position: pos, data: { url: 'https://a' } },
        { id: 'g2', type: 'goto', position: pos, data: { url: 'https://b' } },
      ],
      [
        { id: 'e1', source: 'p1', target: 'g1' },
        { id: 'e2', source: 'p2', target: 'g2' },
      ],
    );

    const jobs = resolveChains(g);
    expect(jobs).toHaveLength(2);
    expect(jobs.map((j) => j.profileId).sort()).toEqual(['a', 'b']);
  });

  it('skips a profile node wired to nothing', () => {
    const g = graph(
      [{ id: 'p', type: 'profile', position: pos, data: { profileId: 'a' } }],
      [],
    );
    expect(resolveChains(g)).toEqual([]);
  });

  it('throws when a node has more than one outgoing edge', () => {
    const g = graph(
      [
        { id: 'p', type: 'profile', position: pos, data: { profileId: 'a' } },
        { id: 'g1', type: 'goto', position: pos, data: { url: 'https://1' } },
        { id: 'g2', type: 'goto', position: pos, data: { url: 'https://2' } },
      ],
      [
        { id: 'e1', source: 'p', target: 'g1' },
        { id: 'e2', source: 'p', target: 'g2' },
      ],
    );
    expect(() => resolveChains(g)).toThrow(BoardGraphError);
  });

  it('throws when a profile node has no profile selected', () => {
    const g = graph(
      [
        { id: 'p', type: 'profile', position: pos, data: { profileId: null } },
        { id: 'g', type: 'goto', position: pos, data: { url: 'https://e' } },
      ],
      [{ id: 'e1', source: 'p', target: 'g' }],
    );
    expect(() => resolveChains(g)).toThrow(/no profile selected/i);
  });

  it('throws when a goto node has an empty url', () => {
    const g = graph(
      [
        { id: 'p', type: 'profile', position: pos, data: { profileId: 'a' } },
        { id: 'g', type: 'goto', position: pos, data: { url: '' } },
      ],
      [{ id: 'e1', source: 'p', target: 'g' }],
    );
    expect(() => resolveChains(g)).toThrow(/url/i);
  });

  it('throws when the same profile is used by two nodes', () => {
    const g = graph(
      [
        { id: 'p1', type: 'profile', position: pos, data: { profileId: 'dup' } },
        { id: 'p2', type: 'profile', position: pos, data: { profileId: 'dup' } },
        { id: 'g1', type: 'goto', position: pos, data: { url: 'https://1' } },
        { id: 'g2', type: 'goto', position: pos, data: { url: 'https://2' } },
      ],
      [
        { id: 'e1', source: 'p1', target: 'g1' },
        { id: 'e2', source: 'p2', target: 'g2' },
      ],
    );
    expect(() => resolveChains(g)).toThrow(/more than one node/i);
  });

  it('throws on a cycle', () => {
    const g = graph(
      [
        { id: 'p', type: 'profile', position: pos, data: { profileId: 'a' } },
        { id: 'g1', type: 'goto', position: pos, data: { url: 'https://1' } },
        { id: 'g2', type: 'goto', position: pos, data: { url: 'https://2' } },
      ],
      [
        { id: 'e1', source: 'p', target: 'g1' },
        { id: 'e2', source: 'g1', target: 'g2' },
        { id: 'e3', source: 'g2', target: 'g1' },
      ],
    );
    expect(() => resolveChains(g)).toThrow(/cycle/i);
  });
});
