import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateBoardDto, UpdateBoardDto } from './dto';

function errorsFor(cls: any, payload: unknown) {
  return validateSync(plainToInstance(cls, payload), { whitelist: true });
}

describe('board DTOs', () => {
  it('accepts a valid create payload', () => {
    expect(errorsFor(CreateBoardDto, { name: 'Board A' })).toHaveLength(0);
  });

  it('rejects an empty create name', () => {
    expect(errorsFor(CreateBoardDto, { name: '' }).length).toBeGreaterThan(0);
  });

  it('accepts an update with a graph object', () => {
    const payload = { graph: { nodes: [], edges: [] } };
    expect(errorsFor(UpdateBoardDto, payload)).toHaveLength(0);
  });

  it('rejects an update whose graph is not an object', () => {
    expect(errorsFor(UpdateBoardDto, { graph: 'nope' }).length).toBeGreaterThan(0);
  });
});
