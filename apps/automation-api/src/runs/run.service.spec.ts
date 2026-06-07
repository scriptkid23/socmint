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
  async addInitScript() {
    /* noop */
  }
  async exposeFunction() {
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
    await lock.acquire(resolve(dataRoot, 'profiles', p.id), process.pid);
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

describe('RunService.executeFlow', () => {
  let dataRoot: string;
  let artifactsRoot: string;
  let profiles: ProfileService;
  let lock: LockService;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'rs-data-'));
    artifactsRoot = await mkdtemp(join(tmpdir(), 'rs-art-'));
    const store = new ProfileStore(dataRoot);
    lock = new LockService(60000);
    profiles = new ProfileService(store, lock, dataRoot);
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  });

  function service(browser: Pick<CloakBrowserService, 'runFlow'>) {
    return new RunService(
      profiles,
      lock,
      browser as unknown as CloakBrowserService,
      new AuditLogger(artifactsRoot),
      dataRoot,
      artifactsRoot,
    );
  }

  it('runs a multi-step chain, writes result.json, maps screenshot to a relative path', async () => {
    const profile = await profiles.create({ label: 'p1' });
    const browser = {
      runFlow: jest.fn().mockResolvedValue({ results: [
        { type: 'goto', status: 'completed', error: null, title: 'T', finalUrl: 'https://e/' },
        { type: 'screenshot', status: 'completed', error: null, screenshotPath: '/ignored.png' },
      ] }),
    };
    const svc = service(browser);

    const rec = await svc.executeFlow(profile.id, [
      { type: 'goto', url: 'https://e' },
      { type: 'screenshot' },
    ]);

    expect(rec.status).toBe('completed');
    expect(rec.steps).toHaveLength(2);
    expect(rec.steps[1].screenshot).toBe(`runs/${rec.id}/step-1.png`);
    const saved = JSON.parse(await readFile(resolve(artifactsRoot, 'runs', rec.id, 'result.json'), 'utf8'));
    expect(saved.id).toBe(rec.id);
    expect(await lock.isLocked(resolve(dataRoot, 'profiles', profile.id))).toBe(false);
  });

  it('marks the record failed when a step fails', async () => {
    const profile = await profiles.create({ label: 'p2' });
    const browser = {
      runFlow: jest.fn().mockResolvedValue({ results: [
        { type: 'goto', status: 'failed', error: 'nav boom', title: undefined, finalUrl: undefined },
      ] }),
    };
    const svc = service(browser);

    const rec = await svc.executeFlow(profile.id, [{ type: 'goto', url: 'https://e' }]);

    expect(rec.status).toBe('failed');
    expect(rec.error).toBe('nav boom');
  });

  it('maps agent step results without apiKey in saved record', async () => {
    const profile = await profiles.create({ label: 'p-agent' });
    const browser = {
      runFlow: jest.fn().mockResolvedValue({ results: [
        {
          type: 'agent',
          status: 'completed',
          error: null,
          stepsUsed: 2,
          stopReason: 'finished',
          result: { items: [] },
          transcriptPath: '/tmp/transcript.json',
        },
      ] }),
    };
    const svc = service(browser);
    const rec = await svc.executeFlow(profile.id, [
      {
        type: 'agent',
        prompt: 'task',
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: 'sk-secret',
      },
    ]);
    expect(rec.steps[0]).toMatchObject({
      type: 'agent',
      status: 'completed',
      result: { items: [] },
      stepsUsed: 2,
    });
    const saved = JSON.parse(
      await readFile(resolve(artifactsRoot, 'runs', rec.id, 'result.json'), 'utf8'),
    );
    expect(JSON.stringify(saved)).not.toContain('sk-secret');
  });

  it('produces a failed record (and releases the lock) when launch throws', async () => {
    const profile = await profiles.create({ label: 'p3' });
    const browser = { runFlow: jest.fn().mockRejectedValue(new Error('launch boom')) };
    const svc = service(browser);

    const rec = await svc.executeFlow(profile.id, [{ type: 'goto', url: 'https://e' }]);

    expect(rec.status).toBe('failed');
    expect(rec.error).toBe('launch boom');
    expect(rec.steps).toEqual([]);
    expect(await lock.isLocked(resolve(dataRoot, 'profiles', profile.id))).toBe(false);
  });

  it('forwards a fill step to runFlow unchanged', async () => {
    const profile = await profiles.create({ label: 'p-fill' });
    const browser = {
      runFlow: jest.fn().mockResolvedValue({ results: [
        { type: 'fill', status: 'completed', error: null },
      ] }),
    };
    const svc = service(browser);

    await svc.executeFlow(profile.id, [
      { type: 'fill', selector: '#email', value: 'hi@example.com' },
    ]);

    const resolved = browser.runFlow.mock.calls[0][1];
    expect(resolved).toEqual([{ type: 'fill', selector: '#email', value: 'hi@example.com' }]);
  });

  it('forwards a click step to runFlow unchanged', async () => {
    const profile = await profiles.create({ label: 'p-click' });
    const browser = {
      runFlow: jest.fn().mockResolvedValue({ results: [
        { type: 'click', status: 'completed', error: null },
      ] }),
    };
    const svc = service(browser);

    await svc.executeFlow(profile.id, [{ type: 'click', selector: 'button.submit' }]);

    const resolved = browser.runFlow.mock.calls[0][1];
    expect(resolved).toEqual([{ type: 'click', selector: 'button.submit' }]);
  });

  it('forwards a wallet step to runFlow unchanged', async () => {
    const profile = await profiles.create({ label: 'p-wallet' });
    const browser = {
      runFlow: jest.fn().mockResolvedValue({ results: [
        { type: 'wallet', status: 'completed', error: null },
      ] }),
    };
    const svc = service(browser);

    await svc.executeFlow(profile.id, [
      {
        type: 'wallet',
        privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        chains: [{ chainId: 1, rpcUrl: 'https://eth.example', name: 'Ethereum' }],
        activeChainId: 1,
      },
    ]);

    const resolved = browser.runFlow.mock.calls[0][1];
    expect(resolved).toEqual([
      {
        type: 'wallet',
        privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        chains: [{ chainId: 1, rpcUrl: 'https://eth.example', name: 'Ethereum' }],
        activeChainId: 1,
      },
    ]);
  });

  it('preserves result marker records without failing the run when kind is fail', async () => {
    const profile = await profiles.create({ label: 'p-result' });
    const browser = {
      runFlow: jest.fn().mockResolvedValue({
        results: [
          { type: 'goto', status: 'completed', error: null, title: 'T', finalUrl: 'https://e/' },
          {
            type: 'result',
            status: 'completed',
            error: null,
            nodeId: 'r1',
            kind: 'fail',
          },
        ],
      }),
    };
    const svc = service(browser);

    const rec = await svc.executeFlow(profile.id, [
      { type: 'goto', url: 'https://e' },
      { type: 'result', nodeId: 'r1', kind: 'fail' },
    ]);

    expect(rec.status).toBe('completed');
    expect(rec.steps.find((s) => s.type === 'result')).toMatchObject({
      type: 'result',
      status: 'completed',
      nodeId: 'r1',
      kind: 'fail',
    });
    const resolved = browser.runFlow.mock.calls[0][1];
    expect(resolved[1]).toEqual({ type: 'result', nodeId: 'r1', kind: 'fail' });
  });
});
