import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LockService, ProfileBusyError } from './lock.service';

describe('LockService', () => {
  let dataRoot: string;
  let profileDir: string;
  let lock: LockService;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'socmint-lock-'));
    profileDir = resolve(dataRoot, 'profiles', 'id-1');
    await mkdir(profileDir, { recursive: true });
    lock = new LockService(180000);
  });
  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('acquire creates a lock file holding pid + startedAt', async () => {
    await lock.acquire(profileDir, 1234);
    const raw = JSON.parse(await readFile(resolve(profileDir, 'profile.lock'), 'utf8'));
    expect(raw.pid).toBe(1234);
    expect(typeof raw.startedAt).toBe('string');
  });

  it('second acquire on a live lock throws ProfileBusyError', async () => {
    await lock.acquire(profileDir, process.pid);
    await expect(lock.acquire(profileDir, process.pid + 1)).rejects.toBeInstanceOf(ProfileBusyError);
  });

  it('release removes the lock and is idempotent', async () => {
    await lock.acquire(profileDir, 1234);
    await lock.release(profileDir);
    await expect(lock.release(profileDir)).resolves.toBeUndefined();
    await expect(lock.acquire(profileDir, 9999)).resolves.toBeUndefined();
  });

  it('acquire overrides a lock whose pid is no longer running', async () => {
    await writeFile(
      resolve(profileDir, 'profile.lock'),
      JSON.stringify({ pid: 99999999, startedAt: new Date().toISOString() }),
    );
    await expect(lock.acquire(profileDir, 4321)).resolves.toBeUndefined();
  });

  it('acquire overrides a stale lock (older than TTL)', async () => {
    await writeFile(
      resolve(profileDir, 'profile.lock'),
      JSON.stringify({ pid: 1, startedAt: '2000-01-01T00:00:00.000Z' }),
    );
    await expect(lock.acquire(profileDir, 4321)).resolves.toBeUndefined();
  });

  it('isLocked is false when stale, true when live', async () => {
    await writeFile(
      resolve(profileDir, 'profile.lock'),
      JSON.stringify({ pid: 1, startedAt: '2000-01-01T00:00:00.000Z' }),
    );
    expect(await lock.isLocked(profileDir)).toBe(false);
    await lock.acquire(profileDir, process.pid);
    expect(await lock.isLocked(profileDir)).toBe(true);
  });

  it('clearStaleUnder removes only stale locks across all profiles', async () => {
    const otherDir = resolve(dataRoot, 'profiles', 'id-2');
    await mkdir(otherDir, { recursive: true });
    await lock.acquire(profileDir, process.pid);
    await writeFile(
      resolve(otherDir, 'profile.lock'),
      JSON.stringify({ pid: 1, startedAt: '2000-01-01T00:00:00.000Z' }),
    );
    await lock.clearStaleUnder(resolve(dataRoot, 'profiles'));
    expect(await lock.isLocked(profileDir)).toBe(true);
    expect(await lock.isLocked(otherDir)).toBe(false);
  });
});
