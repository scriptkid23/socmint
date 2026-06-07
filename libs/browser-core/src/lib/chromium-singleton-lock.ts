import { readFile, readlink, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isProcessAlive } from './process-alive';

const SINGLETON_FILES = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'] as const;

/** Parse pid from Chromium SingletonLock target (e.g. `host.local-65959`). */
export function parseSingletonLockPid(lockTarget: string): number | null {
  const match = lockTarget.match(/-(\d+)$/);
  if (!match) return null;
  const pid = Number.parseInt(match[1], 10);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

export class ChromiumProfileInUseError extends Error {
  constructor(pid: number) {
    super(
      `Profile browser session is already open (Chromium pid ${pid}). Close the window or stop the active session before running again.`,
    );
    this.name = 'ChromiumProfileInUseError';
  }
}

async function readSingletonLockTarget(lockPath: string): Promise<string | null> {
  try {
    return await readlink(lockPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    // Windows (and some test seeds) may store the target as a plain file.
    if (code === 'EINVAL' || code === 'UNKNOWN') {
      return await readFile(lockPath, 'utf8');
    }
    throw err;
  }
}

/**
 * Remove Chromium singleton lock files left behind when a process exited without
 * cleaning up. Throws when a live Chromium still holds the profile.
 */
export async function ensureChromiumUserDataAvailable(userDataDir: string): Promise<void> {
  const lockPath = resolve(userDataDir, 'SingletonLock');
  const lockTarget = await readSingletonLockTarget(lockPath);
  if (lockTarget === null) return;

  const pid = parseSingletonLockPid(lockTarget);
  if (pid !== null && isProcessAlive(pid)) {
    throw new ChromiumProfileInUseError(pid);
  }

  await Promise.all(
    SINGLETON_FILES.map((name) => rm(resolve(userDataDir, name), { force: true })),
  );
}
