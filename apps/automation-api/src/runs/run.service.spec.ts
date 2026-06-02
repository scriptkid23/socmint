import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CloakBrowserService } from '@socmint/browser-core';
import type {
  BrowserContextLike,
  BrowserLauncher,
  LaunchOptions,
  PageLike,
} from '@socmint/browser-core';
import { ProfileStore } from '../profiles/profile.store';
import { LockService, ProfileBusyError } from '../profiles/lock.service';
import { ProfileService } from '../profiles/profile.service';
import { AuditLogger } from './audit.logger';
import { RunService } from './run.service';
import type { RunRecord } from './run.types';

class FakePage implements PageLike {
  constructor(private readonly opts: { fail?: boolean } = {}) {}
  async goto() {
    if (this.opts.fail) throw new Error('nav timeout');
    return null;
  }
  async title() {
    return 'Example Domain';
  }
  url() {
    return 'https://example.com/';
  }
  async screenshot() {
    return null;
  }
}

class FakeContext implements BrowserContextLike {
  constructor(private readonly fail: boolean) {}
  pages() {
    return [];
  }
  on(_event: 'close', _listener: () => void) {
    /* noop */
  }
  async newPage() {
    return new FakePage({ fail: this.fail });
  }
  async close() {
    /* noop */
  }
}

class FakeLauncher implements BrowserLauncher {
  constructor(private readonly fail = false) {}
  async ensureBinary() {
    /* noop */
  }
  async launchPersistentContext(_opts: LaunchOptions) {
    return new FakeContext(this.fail);
  }
}

async function harness(fail = false) {
  const dataRoot = await mkdtemp(join(tmpdir(), 'socmint-run-data-'));
  const artifactsRoot = await mkdtemp(join(tmpdir(), 'socmint-run-art-'));
  const store = new ProfileStore(dataRoot);
  const lock = new LockService(180000);
  const profiles = new ProfileService(store, lock, dataRoot);
  const browser = new CloakBrowserService(new FakeLauncher(fail));
  const audit = new AuditLogger(artifactsRoot);
  const runs = new RunService(profiles, lock, browser, audit, dataRoot, artifactsRoot);
  return { dataRoot, artifactsRoot, store, lock, profiles, runs };
}

describe('RunService.execute', () => {
  afterEach(async () => {
    /* harness cleans in each test via scoped dirs — no global cleanup */
  });

  it('completes a run, writes result.json, and releases the lock', async () => {
    const { runs, profiles, lock, dataRoot, artifactsRoot } = await harness();
    const p = await profiles.create({ label: 'inv-01' });
    const rec = await runs.execute(p.id, { url: 'https://example.com' });

    expect(rec.status).toBe('completed');
    expect(rec.page).toEqual({ title: 'Example Domain', finalUrl: 'https://example.com/' });

    const onDisk: RunRecord = JSON.parse(
      await readFile(resolve(artifactsRoot, 'runs', rec.id, 'result.json'), 'utf8'),
    );
    expect(onDisk.id).toBe(rec.id);
    expect(await lock.isLocked(resolve(dataRoot, 'profiles', p.id))).toBe(false);
    await rm(dataRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  });

  it('records a failed run when navigation throws, and still releases the lock', async () => {
    const { runs, profiles, lock, dataRoot, artifactsRoot } = await harness(true);
    const p = await profiles.create({ label: 'inv-01' });
    const rec = await runs.execute(p.id, { url: 'https://example.com' });

    expect(rec.status).toBe('failed');
    expect(rec.error).toContain('nav timeout');
    expect(await lock.isLocked(resolve(dataRoot, 'profiles', p.id))).toBe(false);
    await rm(dataRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  });

  it('throws ProfileBusyError when the profile is already locked', async () => {
    const { runs, profiles, lock, dataRoot, artifactsRoot } = await harness();
    const p = await profiles.create({ label: 'inv-01' });
    await lock.acquire(resolve(dataRoot, 'profiles', p.id), 999);
    await expect(runs.execute(p.id, { url: 'https://example.com' })).rejects.toBeInstanceOf(
      ProfileBusyError,
    );
    await rm(dataRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  });

  it('appends an audit entry for each run', async () => {
    const { runs, profiles, artifactsRoot, dataRoot } = await harness();
    const p = await profiles.create({ label: 'inv-01' });
    const rec = await runs.execute(p.id, { url: 'https://example.com' });
    const log = await readFile(resolve(artifactsRoot, 'audit.log'), 'utf8');
    expect(log).toContain(rec.id);
    expect(log).toContain(p.id);
    await rm(dataRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  });

  it('getRun reads back a persisted record', async () => {
    const { runs, profiles, dataRoot, artifactsRoot } = await harness();
    const p = await profiles.create({ label: 'inv-01' });
    const rec = await runs.execute(p.id, { url: 'https://example.com' });
    expect((await runs.getRun(rec.id))?.id).toBe(rec.id);
    expect(await runs.getRun('missing')).toBeNull();
    await rm(dataRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  });
});
