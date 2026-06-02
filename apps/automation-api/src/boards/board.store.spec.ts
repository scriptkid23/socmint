import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BoardStore } from './board.store';
import type { BoardRecord } from './board.types';

function board(id: string, name: string): BoardRecord {
  return {
    id,
    name,
    graph: { nodes: [{ id: 'p', type: 'profile', position: { x: 1, y: 2 }, data: { profileId: 'x' } }], edges: [] },
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
  };
}

describe('BoardStore', () => {
  let dataRoot: string;
  let store: BoardStore;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'bs-'));
    store = new BoardStore(dataRoot);
  });
  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('round-trips a board including its graph', async () => {
    await store.write(board('b1', 'First'));
    const read = await store.read('b1');
    expect(read).toEqual(board('b1', 'First'));
  });

  it('returns null for a missing board', async () => {
    expect(await store.read('nope')).toBeNull();
  });

  it('lists all boards', async () => {
    await store.write(board('b1', 'First'));
    await store.write(board('b2', 'Second'));
    const ids = (await store.list()).map((b) => b.id).sort();
    expect(ids).toEqual(['b1', 'b2']);
  });

  it('removes a board', async () => {
    await store.write(board('b1', 'First'));
    await store.remove('b1');
    expect(await store.read('b1')).toBeNull();
  });
});
