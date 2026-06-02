import { randomUUID } from 'node:crypto';
import type { RunService } from '../runs/run.service';
import type { FlowRunRecord } from '../runs/run.types';
import { BoardStore } from './board.store';
import { BoardNotFoundError } from './board.errors';
import { resolveChains } from './resolve-chains';
import type { BoardGraph, BoardRecord, BoardRunRecord } from './board.types';

export interface CreateBoardInput {
  name: string;
}
export interface UpdateBoardInput {
  name?: string;
  graph?: BoardGraph;
}

const EMPTY_GRAPH: BoardGraph = { nodes: [], edges: [] };

export class BoardService {
  constructor(
    private readonly store: BoardStore,
    private readonly runs: RunService,
  ) {}

  async create(input: CreateBoardInput): Promise<BoardRecord> {
    const now = new Date().toISOString();
    const board: BoardRecord = {
      id: randomUUID(),
      name: input.name,
      graph: EMPTY_GRAPH,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.write(board);
    return board;
  }

  async list(): Promise<BoardRecord[]> {
    return this.store.list();
  }

  async get(id: string): Promise<BoardRecord> {
    const board = await this.store.read(id);
    if (!board) throw new BoardNotFoundError(id);
    return board;
  }

  async update(id: string, input: UpdateBoardInput): Promise<BoardRecord> {
    const board = await this.get(id);
    const next: BoardRecord = {
      ...board,
      name: input.name ?? board.name,
      graph: input.graph ?? board.graph,
      updatedAt: new Date().toISOString(),
    };
    await this.store.write(next);
    return next;
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    await this.store.remove(id);
  }

  async run(id: string): Promise<BoardRunRecord> {
    const board = await this.get(id);
    const jobs = resolveChains(board.graph); // throws BoardGraphError on invalid graph
    const startedAt = new Date().toISOString();
    const runs: FlowRunRecord[] = await Promise.all(
      jobs.map((job) => this.runs.executeFlow(job.profileId, job.steps)),
    );
    return {
      id: randomUUID(),
      boardId: board.id,
      startedAt,
      finishedAt: new Date().toISOString(),
      runs,
    };
  }
}
