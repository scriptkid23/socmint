import { access, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  ChromiumProfileInUseError,
  ensureChromiumUserDataAvailable,
  parseSingletonLockPid,
} from './chromium-singleton-lock';

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/** Seed SingletonLock as symlink when allowed, else as a plain file (Windows without dev mode). */
async function seedSingletonLock(dir: string, target: string): Promise<void> {
  const lockPath = resolve(dir, 'SingletonLock');
  try {
    await symlink(target, lockPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EPERM') {
      await writeFile(lockPath, target, 'utf8');
      return;
    }
    throw err;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('chromium-singleton-lock', () => {
  it('parses pid from SingletonLock target', () => {
    expect(parseSingletonLockPid('oliviers-MacBook-Pro.local-65959')).toBe(65959);
    expect(parseSingletonLockPid('invalid')).toBeNull();
  });

  it('no-ops when SingletonLock is absent', async () => {
    const dir = await tempDir('cg-empty-');
    await expect(ensureChromiumUserDataAvailable(dir)).resolves.toBeUndefined();
  });

  it('clears stale singleton files when lock pid is dead', async () => {
    const dir = await tempDir('cg-stale-');
    await seedSingletonLock(dir, 'host-99999999');
    await writeFile(resolve(dir, 'SingletonCookie'), 'x');
    try {
      await symlink('/tmp/fake-socket', resolve(dir, 'SingletonSocket'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EPERM') throw err;
      await writeFile(resolve(dir, 'SingletonSocket'), '/tmp/fake-socket', 'utf8');
    }

    await ensureChromiumUserDataAvailable(dir);

    expect(await pathExists(resolve(dir, 'SingletonLock'))).toBe(false);
  });

  it('throws when lock pid is still alive', async () => {
    const dir = await tempDir('cg-live-');
    await seedSingletonLock(dir, `host-${process.pid}`);

    await expect(ensureChromiumUserDataAvailable(dir)).rejects.toBeInstanceOf(
      ChromiumProfileInUseError,
    );
  });
});
