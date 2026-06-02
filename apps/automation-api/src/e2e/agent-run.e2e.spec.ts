import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app/app.module';

const maybe =
  process.env.RUN_E2E === '1' && process.env.AGENT_API_KEY ? describe : describe.skip;

maybe('agent board run (e2e)', () => {
  let app: INestApplication;
  let dataRoot: string;
  let artifactsRoot: string;

  beforeAll(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'socmint-e2e-agent-data-'));
    artifactsRoot = await mkdtemp(join(tmpdir(), 'socmint-e2e-agent-art-'));
    process.env.DATA_ROOT = dataRoot;
    process.env.ARTIFACTS_ROOT = artifactsRoot;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await rm(dataRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  });

  it('runs a board with an agent step', async () => {
    const prof = await request(app.getHttpServer())
      .post('/profiles')
      .send({ label: 'e2e-agent', launchDefaults: { headless: true } })
      .expect(201);

    const board = await request(app.getHttpServer())
      .post('/boards')
      .send({ name: 'agent-e2e' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/boards/${board.body.id}`)
      .send({
        graph: {
          nodes: [
            { id: 'p', type: 'profile', position: { x: 0, y: 0 }, data: { profileId: prof.body.id } },
            {
              id: 'g',
              type: 'goto',
              position: { x: 1, y: 0 },
              data: { url: 'https://example.com' },
            },
            {
              id: 'a',
              type: 'agent',
              position: { x: 2, y: 0 },
              data: {
                prompt: 'Return JSON {"heading": string} with the main h1 text on the page',
                provider: 'openai',
                model: 'gpt-4o-mini',
                apiKey: process.env.AGENT_API_KEY,
              },
            },
          ],
          edges: [
            { id: 'e1', source: 'p', target: 'g' },
            { id: 'e2', source: 'g', target: 'a' },
          ],
        },
      })
      .expect(200);

    const run = await request(app.getHttpServer())
      .post(`/boards/${board.body.id}/run`)
      .expect(201);

    const flowRun = run.body.runs[0];
    expect(flowRun.steps.some((s: { type: string }) => s.type === 'agent')).toBe(true);
  });
});
