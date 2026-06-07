import { mkdtemp, readlink, symlink, writeFile } from 'node:fs/promises';
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
    await symlink('host-99999999', resolve(dir, 'SingletonLock'));
    await writeFile(resolve(dir, 'SingletonCookie'), 'x');
    await symlink('/tmp/fake-socket', resolve(dir, 'SingletonSocket'));

    await ensureChromiumUserDataAvailable(dir);

    await expect(readlink(resolve(dir, 'SingletonLock'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('throws when lock pid is still alive', async () => {
    const dir = await tempDir('cg-live-');
    await symlink(`host-${process.pid}`, resolve(dir, 'SingletonLock'));

    await expect(ensureChromiumUserDataAvailable(dir)).rejects.toBeInstanceOf(
      ChromiumProfileInUseError,
    );
  });
});
