import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { InteractiveSession, LaunchOptions } from '@socmint/browser-core';
import { ProfileStore } from '../profiles/profile.store';
import { LockService, ProfileBusyError } from '../profiles/lock.service';
import { ProfileService } from '../profiles/profile.service';
import { AuditLogger } from '../runs/audit.logger';
import { SessionRegistry } from './session.registry';

class FakeBrowser {
  public lastLaunch: LaunchOptions | null = null;
  public closed = false;
  private closeListeners: Array<() => void | Promise<void>> = [];
  public fail = false;

  async openInteractiveSession(launch: LaunchOptions): Promise<InteractiveSession> {
    if (this.fail) throw new Error('launch failed');
    this.lastLaunch = launch;
    return {
      onClosed: (cb: () => void) => {
        this.closeListeners.push(cb);
      },
      close: async () => {
        this.closed = true;
        for (const listener of this.closeListeners) {
          await listener();
        }
      },
    };
  }

  async fireClose(): Promise<void> {
    for (const listener of this.closeListeners) {
      await listener();
    }
  }
}

async function waitForCleanup(): Promise<void> {
  await new Promise((r) => setImmediate(r));
}

async function harness() {
  const dataRoot = await mkdtemp(join(tmpdir(), 'socmint-sess-data-'));
  const artifactsRoot = await mkdtemp(join(tmpdir(), 'socmint-sess-art-'));
  const store = new ProfileStore(dataRoot);
  const lock = new LockService(180000);
  const profiles = new ProfileService(store, lock, dataRoot);
  const browser = new FakeBrowser();
  const audit = new AuditLogger(artifactsRoot);
  const registry = new SessionRegistry(
    profiles,
    lock,
    browser as never,
    audit,
    dataRoot,
  );
  return { dataRoot, artifactsRoot, store, lock, profiles, browser, registry };
}

describe('SessionRegistry', () => {
  it('open acquires lock, sets authenticating, launches with resolved userDataDir', async () => {
    const { profiles, browser, registry, lock, dataRoot } = await harness();
    const p = await profiles.create({ label: 'inv-01', proxy: 'http://x:1' });
    const res = await registry.open(p.id);
    expect(res.status).toBe('authenticating');
    expect((await profiles.get(p.id)).status).toBe('authenticating');
    expect(await lock.isLocked(resolve(dataRoot, 'profiles', p.id))).toBe(true);
    expect(browser.lastLaunch?.userDataDir).toBe(
      resolve(dataRoot, 'profiles', p.id, 'user-data'),
    );
    expect(browser.lastLaunch?.proxy).toBe('http://x:1');
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('window close → idle, lastLoginAt set, lock released', async () => {
    const { profiles, browser, registry, lock, dataRoot, artifactsRoot } = await harness();
    const p = await profiles.create({ label: 'inv-01' });
    await registry.open(p.id);
    await browser.fireClose();
    await waitForCleanup();
    const after = await profiles.get(p.id);
    expect(after.status).toBe('idle');
    expect(after.lastLoginAt).not.toBeNull();
    expect(await lock.isLocked(resolve(dataRoot, 'profiles', p.id))).toBe(false);
    await rm(dataRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  });

  it('second open while active throws ProfileBusyError', async () => {
    const { profiles, registry, dataRoot, artifactsRoot } = await harness();
    const p = await profiles.create({ label: 'inv-01' });
    await registry.open(p.id);
    await expect(registry.open(p.id)).rejects.toBeInstanceOf(ProfileBusyError);
    await rm(dataRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  });

  it('launch failure rolls back lock + status', async () => {
    const { profiles, browser, registry, lock, dataRoot, artifactsRoot } = await harness();
    const p = await profiles.create({ label: 'inv-01' });
    browser.fail = true;
    await expect(registry.open(p.id)).rejects.toThrow('launch failed');
    expect((await profiles.get(p.id)).status).toBe('idle');
    expect(await lock.isLocked(resolve(dataRoot, 'profiles', p.id))).toBe(false);
    await rm(dataRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  });

  it('close() force-closes and cleans up', async () => {
    const { profiles, browser, registry, lock, dataRoot, artifactsRoot } = await harness();
    const p = await profiles.create({ label: 'inv-01' });
    await registry.open(p.id);
    await registry.close(p.id);
    await waitForCleanup();
    expect(browser.closed).toBe(true);
    expect((await profiles.get(p.id)).status).toBe('idle');
    expect(await lock.isLocked(resolve(dataRoot, 'profiles', p.id))).toBe(false);
    await rm(dataRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  });

  it('writes opened + closed audit entries', async () => {
    const { profiles, browser, registry, artifactsRoot, dataRoot } = await harness();
    const p = await profiles.create({ label: 'inv-01' });
    await registry.open(p.id);
    await browser.fireClose();
    await waitForCleanup();
    const log = await readFile(resolve(artifactsRoot, 'audit.log'), 'utf8');
    expect(log).toContain('"event":"opened"');
    expect(log).toContain('"event":"closed"');
    await rm(dataRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  });
});
