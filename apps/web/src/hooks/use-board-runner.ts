import { useCallback, useState } from 'react';
import { api, type Board, type BoardRunRecord, type ResultKind } from '../api/client';
import { aggregateBoardResult } from '../components/automation/board-result-status';

export interface BoardRunFailure {
  boardId: string;
  boardName: string;
  message: string;
}

export function useBoardRunner({
  boards,
  selectedId,
  onBoardResult,
  persistOpenBoard,
  applyOpenBoardRun,
}: {
  boards: Board[];
  selectedId: string | null;
  onBoardResult: (boardId: string, status: ResultKind | undefined) => void;
  persistOpenBoard?: () => Promise<void>;
  applyOpenBoardRun?: (run: BoardRunRecord) => void;
}) {
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
  const [runningIds, setRunningIds] = useState<Set<string>>(() => new Set());
  const [failures, setFailures] = useState<BoardRunFailure[]>([]);

  const batchRunning = runningIds.size > 0;

  const toggleChecked = useCallback((id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const runBoards = useCallback(
    async (ids: string[]) => {
      const unique = [...new Set(ids)];
      if (unique.length === 0) return;

      setFailures([]);
      if (selectedId && unique.includes(selectedId)) {
        await persistOpenBoard?.();
      }

      const nameById = new Map(boards.map((b) => [b.id, b.name]));
      const newFailures: BoardRunFailure[] = [];

      for (const boardId of unique) {
        setRunningIds(new Set([boardId]));
        try {
          const boardRun = await api.runBoard(boardId);
          const allRecords = boardRun.runs.flatMap((r) => r.steps ?? []);
          onBoardResult(boardId, aggregateBoardResult(allRecords));
          if (boardId === selectedId) {
            applyOpenBoardRun?.(boardRun);
          }
        } catch (err) {
          onBoardResult(boardId, undefined);
          const message = err instanceof Error ? err.message : 'Run failed';
          newFailures.push({
            boardId,
            boardName: nameById.get(boardId) ?? boardId,
            message,
          });
        }
      }

      setRunningIds(new Set());
      if (newFailures.length > 0) setFailures(newFailures);
    },
    [boards, selectedId, onBoardResult, persistOpenBoard, applyOpenBoardRun],
  );

  const runAll = useCallback(() => runBoards(boards.map((b) => b.id)), [boards, runBoards]);

  const runSelected = useCallback(() => runBoards([...checkedIds]), [checkedIds, runBoards]);

  const clearFailures = useCallback(() => setFailures([]), []);

  return {
    checkedIds,
    toggleChecked,
    runningIds,
    batchRunning,
    failures,
    clearFailures,
    runAll,
    runSelected,
  };
}
