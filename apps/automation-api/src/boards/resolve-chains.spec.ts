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

  it('includes wait nodes in the chain', () => {
    const g = graph(
      [
        { id: 'p', type: 'profile', position: pos, data: { profileId: 'prof-1' } },
        { id: 'g', type: 'goto', position: pos, data: { url: 'https://e' } },
        { id: 'w', type: 'wait', position: pos, data: { ms: 1500 } },
        { id: 's', type: 'screenshot', position: pos, data: {} },
      ],
      [
        { id: 'e1', source: 'p', target: 'g' },
        { id: 'e2', source: 'g', target: 'w' },
        { id: 'e3', source: 'w', target: 's' },
      ],
    );

    expect(resolveChains(g)).toEqual([
      {
        profileId: 'prof-1',
        steps: [
          { type: 'goto', url: 'https://e' },
          { type: 'wait', ms: 1500 },
          { type: 'screenshot' },
        ],
      },
    ]);
  });

  it('maps agent node with restrictToGotoDomains from prior goto', () => {
    const g = graph(
      [
        { id: 'p', type: 'profile', position: pos, data: { profileId: 'prof-1' } },
        { id: 'g', type: 'goto', position: pos, data: { url: 'https://www.facebook.com/' } },
        {
          id: 'a',
          type: 'agent',
          position: pos,
          data: {
            prompt: 'collect interactions',
            provider: 'openai',
            model: 'gpt-4o-mini',
            apiKey: 'sk-x',
            restrictToGotoDomains: true,
          },
        },
      ],
      [
        { id: 'e1', source: 'p', target: 'g' },
        { id: 'e2', source: 'g', target: 'a' },
      ],
    );
    const jobs = resolveChains(g);
    expect(jobs[0].steps[1]).toMatchObject({
      type: 'agent',
      prompt: 'collect interactions',
      allowDomains: ['facebook.com'],
      readOnly: true,
      maxSteps: 25,
    });
  });

  it('sets endsWithRecord for profile → goto → record (Run keeps browser open)', () => {
    const g = graph(
      [
        { id: 'p', type: 'profile', position: pos, data: { profileId: 'prof-1' } },
        { id: 'g', type: 'goto', position: pos, data: { url: 'https://google.com' } },
        { id: 'r', type: 'record', position: pos, data: { steps: [] } },
      ],
      [
        { id: 'e1', source: 'p', target: 'g' },
        { id: 'e2', source: 'g', target: 'r' },
      ],
    );
    expect(resolveChains(g)).toEqual([
      {
        profileId: 'prof-1',
        steps: [{ type: 'goto', url: 'https://google.com' }],
        endsWithRecord: true,
      },
    ]);
  });

  it('expands record node navigations into goto steps', () => {
    const g = graph(
      [
        { id: 'p', type: 'profile', position: pos, data: { profileId: 'prof-1' } },
        {
          id: 'r',
          type: 'record',
          position: pos,
          data: {
            steps: [
              { type: 'navigate', url: 'https://example.com/', at: 't1' },
              { type: 'click', tag: 'a', text: 'x', href: null, selector: 'a', at: 't2' },
            ],
          },
        },
      ],
      [{ id: 'e1', source: 'p', target: 'r' }],
    );
    const jobs = resolveChains(g);
    expect(jobs[0].steps).toEqual([
      { type: 'goto', url: 'https://example.com/' },
      { type: 'wait', ms: 800 },
    ]);
  });

  it('replays a record node into full goto/click/fill/scroll steps without keeping open', () => {
    const g = graph(
      [
        { id: 'p', type: 'profile', position: pos, data: { profileId: 'prof-1' } },
        {
          id: 'r',
          type: 'record',
          position: pos,
          data: {
            mode: 'replay',
            steps: [
              { type: 'navigate', url: 'https://example.com/', at: 't1' },
              { type: 'click', tag: 'a', text: 'x', href: null, selector: 'a.next', at: 't2' },
              { type: 'type', tag: 'input', text: 'qty', selector: '#qty', value: '10', at: 't3' },
              { type: 'scroll', direction: 'down', at: 't4' },
            ],
          },
        },
      ],
      [{ id: 'e1', source: 'p', target: 'r' }],
    );
    const jobs = resolveChains(g);
    expect(jobs[0].endsWithRecord).toBeUndefined();
    expect(jobs[0].steps).toEqual([
      { type: 'goto', url: 'https://example.com/' },
      { type: 'wait', ms: 300 },
      { type: 'click', selector: 'a.next' },
      { type: 'wait', ms: 150 },
      { type: 'fill', selector: '#qty', value: '10' },
      { type: 'wait', ms: 150 },
      { type: 'scroll', direction: 'down' },
    ]);
  });

  it('throws when a replay record node has an empty selector', () => {
    const g = graph(
      [
        { id: 'p', type: 'profile', position: pos, data: { profileId: 'prof-1' } },
        {
          id: 'r',
          type: 'record',
          position: pos,
          data: {
            mode: 'replay',
            steps: [{ type: 'click', tag: 'a', text: '', href: null, selector: '', at: 't1' }],
          },
        },
      ],
      [{ id: 'e1', source: 'p', target: 'r' }],
    );
    expect(() => resolveChains(g)).toThrow(/empty selector/i);
  });

  it('allows all domains by default so agent can open search result pages', () => {
    const g = graph(
      [
        { id: 'p', type: 'profile', position: pos, data: { profileId: 'prof-1' } },
        { id: 'g', type: 'goto', position: pos, data: { url: 'https://www.google.com/' } },
        {
          id: 'a',
          type: 'agent',
          position: pos,
          data: {
            prompt: 'find restaurants and open first result',
            provider: 'openai',
            model: 'gpt-4o-mini',
            apiKey: 'sk-x',
          },
        },
      ],
      [
        { id: 'e1', source: 'p', target: 'g' },
        { id: 'e2', source: 'g', target: 'a' },
      ],
    );
    const jobs = resolveChains(g);
    expect(jobs[0].steps[1]).toMatchObject({
      type: 'agent',
      allowDomains: [],
    });
  });

  it('throws when agent node missing apiKey', () => {
    const g = graph(
      [
        { id: 'p', type: 'profile', position: pos, data: { profileId: 'prof-1' } },
        {
          id: 'a',
          type: 'agent',
          position: pos,
          data: { prompt: 'x', provider: 'openai', model: 'm', apiKey: '' },
        },
      ],
      [{ id: 'e1', source: 'p', target: 'a' }],
    );
    expect(() => resolveChains(g)).toThrow(/apiKey/i);
  });

  it('allows ollama agent without apiKey and passes baseUrl', () => {
    const g = graph(
      [
        { id: 'p', type: 'profile', position: pos, data: { profileId: 'prof-1' } },
        {
          id: 'a',
          type: 'agent',
          position: pos,
          data: {
            prompt: 'search',
            provider: 'ollama',
            model: 'llama3.2',
            apiKey: '',
            baseUrl: 'http://127.0.0.1:11434',
          },
        },
      ],
      [{ id: 'e1', source: 'p', target: 'a' }],
    );
    const jobs = resolveChains(g);
    expect(jobs[0].steps[0]).toMatchObject({
      type: 'agent',
      provider: 'ollama',
      model: 'llama3.2',
      baseUrl: 'http://127.0.0.1:11434',
      apiKey: '',
    });
  });

  it('throws when a wait node has invalid ms', () => {
    const g = graph(
      [
        { id: 'p', type: 'profile', position: pos, data: { profileId: 'prof-1' } },
        { id: 'w', type: 'wait', position: pos, data: { ms: 0 } },
      ],
      [{ id: 'e1', source: 'p', target: 'w' }],
    );

    expect(() => resolveChains(g)).toThrow(/ms/i);
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

  it('compiles a metamask node into a single wallet step', () => {
    const graph = {
      nodes: [
        { id: 'p', type: 'profile', position: { x: 0, y: 0 }, data: { profileId: 'prof-1' } },
        {
          id: 'm',
          type: 'metamask',
          position: { x: 0, y: 0 },
          data: {
            privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
            chains: [{ chainId: 1, rpcUrl: 'https://eth.example', name: 'Ethereum' }],
            activeChainId: 1,
          },
        },
      ],
      edges: [{ id: 'e1', source: 'p', target: 'm' }],
    } as never;

    const jobs = resolveChains(graph);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].steps).toEqual([
      {
        type: 'wallet',
        privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        chains: [{ chainId: 1, rpcUrl: 'https://eth.example', name: 'Ethereum' }],
        activeChainId: 1,
      },
    ]);
  });

  it('throws when the metamask private key is malformed', () => {
    const graph = {
      nodes: [
        { id: 'p', type: 'profile', position: { x: 0, y: 0 }, data: { profileId: 'prof-1' } },
        {
          id: 'm',
          type: 'metamask',
          position: { x: 0, y: 0 },
          data: { privateKey: 'nope', chains: [{ chainId: 1, rpcUrl: 'https://x', name: 'X' }], activeChainId: 1 },
        },
      ],
      edges: [{ id: 'e1', source: 'p', target: 'm' }],
    } as never;
    expect(() => resolveChains(graph)).toThrow(/private key/i);
  });

  it('compiles a fill node into a single fill step', () => {
    const g = graph(
      [
        { id: 'p', type: 'profile', position: pos, data: { profileId: 'prof-1' } },
        { id: 'g', type: 'goto', position: pos, data: { url: 'https://form' } },
        { id: 'f', type: 'fill', position: pos, data: { selector: '#email', value: 'hi@example.com' } },
      ],
      [
        { id: 'e1', source: 'p', target: 'g' },
        { id: 'e2', source: 'g', target: 'f' },
      ],
    );
    expect(resolveChains(g)).toEqual([
      {
        profileId: 'prof-1',
        steps: [
          { type: 'goto', url: 'https://form' },
          { type: 'fill', selector: '#email', value: 'hi@example.com' },
        ],
      },
    ]);
  });

  it('throws when a fill node has an empty selector', () => {
    const g = graph(
      [
        { id: 'p', type: 'profile', position: pos, data: { profileId: 'prof-1' } },
        { id: 'f', type: 'fill', position: pos, data: { selector: '  ', value: 'x' } },
      ],
      [{ id: 'e1', source: 'p', target: 'f' }],
    );
    expect(() => resolveChains(g)).toThrow(/selector/i);
  });

  it('compiles a click node into a single click step', () => {
    const g = graph(
      [
        { id: 'p', type: 'profile', position: pos, data: { profileId: 'prof-1' } },
        { id: 'c', type: 'click', position: pos, data: { selector: 'button.submit' } },
      ],
      [{ id: 'e1', source: 'p', target: 'c' }],
    );
    expect(resolveChains(g)).toEqual([
      { profileId: 'prof-1', steps: [{ type: 'click', selector: 'button.submit' }] },
    ]);
  });

  it('throws when a click node has an empty selector', () => {
    const g = graph(
      [
        { id: 'p', type: 'profile', position: pos, data: { profileId: 'prof-1' } },
        { id: 'c', type: 'click', position: pos, data: { selector: '   ' } },
      ],
      [{ id: 'e1', source: 'p', target: 'c' }],
    );
    expect(() => resolveChains(g)).toThrow(/selector/i);
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
