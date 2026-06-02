import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  CloakBrowserService,
  resolveProfileDir,
  resolveUserDataDir,
} from '@socmint/browser-core';
import type { LaunchOptions, RunPageOptions, ResolvedFlowStep } from '@socmint/browser-core';
import { LockService } from '../profiles/lock.service';
import { ProfileService } from '../profiles/profile.service';
import { AuditLogger } from './audit.logger';
import type { RunRecord, FlowStep, FlowStepRecord, FlowRunRecord } from './run.types';

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

  async executeFlow(profileId: string, steps: FlowStep[]): Promise<FlowRunRecord> {
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

    const resolved: ResolvedFlowStep[] = steps.map((step, i) => {
      if (step.type === 'screenshot') {
        return { type: 'screenshot', screenshotPath: resolve(runDir, `step-${i}.png`) };
      }
      if (step.type === 'wait') {
        return { type: 'wait', ms: step.ms };
      }
      return { type: 'goto', url: step.url, waitUntil: step.waitUntil, timeoutMs: step.timeoutMs };
    });

    let record: FlowRunRecord;
    try {
      const stepResults = await this.browser.runFlow(launch, resolved);
      const stepRecords: FlowStepRecord[] = stepResults.map((r, i) => ({
        type: r.type,
        status: r.status,
        error: r.error,
        title: r.title,
        finalUrl: r.finalUrl,
        screenshot:
          r.type === 'screenshot'
            ? r.status === 'completed'
              ? `runs/${runId}/step-${i}.png`
              : null
            : undefined,
      }));
      const failed = stepResults.find((r) => r.status === 'failed');
      record = {
        id: runId,
        profileId,
        status: failed ? 'failed' : 'completed',
        startedAt,
        finishedAt: new Date().toISOString(),
        error: failed?.error ?? null,
        steps: stepRecords,
      };
    } catch (err) {
      record = {
        id: runId,
        profileId,
        status: 'failed',
        startedAt,
        finishedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
        steps: [],
      };
    } finally {
      await this.lock.release(profileDir);
    }

    await writeFile(resolve(runDir, 'result.json'), JSON.stringify(record, null, 2), 'utf8');
    const firstGoto = steps.find((s): s is Extract<FlowStep, { type: 'goto' }> => s.type === 'goto');
    await this.audit.append({
      profileId,
      runId,
      url: firstGoto?.url ?? 'flow',
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
