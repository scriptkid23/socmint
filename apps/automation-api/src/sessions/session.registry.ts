import { OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CloakBrowserService,
  resolveProfileDir,
  resolveUserDataDir,
} from '@socmint/browser-core';
import type { InteractiveSession } from '@socmint/browser-core';
import { LockService } from '../profiles/lock.service';
import { ProfileService } from '../profiles/profile.service';
import { AuditLogger } from '../runs/audit.logger';

interface ActiveSession {
  sessionId: string;
  session: InteractiveSession;
  startedAt: string;
}

export class SessionRegistry implements OnModuleDestroy {
  private readonly active = new Map<string, ActiveSession>();

  constructor(
    private readonly profiles: ProfileService,
    private readonly lock: LockService,
    private readonly browser: CloakBrowserService,
    private readonly audit: AuditLogger,
    private readonly dataRoot: string,
  ) {}

  private dir(profileId: string): string {
    return resolveProfileDir(this.dataRoot, profileId);
  }

  async open(profileId: string): Promise<{ sessionId: string; status: 'authenticating' }> {
    const profile = await this.profiles.get(profileId);
    await this.lock.acquire(this.dir(profileId), process.pid);

    try {
      await this.profiles.setStatus(profileId, 'authenticating');
      const session = await this.browser.openInteractiveSession({
        userDataDir: resolveUserDataDir(this.dataRoot, profileId),
        proxy: profile.proxy,
        geoip: profile.launchDefaults.geoip,
      });
      const sessionId = randomUUID();
      const startedAt = new Date().toISOString();
      this.active.set(profileId, { sessionId, session, startedAt });
      session.onClosed(() => this.cleanup(profileId));
      await this.audit.append({ profileId, sessionId, event: 'opened', at: startedAt });
      return { sessionId, status: 'authenticating' };
    } catch (err) {
      await this.lock.release(this.dir(profileId));
      await this.profiles.setStatus(profileId, 'idle');
      throw err;
    }
  }

  private async cleanup(profileId: string): Promise<void> {
    const entry = this.active.get(profileId);
    if (!entry) return;
    this.active.delete(profileId);
    const at = new Date().toISOString();
    await this.lock.release(this.dir(profileId));
    await this.profiles.setStatus(profileId, 'idle');
    await this.profiles.setLastLoginAt(profileId, at);
    await this.audit.append({ profileId, sessionId: entry.sessionId, event: 'closed', at });
  }

  /** Force-close an active session (no-op if none). */
  async close(profileId: string): Promise<void> {
    const entry = this.active.get(profileId);
    if (!entry) return;
    await entry.session.close();
  }

  /** Persist all sessions on shutdown. */
  async onModuleDestroy(): Promise<void> {
    for (const profileId of [...this.active.keys()]) {
      await this.close(profileId);
    }
  }
}
