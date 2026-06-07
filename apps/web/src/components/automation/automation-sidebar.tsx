import { useState } from 'react';
import type { Board, ResultKind } from '../../api/client';
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
  boardStatuses,
  nodesDisabled,
  checkedIds,
  onToggleCheck,
  runningIds,
  onRunAll,
  onRunSelected,
  batchRunning,
  canvasRunning,
  batchFailures,
  onClearFailures,
}: {
  boards: Board[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onAddNode: (type: NodeType) => void;
  boardStatuses?: Record<string, ResultKind | undefined>;
  nodesDisabled?: boolean;
  checkedIds?: Set<string>;
  onToggleCheck?: (id: string) => void;
  runningIds?: Set<string>;
  onRunAll?: () => void;
  onRunSelected?: () => void;
  batchRunning?: boolean;
  canvasRunning?: boolean;
  batchFailures?: { boardName: string; message: string }[];
  onClearFailures?: () => void;
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
        <div className="flex min-h-0 flex-1 flex-col">
          {batchFailures && batchFailures.length > 0 && (
            <div className="shrink-0 border-b border-border-light bg-foreground px-3 py-2 font-mono text-[9px] leading-snug text-background">
              <div className="flex items-start justify-between gap-2">
                <p>
                  {batchFailures.map((f) => `${f.boardName}: ${f.message}`).join(' · ')}
                </p>
                {onClearFailures && (
                  <button
                    type="button"
                    onClick={onClearFailures}
                    className="shrink-0 opacity-70 hover:opacity-100"
                    aria-label="Dismiss errors"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          )}
          <BoardList
            boards={boards}
            selectedId={selectedId}
            onSelect={onSelect}
            onCreate={onCreate}
            onDelete={onDelete}
            onRename={onRename}
            boardStatuses={boardStatuses}
            checkedIds={checkedIds}
            onToggleCheck={onToggleCheck}
            runningIds={runningIds}
            onRunAll={onRunAll}
            onRunSelected={onRunSelected}
            batchRunning={batchRunning}
            canvasRunning={canvasRunning}
            embedded
          />
        </div>
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
