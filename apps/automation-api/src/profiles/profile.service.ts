import { randomUUID } from 'node:crypto';
import { resolveProfileDir } from '@socmint/browser-core';
import type { CreateProfileDto, UpdateProfileDto } from './dto';
import { LockService } from './lock.service';
import { ProfileStore } from './profile.store';
import type { ProfileMetadata } from './profile.types';

export class ProfileNotFoundError extends Error {
  constructor(id: string) {
    super(`Profile not found: ${id}`);
    this.name = 'ProfileNotFoundError';
  }
}

export class ProfileRunningError extends Error {
  constructor(id: string) {
    super(`Profile is running: ${id}`);
    this.name = 'ProfileRunningError';
  }
}

export class ProfileService {
  constructor(
    private readonly store: ProfileStore,
    private readonly lock: LockService,
    private readonly dataRoot: string,
  ) {}

  private profileDir(id: string): string {
    return resolveProfileDir(this.dataRoot, id);
  }

  async create(dto: CreateProfileDto): Promise<ProfileMetadata> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const profile: ProfileMetadata = {
      id,
      label: dto.label,
      userDataDir: `profiles/${id}/user-data`,
      proxy: dto.proxy ?? null,
      fingerprintSeed: dto.fingerprintSeed ?? null,
      launchDefaults: {
        headless: dto.launchDefaults?.headless ?? false,
        geoip: dto.launchDefaults?.geoip ?? false,
      },
      status: 'idle',
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.write(profile);
    return profile;
  }

  async list(): Promise<ProfileMetadata[]> {
    return this.store.list();
  }

  async get(id: string): Promise<ProfileMetadata> {
    const profile = await this.store.read(id);
    if (!profile) throw new ProfileNotFoundError(id);
    return profile;
  }

  async update(id: string, dto: UpdateProfileDto): Promise<ProfileMetadata> {
    const profile = await this.get(id);
    if (await this.lock.isLocked(this.profileDir(id))) {
      throw new ProfileRunningError(id);
    }
    const next: ProfileMetadata = {
      ...profile,
      label: dto.label ?? profile.label,
      proxy: dto.proxy ?? profile.proxy,
      fingerprintSeed: dto.fingerprintSeed ?? profile.fingerprintSeed,
      launchDefaults: {
        headless: dto.launchDefaults?.headless ?? profile.launchDefaults.headless,
        geoip: dto.launchDefaults?.geoip ?? profile.launchDefaults.geoip,
      },
      updatedAt: new Date().toISOString(),
    };
    await this.store.write(next);
    return next;
  }

  async setStatus(id: string, status: ProfileMetadata['status']): Promise<void> {
    const profile = await this.get(id);
    await this.store.write({ ...profile, status, updatedAt: new Date().toISOString() });
  }

  async setLastLoginAt(id: string, iso: string): Promise<void> {
    const profile = await this.get(id);
    await this.store.write({
      ...profile,
      lastLoginAt: iso,
      updatedAt: new Date().toISOString(),
    });
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    if (await this.lock.isLocked(this.profileDir(id))) {
      throw new ProfileRunningError(id);
    }
    await this.store.remove(id);
  }
}
