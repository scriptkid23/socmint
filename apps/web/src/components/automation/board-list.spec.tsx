import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { BoardList } from './board-list';

const boards = [
  {
    id: 'b1',
    name: 'Alpha',
    graph: { nodes: [], edges: [] },
    createdAt: '',
    updatedAt: '',
  },
];

describe('BoardList', () => {
  it('applies pass row styling from boardStatuses', () => {
    render(
      <BoardList
        boards={boards}
        selectedId={null}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        boardStatuses={{ b1: 'pass' }}
        embedded
      />,
    );
    const row = screen.getByRole('button', { name: /alpha/i });
    expect(row.className).toMatch(/green/i);
  });

  it('applies fail row styling from boardStatuses', () => {
    render(
      <BoardList
        boards={boards}
        selectedId="b1"
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        boardStatuses={{ b1: 'fail' }}
        embedded
      />,
    );
    const row = screen.getByRole('button', { name: /alpha/i });
    expect(row.className).toMatch(/red/i);
  });

  it('applies pass row styling even when the row is selected', () => {
    render(
      <BoardList
        boards={boards}
        selectedId="b1"
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        boardStatuses={{ b1: 'pass' }}
        embedded
      />,
    );
    const row = screen.getByRole('button', { name: /alpha/i });
    expect(row.className).toMatch(/green/i);
    expect(row.className).not.toMatch(/bg-foreground/);
  });

  it('disables Run Selected when no boards are checked', () => {
    render(
      <BoardList
        boards={boards}
        selectedId={null}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        checkedIds={new Set()}
        onToggleCheck={vi.fn()}
        onRunAll={vi.fn()}
        onRunSelected={vi.fn()}
        embedded
      />,
    );
    expect(screen.getByRole('button', { name: /run selected/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /run all/i })).toBeEnabled();
  });

  it('calls onRunSelected when clicked with checked boards', () => {
    const onRunSelected = vi.fn();
    render(
      <BoardList
        boards={boards}
        selectedId={null}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        checkedIds={new Set(['b1'])}
        onToggleCheck={vi.fn()}
        onRunAll={vi.fn()}
        onRunSelected={onRunSelected}
        embedded
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /run selected/i }));
    expect(onRunSelected).toHaveBeenCalledOnce();
  });

  it('toggles checkbox without selecting the board row', () => {
    const onToggleCheck = vi.fn();
    const onSelect = vi.fn();
    render(
      <BoardList
        boards={boards}
        selectedId={null}
        onSelect={onSelect}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        checkedIds={new Set()}
        onToggleCheck={onToggleCheck}
        onRunAll={vi.fn()}
        onRunSelected={vi.fn()}
        embedded
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /select alpha/i }));
    expect(onToggleCheck).toHaveBeenCalledWith('b1');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
