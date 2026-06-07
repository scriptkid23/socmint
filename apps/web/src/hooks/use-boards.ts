import { useCallback, useEffect, useState } from 'react';
import { api, type Board } from '../api/client';

export function useBoards() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await api.listBoards();
      setBoards(next);
      setError(null);
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load boards');
      return null;
    }
  }, []);

  const create = useCallback(
    async (name: string) => {
      const created = await api.createBoard({ name });
      await refresh();
      return created;
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await api.deleteBoard(id);
      await refresh();
    },
    [refresh],
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      const updated = await api.updateBoard(id, { name });
      await refresh();
      return updated;
    },
    [refresh],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { boards, error, refresh, create, remove, rename };
}
