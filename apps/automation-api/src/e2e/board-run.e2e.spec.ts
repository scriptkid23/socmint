import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app/app.module';
import { DomainExceptionFilter } from '../app/domain-exception.filter';

const maybe = process.env.RUN_E2E === '1' ? describe : describe.skip;

maybe('board run (e2e)', () => {
  let app: INestApplication;
  let dataRoot: string;
  let artifactsRoot: string;

  beforeAll(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'socmint-e2e-bdata-'));
    artifactsRoot = await mkdtemp(join(tmpdir(), 'socmint-e2e-bart-'));
    process.env.DATA_ROOT = dataRoot;
    process.env.ARTIFACTS_ROOT = artifactsRoot;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.init();
  }, 120000);

  afterAll(async () => {
    await app?.close();
    await rm(dataRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  });

  it('creates a profile + board, wires a chain, then runs it', async () => {
    const profile = await request(app.getHttpServer())
      .post('/profiles')
      .send({ label: 'e2e-board', launchDefaults: { headless: true } })
      .expect(201);

    const board = await request(app.getHttpServer())
      .post('/boards')
      .send({ name: 'e2e board' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/boards/${board.body.id}`)
      .send({
        graph: {
          nodes: [
            { id: 'p', type: 'profile', position: { x: 0, y: 0 }, data: { profileId: profile.body.id } },
            { id: 'g', type: 'goto', position: { x: 200, y: 0 }, data: { url: 'https://example.com' } },
          ],
          edges: [{ id: 'e1', source: 'p', target: 'g' }],
        },
      })
      .expect(200);

    const run = await request(app.getHttpServer())
      .post(`/boards/${board.body.id}/run`)
      .send()
      .expect(201);

    expect(run.body.runs).toHaveLength(1);
    expect(run.body.runs[0].status).toBe('completed');
  }, 120000);

  it('returns 400 for an invalid graph (branching)', async () => {
    const profile = await request(app.getHttpServer())
      .post('/profiles')
      .send({ label: 'e2e-board-bad', launchDefaults: { headless: true } })
      .expect(201);

    const board = await request(app.getHttpServer())
      .post('/boards')
      .send({ name: 'bad board' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/boards/${board.body.id}`)
      .send({
        graph: {
          nodes: [
            { id: 'p', type: 'profile', position: { x: 0, y: 0 }, data: { profileId: profile.body.id } },
            { id: 'g1', type: 'goto', position: { x: 1, y: 0 }, data: { url: 'https://a' } },
            { id: 'g2', type: 'goto', position: { x: 1, y: 1 }, data: { url: 'https://b' } },
          ],
          edges: [
            { id: 'e1', source: 'p', target: 'g1' },
            { id: 'e2', source: 'p', target: 'g2' },
          ],
        },
      })
      .expect(200);

    await request(app.getHttpServer()).post(`/boards/${board.body.id}/run`).send().expect(400);
  }, 120000);
});
