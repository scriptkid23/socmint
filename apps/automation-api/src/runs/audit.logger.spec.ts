import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AuditLogger } from './audit.logger';

describe('AuditLogger', () => {
  let artifactsRoot: string;
  let logger: AuditLogger;

  beforeEach(async () => {
    artifactsRoot = await mkdtemp(join(tmpdir(), 'socmint-audit-'));
    logger = new AuditLogger(artifactsRoot);
  });
  afterEach(async () => {
    await rm(artifactsRoot, { recursive: true, force: true });
  });

  it('appends one JSON line per entry', async () => {
    await logger.append({
      profileId: 'p1',
      runId: 'r1',
      url: 'https://a',
      timestamp: '2026-06-02T00:00:00.000Z',
    });
    await logger.append({
      profileId: 'p1',
      runId: 'r2',
      url: 'https://b',
      timestamp: '2026-06-02T00:00:01.000Z',
    });
    const raw = await readFile(resolve(artifactsRoot, 'audit.log'), 'utf8');
    const lines = raw.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).runId).toBe('r1');
    expect(JSON.parse(lines[1]).runId).toBe('r2');
  });
});
