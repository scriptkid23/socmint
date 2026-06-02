import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunService } from '../runs/run.service';
import { BoardStore } from './board.store';
import { BoardService } from './board.service';
import { BoardNotFoundError } from './board.errors';
import type { BoardGraph } from './board.types';

const pos = { x: 0, y: 0 };

describe('BoardService', () => {
  let dataRoot: string;
  let store: BoardStore;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'bsvc-'));
    store = new BoardStore(dataRoot);
  });
  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  function service(runs?: Partial<RunService>) {
    return new BoardService(store, runs as unknown as RunService);
  }

  it('creates an empty board with a name', async () => {
    const svc = service();
    const board = await svc.create({ name: 'My board' });
    expect(board.name).toBe('My board');
    expect(board.graph).toEqual({ nodes: [], edges: [] });
    expect(await store.read(board.id)).not.toBeNull();
  });

  it('updates name and graph', async () => {
    const svc = service();
    const board = await svc.create({ name: 'A' });
    const graph: BoardGraph = {
      nodes: [{ id: 'p', type: 'profile', position: pos, data: { profileId: 'x' } }],
      edges: [],
    };
    const updated = await svc.update(board.id, { name: 'B', graph });
    expect(updated.name).toBe('B');
    expect(updated.graph).toEqual(graph);
  });

  it('throws BoardNotFoundError for a missing board', async () => {
    const svc = service();
    await expect(svc.get('nope')).rejects.toBeInstanceOf(BoardNotFoundError);
  });

  it('run resolves chains and calls executeFlow once per profile', async () => {
    const executeFlow = jest
      .fn()
      .mockImplementation(async (profileId: string) => ({ id: `run-${profileId}`, profileId, status: 'completed', startedAt: '', finishedAt: '', error: null, steps: [] }));
    const svc = service({ executeFlow });
    const board = await svc.create({ name: 'A' });
    await svc.update(board.id, {
      graph: {
        nodes: [
          { id: 'p', type: 'profile', position: pos, data: { profileId: 'prof-1' } },
          { id: 'g', type: 'goto', position: pos, data: { url: 'https://e' } },
        ],
        edges: [{ id: 'e1', source: 'p', target: 'g' }],
      },
    });

    const result = await svc.run(board.id);

    expect(executeFlow).toHaveBeenCalledTimes(1);
    expect(executeFlow).toHaveBeenCalledWith('prof-1', [{ type: 'goto', url: 'https://e', waitUntil: undefined, timeoutMs: undefined }]);
    expect(result.boardId).toBe(board.id);
    expect(result.runs).toHaveLength(1);
  });
});
