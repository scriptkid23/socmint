import { isProcessAlive } from '@socmint/browser-core';
import { open, readFile, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

export class ProfileBusyError extends Error {
  constructor() {
    super('Profile already running');
    this.name = 'ProfileBusyError';
  }
}

interface LockFile {
  pid: number;
  startedAt: string;
}

export class LockService {
  constructor(private readonly ttlMs: number) {}

  private lockPath(profileDir: string): string {
    return resolve(profileDir, 'profile.lock');
  }

  private async readLock(path: string): Promise<LockFile | null> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as LockFile;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      return null;
    }
  }

  private isStale(lock: LockFile): boolean {
    if (!isProcessAlive(lock.pid)) return true;
    const started = Date.parse(lock.startedAt);
    if (Number.isNaN(started)) return true;
    return Date.now() - started > this.ttlMs;
  }

  async acquire(profileDir: string, pid: number): Promise<void> {
    const path = this.lockPath(profileDir);
    const existing = await this.readLock(path);
    if (existing) {
      if (isProcessAlive(existing.pid) && !this.isStale(existing)) {
        throw new ProfileBusyError();
      }
      await rm(path, { force: true });
    }
    try {
      const handle = await open(path, 'wx');
      await handle.writeFile(JSON.stringify({ pid, startedAt: new Date().toISOString() }));
      await handle.close();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new ProfileBusyError();
      throw err;
    }
  }

  async release(profileDir: string): Promise<void> {
    await rm(this.lockPath(profileDir), { force: true });
  }

  async isLocked(profileDir: string): Promise<boolean> {
    const lock = await this.readLock(this.lockPath(profileDir));
    if (!lock) return false;
    if (!isProcessAlive(lock.pid)) return false;
    return !this.isStale(lock);
  }

  async clearStaleUnder(profilesRoot: string): Promise<void> {
    let ids: string[];
    try {
      ids = await readdir(profilesRoot);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    for (const id of ids) {
      const path = this.lockPath(resolve(profilesRoot, id));
      const lock = await this.readLock(path);
      if (lock && this.isStale(lock)) {
        await rm(path, { force: true });
      }
    }
  }
}
