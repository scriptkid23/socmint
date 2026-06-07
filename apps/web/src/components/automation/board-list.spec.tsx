import { render, screen } from '@testing-library/react';
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
});
