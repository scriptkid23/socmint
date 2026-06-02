import type { Board } from '../../api/client';
import { Button } from '../ui/button';

export function BoardList({
  boards,
  selectedId,
  onSelect,
  onCreate,
  onDelete,
}: {
  boards: Board[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r-2 border-foreground">
      <div className="flex items-center justify-between border-b-2 border-foreground px-4 py-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Boards
        </span>
        <Button onClick={onCreate} className="text-xs">
          + New
        </Button>
      </div>
      <ul className="min-h-0 flex-1 overflow-auto">
        {boards.map((b) => (
          <li key={b.id} className="border-b border-border-light">
            <button
              type="button"
              onClick={() => onSelect(b.id)}
              className={`flex w-full items-center justify-between px-4 py-3 text-left font-mono text-xs ${
                b.id === selectedId ? 'bg-foreground text-background' : ''
              }`}
            >
              <span className="truncate">{b.name}</span>
              <span
                role="button"
                tabIndex={0}
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
                className="ml-2 shrink-0 opacity-60 hover:opacity-100"
              >
                ✕
              </span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
