import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useBoards } from './use-boards';
import { api } from '../api/client';

const sample = [
  { id: 'b1', name: 'A', graph: { nodes: [], edges: [] }, createdAt: '', updatedAt: '' },
];

describe('useBoards', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads boards on mount', async () => {
    vi.spyOn(api, 'listBoards').mockResolvedValue(sample);
    const { result } = renderHook(() => useBoards());
    await waitFor(() => expect(result.current.boards).toHaveLength(1));
    expect(result.current.boards[0].id).toBe('b1');
  });

  it('creates a board and refreshes', async () => {
    vi.spyOn(api, 'listBoards').mockResolvedValue(sample);
    const createSpy = vi.spyOn(api, 'createBoard').mockResolvedValue({
      id: 'b2',
      name: 'New',
      graph: { nodes: [], edges: [] },
      createdAt: '',
      updatedAt: '',
    });
    const { result } = renderHook(() => useBoards());
    await waitFor(() => expect(result.current.boards).toHaveLength(1));
    await act(async () => {
      await result.current.create('New');
    });
    expect(createSpy).toHaveBeenCalledWith({ name: 'New' });
  });
});
