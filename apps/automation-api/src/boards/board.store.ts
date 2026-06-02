import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { BoardRecord } from './board.types';

export class BoardStore {
  constructor(private readonly dataRoot: string) {}

  private boardsDir(): string {
    return resolve(this.dataRoot, 'boards');
  }

  private boardPath(id: string): string {
    if (!id || id.includes('..') || id.includes('/') || id.includes('\\')) {
      throw new Error(`Invalid board id: ${id}`);
    }
    return resolve(this.boardsDir(), `${id}.json`);
  }

  async write(board: BoardRecord): Promise<void> {
    await mkdir(this.boardsDir(), { recursive: true });
    await writeFile(this.boardPath(board.id), JSON.stringify(board, null, 2), 'utf8');
  }

  async read(id: string): Promise<BoardRecord | null> {
    try {
      const raw = await readFile(this.boardPath(id), 'utf8');
      return JSON.parse(raw) as BoardRecord;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async list(): Promise<BoardRecord[]> {
    let entries: string[];
    try {
      entries = await readdir(this.boardsDir());
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const boards: BoardRecord[] = [];
    for (const file of entries) {
      if (!file.endsWith('.json')) continue;
      const board = await this.read(file.slice(0, -'.json'.length));
      if (board) boards.push(board);
    }
    return boards;
  }

  async remove(id: string): Promise<void> {
    await rm(this.boardPath(id), { force: true });
  }
}
