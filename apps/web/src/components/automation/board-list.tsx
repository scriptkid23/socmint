import { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import type { Board, ResultKind } from '../../api/client';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

function rowClasses(
  boardId: string,
  selectedId: string | null,
  boardStatuses?: Record<string, ResultKind | undefined>,
) {
  const status = boardStatuses?.[boardId];
  if (status === 'pass') return 'bg-green-600 text-white';
  if (status === 'fail') return 'bg-red-600 text-white';
  return boardId === selectedId ? 'bg-foreground text-background' : '';
}

export function BoardList({
  boards,
  selectedId,
  onSelect,
  onCreate,
  onDelete,
  onRename,
  boardStatuses,
  embedded = false,
}: {
  boards: Board[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  boardStatuses?: Record<string, ResultKind | undefined>;
  /** When true, omit outer aside chrome (used inside AutomationSidebar). */
  embedded?: boolean;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) inputRef.current?.select();
  }, [editingId]);

  const startEdit = (b: Board) => {
    setEditingId(b.id);
    setDraft(b.name);
  };

  const commit = () => {
    if (!editingId) return;
    const next = draft.trim();
    const current = boards.find((b) => b.id === editingId);
    if (next && current && next !== current.name) onRename(editingId, next);
    setEditingId(null);
  };

  const cancel = () => setEditingId(null);

  const list = (
    <>
      <div className="flex items-center justify-between border-b border-border-light px-4 py-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {boards.length} board{boards.length === 1 ? '' : 's'}
        </span>
        <Button onClick={onCreate} className="text-xs">
          + New
        </Button>
      </div>
      <ul className="min-h-0 flex-1 overflow-auto">
        {boards.map((b) => (
          <li key={b.id} className="border-b border-border-light">
            {editingId === b.id ? (
              <div className="flex items-center gap-1 px-2 py-2">
                <Input
                  ref={inputRef}
                  className="h-7 flex-1 px-2 text-xs"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commit();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      cancel();
                    }
                  }}
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onSelect(b.id)}
                onDoubleClick={() => startEdit(b)}
                className={`flex w-full items-center justify-between px-4 py-3 text-left font-mono text-xs ${rowClasses(b.id, selectedId, boardStatuses)}`}
              >
                <span className="truncate">{b.name}</span>
                <span className="ml-2 flex shrink-0 items-center gap-1.5">
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label="Rename board"
                    onClick={(e) => {
                      e.stopPropagation();
                      startEdit(b);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        startEdit(b);
                      }
                    }}
                    className="opacity-60 hover:opacity-100"
                  >
                    <Pencil size={12} />
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label="Delete board"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(b.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        onDelete(b.id);
                      }
                    }}
                    className="opacity-60 hover:opacity-100"
                  >
                    ✕
                  </span>
                </span>
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );

  if (embedded) {
    return <div className="flex min-h-0 flex-1 flex-col">{list}</div>;
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r-2 border-foreground">
      {list}
    </aside>
  );
}
