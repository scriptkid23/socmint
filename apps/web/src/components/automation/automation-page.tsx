import { useEffect, useState } from 'react';
import { api, type Board } from '../../api/client';
import { useBoards } from '../../hooks/use-boards';
import { useProfiles } from '../../hooks/use-profiles';
import { BoardList } from './board-list';
import { FlowCanvas } from './flow-canvas';

export function AutomationPage() {
  const { boards, create, remove } = useBoards();
  const { profiles } = useProfiles();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [board, setBoard] = useState<Board | null>(null);

  useEffect(() => {
    if (!selectedId && boards.length > 0) setSelectedId(boards[0].id);
  }, [boards, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setBoard(null);
      return;
    }
    void api.getBoard(selectedId).then(setBoard);
  }, [selectedId]);

  const handleCreate = async () => {
    const created = await create(`Board ${boards.length + 1}`);
    setSelectedId(created.id);
  };

  const handleDelete = async (id: string) => {
    await remove(id);
    if (id === selectedId) setSelectedId(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-4 border-b-2 border-foreground px-8 py-6 lg:px-10">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Automation</h1>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Flow boards · parallel profile runs
          </p>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <BoardList
          boards={boards}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onCreate={handleCreate}
          onDelete={handleDelete}
        />
        <div className="min-h-0 min-w-0 flex-1">
          {board ? (
            <FlowCanvas key={board.id} board={board} profiles={profiles} />
          ) : (
            <div className="flex h-full items-center justify-center font-mono text-xs uppercase tracking-widest text-muted-foreground">
              Select or create a board
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
