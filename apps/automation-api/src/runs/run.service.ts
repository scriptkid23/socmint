import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  CloakBrowserService,
  resolveProfileDir,
  resolveUserDataDir,
} from '@socmint/browser-core';
import type { LaunchOptions, RunPageOptions } from '@socmint/browser-core';
import { LockService } from '../profiles/lock.service';
import { ProfileService } from '../profiles/profile.service';
import { AuditLogger } from './audit.logger';
import type { RunRecord } from './run.types';

export interface RunRequest {
  url: string;
  options?: {
    screenshot?: boolean;
    waitUntil?: 'load' | 'domcontentloaded' | 'commit';
    timeoutMs?: number;
  };
}

export class RunService {
  constructor(
    private readonly profiles: ProfileService,
    private readonly lock: LockService,
    private readonly browser: CloakBrowserService,
    private readonly audit: AuditLogger,
    private readonly dataRoot: string,
    private readonly artifactsRoot: string,
  ) {}

  private runDir(runId: string): string {
    return resolve(this.artifactsRoot, 'runs', runId);
  }

  async execute(profileId: string, req: RunRequest): Promise<RunRecord> {
    const profile = await this.profiles.get(profileId);
    const profileDir = resolveProfileDir(this.dataRoot, profileId);

    await this.lock.acquire(profileDir, process.pid);

    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const runDir = this.runDir(runId);
    await mkdir(runDir, { recursive: true });

    const launch: LaunchOptions = {
      userDataDir: resolveUserDataDir(this.dataRoot, profileId),
      headless: profile.launchDefaults.headless,
      geoip: profile.launchDefaults.geoip,
      proxy: profile.proxy,
    };
    const runOpts: RunPageOptions = {
      url: req.url,
      waitUntil: req.options?.waitUntil,
      timeoutMs: req.options?.timeoutMs,
      screenshot: req.options?.screenshot,
      screenshotPath: req.options?.screenshot ? resolve(runDir, 'screenshot.png') : undefined,
    };

    let record: RunRecord;
    try {
      await this.profiles.setStatus(profileId, 'running');
      const page = await this.browser.runPage(launch, runOpts);
      record = {
        id: runId,
        profileId,
        url: req.url,
        status: 'completed',
        startedAt,
        finishedAt: new Date().toISOString(),
        error: null,
        page: { title: page.title, finalUrl: page.finalUrl },
        artifacts: {
          screenshot: page.screenshotPath ? `runs/${runId}/screenshot.png` : null,
        },
      };
    } catch (err) {
      record = {
        id: runId,
        profileId,
        url: req.url,
        status: 'failed',
        startedAt,
        finishedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
        page: null,
        artifacts: { screenshot: null },
      };
    } finally {
      await this.lock.release(profileDir);
      await this.profiles.setStatus(profileId, 'idle');
    }

    await writeFile(resolve(runDir, 'result.json'), JSON.stringify(record, null, 2), 'utf8');
    await this.audit.append({
      profileId,
      runId,
      url: req.url,
      timestamp: startedAt,
    });

    return record;
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    try {
      const raw = await readFile(resolve(this.runDir(runId), 'result.json'), 'utf8');
      return JSON.parse(raw) as RunRecord;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }
}
