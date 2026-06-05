import { useState } from 'react';
import type { Board } from '../../api/client';
import { BoardList } from './board-list';
import { NodePalette } from './node-palette';
import type { NodeType } from './nodes/registry';

type SidebarTab = 'boards' | 'nodes';

export function AutomationSidebar({
  boards,
  selectedId,
  onSelect,
  onCreate,
  onDelete,
  onRename,
  onAddNode,
  nodesDisabled,
}: {
  boards: Board[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onAddNode: (type: NodeType) => void;
  nodesDisabled?: boolean;
}) {
  const [tab, setTab] = useState<SidebarTab>('boards');

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r-2 border-foreground">
      <div className="flex border-b-2 border-foreground font-mono text-[10px] uppercase tracking-widest">
        {(['boards', 'nodes'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 px-2 py-2.5 ${
              tab === t ? 'bg-foreground text-background' : 'bg-background text-foreground'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'boards' ? (
        <BoardList
          boards={boards}
          selectedId={selectedId}
          onSelect={onSelect}
          onCreate={onCreate}
          onDelete={onDelete}
          onRename={onRename}
          embedded
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <p className="border-b border-border-light px-4 py-2 font-mono text-[9px] leading-snug text-muted-foreground">
            Click to add a node to the open board
          </p>
          <NodePalette onAdd={onAddNode} disabled={nodesDisabled} />
        </div>
      )}
    </aside>
  );
}
