import { ConflictException, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CloakBrowserService,
  resolveProfileDir,
  resolveUserDataDir,
  type RecordedStep,
} from '@socmint/browser-core';
import type { RecordingSession } from '@socmint/browser-core';
import { LockService } from '../profiles/lock.service';
import { ProfileService } from '../profiles/profile.service';
import { AuditLogger } from '../runs/audit.logger';

interface ActiveRecording {
  sessionId: string;
  session: RecordingSession;
  startedAt: string;
}

export class RecordingRegistry implements OnModuleDestroy {
  private readonly active = new Map<string, ActiveRecording>();
  /** Steps captured when the browser closed without an explicit Stop. */
  private readonly orphanedSteps = new Map<string, RecordedStep[]>();

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

  isActive(profileId: string): boolean {
    return this.active.has(profileId);
  }

  /** Register an already-open recording session (e.g. after board Run → Record chain). */
  async registerFromFlow(
    profileId: string,
    session: RecordingSession,
  ): Promise<{ sessionId: string; status: 'recording' }> {
    if (this.active.has(profileId)) {
      throw new ConflictException('A recording session is already active for this profile');
    }
    const sessionId = randomUUID();
    const startedAt = new Date().toISOString();
    this.active.set(profileId, { sessionId, session, startedAt });
    session.onClosed(() => this.cleanup(profileId));
    await this.profiles.setStatus(profileId, 'authenticating');
    await this.audit.append({
      profileId,
      sessionId,
      event: 'recording_started',
      at: startedAt,
    });
    return { sessionId, status: 'recording' };
  }

  async start(profileId: string): Promise<{ sessionId: string; status: 'recording' }> {
    if (this.active.has(profileId)) {
      throw new ConflictException('A recording session is already active for this profile');
    }

    const profile = await this.profiles.get(profileId);
    await this.lock.acquire(this.dir(profileId), process.pid);

    try {
      await this.profiles.setStatus(profileId, 'authenticating');
      const session = await this.browser.openRecordingSession({
        userDataDir: resolveUserDataDir(this.dataRoot, profileId),
        proxy: profile.proxy,
        geoip: profile.launchDefaults.geoip,
      });
      const sessionId = randomUUID();
      const startedAt = new Date().toISOString();
      this.active.set(profileId, { sessionId, session, startedAt });
      session.onClosed(() => this.cleanup(profileId));
      await this.audit.append({
        profileId,
        sessionId,
        event: 'recording_started',
        at: startedAt,
      });
      return { sessionId, status: 'recording' };
    } catch (err) {
      await this.lock.release(this.dir(profileId));
      await this.profiles.setStatus(profileId, 'idle');
      throw err;
    }
  }

  getStatus(profileId: string): { sessionId: string; status: 'recording'; steps: RecordedStep[] } | null {
    const entry = this.active.get(profileId);
    if (!entry) return null;
    return {
      sessionId: entry.sessionId,
      status: 'recording',
      steps: entry.session.getSteps(),
    };
  }

  async stop(profileId: string): Promise<{ steps: RecordedStep[] }> {
    const entry = this.active.get(profileId);
    if (!entry) {
      const cached = this.orphanedSteps.get(profileId);
      if (cached) {
        this.orphanedSteps.delete(profileId);
        return { steps: cached };
      }
      return { steps: [] };
    }
    const steps = entry.session.getSteps();
    await entry.session.close();
    return { steps };
  }

  private async cleanup(profileId: string): Promise<void> {
    const entry = this.active.get(profileId);
    if (!entry) return;
    const steps = entry.session.getSteps();
    if (steps.length > 0) {
      this.orphanedSteps.set(profileId, steps);
    }
    this.active.delete(profileId);
    const at = new Date().toISOString();
    await this.lock.release(this.dir(profileId));
    await this.profiles.setStatus(profileId, 'idle');
    await this.audit.append({
      profileId,
      sessionId: entry.sessionId,
      event: 'recording_stopped',
      at,
    });
  }

  async onModuleDestroy(): Promise<void> {
    for (const profileId of [...this.active.keys()]) {
      const entry = this.active.get(profileId);
      if (entry) await entry.session.close();
    }
  }
}
