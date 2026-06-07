import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api, type Board, type BoardRunRecord } from '../api/client';
import { useBoardRunner } from './use-board-runner';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      runBoard: vi.fn(),
    },
  };
});

const boards: Board[] = [
  {
    id: 'b1',
    name: 'Board One',
    graph: { nodes: [], edges: [] },
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'b2',
    name: 'Board Two',
    graph: { nodes: [], edges: [] },
    createdAt: '',
    updatedAt: '',
  },
];

const passRun = (boardId: string): BoardRunRecord => ({
  id: 'run-1',
  boardId,
  startedAt: '',
  finishedAt: '',
  runs: [
    {
      id: 'flow-1',
      profileId: 'p1',
      status: 'completed',
      startedAt: '',
      finishedAt: '',
      error: null,
      steps: [{ type: 'result', status: 'completed', error: null, nodeId: 'r1', kind: 'pass' }],
    },
  ],
});

describe('useBoardRunner', () => {
  beforeEach(() => {
    vi.mocked(api.runBoard).mockReset();
  });

  it('runs all boards in parallel and reports pass status', async () => {
    vi.mocked(api.runBoard).mockImplementation(async (id) => passRun(id));
    const onBoardResult = vi.fn();

    const { result } = renderHook(() =>
      useBoardRunner({ boards, selectedId: null, onBoardResult }),
    );

    await act(async () => {
      await result.current.runAll();
    });

    expect(api.runBoard).toHaveBeenCalledTimes(2);
    expect(onBoardResult).toHaveBeenCalledWith('b1', 'pass');
    expect(onBoardResult).toHaveBeenCalledWith('b2', 'pass');
    expect(result.current.batchRunning).toBe(false);
  });

  it('runs only checked boards', async () => {
    vi.mocked(api.runBoard).mockImplementation(async (id) => passRun(id));
    const onBoardResult = vi.fn();

    const { result } = renderHook(() =>
      useBoardRunner({ boards, selectedId: null, onBoardResult }),
    );

    act(() => result.current.toggleChecked('b2'));

    await act(async () => {
      await result.current.runSelected();
    });

    expect(api.runBoard).toHaveBeenCalledTimes(1);
    expect(api.runBoard).toHaveBeenCalledWith('b2');
    expect(onBoardResult).toHaveBeenCalledWith('b2', 'pass');
    expect(onBoardResult).not.toHaveBeenCalledWith('b1', expect.anything());
  });

  it('records failures without blocking other boards', async () => {
    vi.mocked(api.runBoard).mockImplementation(async (id) => {
      if (id === 'b1') throw new Error('Profile already running');
      return passRun(id);
    });
    const onBoardResult = vi.fn();

    const { result } = renderHook(() =>
      useBoardRunner({ boards, selectedId: null, onBoardResult }),
    );

    await act(async () => {
      await result.current.runAll();
    });

    expect(onBoardResult).toHaveBeenCalledWith('b1', undefined);
    expect(onBoardResult).toHaveBeenCalledWith('b2', 'pass');
    expect(result.current.failures).toEqual([
      { boardId: 'b1', boardName: 'Board One', message: 'Profile already running' },
    ]);
  });

  it('persists and applies result for the open board', async () => {
    vi.mocked(api.runBoard).mockImplementation(async (id) => passRun(id));
    const persistOpenBoard = vi.fn().mockResolvedValue(undefined);
    const applyOpenBoardRun = vi.fn();
    const onBoardResult = vi.fn();

    const { result } = renderHook(() =>
      useBoardRunner({
        boards,
        selectedId: 'b1',
        onBoardResult,
        persistOpenBoard,
        applyOpenBoardRun,
      }),
    );

    await act(async () => {
      await result.current.runAll();
    });

    expect(persistOpenBoard).toHaveBeenCalledOnce();
    expect(applyOpenBoardRun).toHaveBeenCalledOnce();
    expect(applyOpenBoardRun.mock.calls[0][0].boardId).toBe('b1');
  });

  it('marks boards as running during the batch', async () => {
    let resolveRun!: (value: BoardRunRecord) => void;
    vi.mocked(api.runBoard).mockImplementation(
      () =>
        new Promise<BoardRunRecord>((resolve) => {
          resolveRun = resolve;
        }),
    );

    const { result } = renderHook(() =>
      useBoardRunner({ boards: [boards[0]], selectedId: null, onBoardResult: vi.fn() }),
    );

    let runPromise: Promise<void>;
    act(() => {
      runPromise = result.current.runAll();
    });

    await waitFor(() => {
      expect(result.current.runningIds.has('b1')).toBe(true);
    });

    await act(async () => {
      resolveRun(passRun('b1'));
      await runPromise!;
    });

    expect(result.current.runningIds.size).toBe(0);
  });
});
