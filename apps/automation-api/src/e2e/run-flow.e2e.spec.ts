import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app/app.module';
import { DomainExceptionFilter } from '../app/domain-exception.filter';

const maybe = process.env.RUN_E2E === '1' ? describe : describe.skip;

maybe('run flow (e2e)', () => {
  let app: INestApplication;
  let dataRoot: string;
  let artifactsRoot: string;

  beforeAll(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'socmint-e2e-data-'));
    artifactsRoot = await mkdtemp(join(tmpdir(), 'socmint-e2e-art-'));
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

  it('creates a profile then runs against example.com', async () => {
    const created = await request(app.getHttpServer())
      .post('/profiles')
      .send({ label: 'e2e-01', launchDefaults: { headless: true } })
      .expect(201);

    const run = await request(app.getHttpServer())
      .post(`/profiles/${created.body.id}/runs`)
      .send({ url: 'https://example.com', options: { screenshot: false } })
      .expect(201);

    expect(run.body.status).toBe('completed');
    expect(run.body.page.title).toMatch(/example/i);
  }, 120000);
});
