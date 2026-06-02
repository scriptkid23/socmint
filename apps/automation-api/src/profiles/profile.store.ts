import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { resolveProfileDir, resolveUserDataDir } from '@socmint/browser-core';
import type { ProfileMetadata } from './profile.types';

export class ProfileStore {
  constructor(private readonly dataRoot: string) {}

  private metaPath(id: string): string {
    return resolve(resolveProfileDir(this.dataRoot, id), 'profile.json');
  }

  async write(profile: ProfileMetadata): Promise<void> {
    await mkdir(resolveUserDataDir(this.dataRoot, profile.id), { recursive: true });
    await writeFile(this.metaPath(profile.id), JSON.stringify(profile, null, 2), 'utf8');
  }

  async read(id: string): Promise<ProfileMetadata | null> {
    try {
      const raw = await readFile(this.metaPath(id), 'utf8');
      return JSON.parse(raw) as ProfileMetadata;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async list(): Promise<ProfileMetadata[]> {
    const profilesRoot = resolve(this.dataRoot, 'profiles');
    let entries: string[];
    try {
      entries = await readdir(profilesRoot);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const profiles: ProfileMetadata[] = [];
    for (const id of entries) {
      const profile = await this.read(id);
      if (profile) profiles.push(profile);
    }
    return profiles;
  }

  async remove(id: string): Promise<void> {
    await rm(resolveProfileDir(this.dataRoot, id), { recursive: true, force: true });
  }
}
