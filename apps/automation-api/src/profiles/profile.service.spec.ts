import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ProfileStore } from './profile.store';
import { LockService } from './lock.service';
import {
  ProfileNotFoundError,
  ProfileRunningError,
  ProfileService,
} from './profile.service';

describe('ProfileService', () => {
  let dataRoot: string;
  let service: ProfileService;
  let store: ProfileStore;
  let lock: LockService;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'socmint-svc-'));
    store = new ProfileStore(dataRoot);
    lock = new LockService(180000);
    service = new ProfileService(store, lock, dataRoot);
  });
  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('create assigns a UUID, sets idle status, null lastLoginAt, and persists', async () => {
    const p = await service.create({ label: 'inv-01' });
    expect(p.id).toMatch(/[0-9a-f-]{36}/);
    expect(p.status).toBe('idle');
    expect(p.lastLoginAt).toBeNull();
    expect(p.userDataDir).toBe(`profiles/${p.id}/user-data`);
    expect(p.launchDefaults).toEqual({ headless: false, geoip: false });
    expect(await store.read(p.id)).toEqual(p);
  });

  it('get throws ProfileNotFoundError for unknown id', async () => {
    await expect(service.get('nope')).rejects.toBeInstanceOf(ProfileNotFoundError);
  });

  it('update changes allowed fields and bumps updatedAt', async () => {
    const p = await service.create({ label: 'inv-01' });
    const updated = await service.update(p.id, { label: 'renamed', proxy: 'http://p:1' });
    expect(updated.label).toBe('renamed');
    expect(updated.proxy).toBe('http://p:1');
    expect(updated.updatedAt >= p.updatedAt).toBe(true);
  });

  it('update rejects while a live lock is held', async () => {
    const p = await service.create({ label: 'inv-01' });
    await lock.acquire(resolve(dataRoot, 'profiles', p.id), process.pid);
    await expect(service.update(p.id, { label: 'x' })).rejects.toBeInstanceOf(ProfileRunningError);
  });

  it('setStatus and setLastLoginAt persist', async () => {
    const p = await service.create({ label: 'inv-01' });
    await service.setStatus(p.id, 'authenticating');
    expect((await service.get(p.id)).status).toBe('authenticating');
    await service.setLastLoginAt(p.id, '2026-06-02T01:00:00.000Z');
    const after = await service.get(p.id);
    expect(after.lastLoginAt).toBe('2026-06-02T01:00:00.000Z');
    expect(after.status).toBe('authenticating');
  });

  it('remove deletes an idle profile', async () => {
    const p = await service.create({ label: 'inv-01' });
    await service.remove(p.id);
    await expect(service.get(p.id)).rejects.toBeInstanceOf(ProfileNotFoundError);
  });

  it('remove rejects while a live lock is held', async () => {
    const p = await service.create({ label: 'inv-01' });
    await lock.acquire(resolve(dataRoot, 'profiles', p.id), process.pid);
    await expect(service.remove(p.id)).rejects.toBeInstanceOf(ProfileRunningError);
  });
});
