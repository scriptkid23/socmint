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
  checkedIds,
  onToggleCheck,
  runningIds,
  onRunAll,
  onRunSelected,
  batchRunning,
  canvasRunning,
  embedded = false,
}: {
  boards: Board[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  boardStatuses?: Record<string, ResultKind | undefined>;
  checkedIds?: Set<string>;
  onToggleCheck?: (id: string) => void;
  runningIds?: Set<string>;
  onRunAll?: () => void;
  onRunSelected?: () => void;
  batchRunning?: boolean;
  canvasRunning?: boolean;
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

  const runsDisabled = batchRunning || canvasRunning;
  const selectedCount = checkedIds?.size ?? 0;

  const list = (
    <>
      {onRunAll && onRunSelected && (
        <div className="flex flex-col gap-1 border-b border-border-light px-2 py-2">
          <Button
            onClick={onRunAll}
            disabled={runsDisabled || boards.length === 0}
            className="w-full text-[10px]"
          >
            Run All
          </Button>
          <Button
            onClick={onRunSelected}
            disabled={runsDisabled || selectedCount === 0}
            className="w-full text-[10px]"
          >
            Run Selected
          </Button>
        </div>
      )}
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
          <li key={b.id} className="flex border-b border-border-light">
            {onToggleCheck && (
              <label className="flex shrink-0 items-center px-2">
                <input
                  type="checkbox"
                  checked={checkedIds?.has(b.id) ?? false}
                  onChange={() => onToggleCheck(b.id)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Select ${b.name}`}
                  className="h-3.5 w-3.5 accent-foreground"
                />
              </label>
            )}
            {editingId === b.id ? (
              <div className="flex min-w-0 flex-1 items-center gap-1 px-2 py-2">
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
                className={`flex min-w-0 flex-1 items-center justify-between px-2 py-3 text-left font-mono text-xs ${rowClasses(b.id, selectedId, boardStatuses)}`}
              >
                <span className="flex min-w-0 items-center gap-1.5 truncate">
                  {runningIds?.has(b.id) && (
                    <span
                      className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-current"
                      aria-label="Running"
                    />
                  )}
                  <span className="truncate">{b.name}</span>
                </span>
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
