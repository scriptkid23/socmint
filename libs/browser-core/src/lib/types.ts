import type { AgentLimits, AgentStopReason, AgentTask } from './agent/types';

export type { AgentLimits, AgentStopReason, AgentTask } from './agent/types';

/** Options passed through to CloakBrowser's launchPersistentContext. */
export interface LaunchOptions {
  /** Absolute, already-resolved userDataDir. */
  userDataDir: string;
  headless?: boolean;
  proxy?: string | null;
  geoip?: boolean;
  /** Generic pass-through for future/unverified options (e.g. humanize). */
  [key: string]: unknown;
}

export type WaitUntil = 'load' | 'domcontentloaded' | 'commit';

export interface RunPageOptions {
  url: string;
  waitUntil?: WaitUntil;
  timeoutMs?: number;
  screenshot?: boolean;
  /** Absolute path to write the PNG when screenshot is true. */
  screenshotPath?: string;
}

export interface RunPageResult {
  title: string;
  finalUrl: string;
  screenshotPath: string | null;
}

/** Minimal Playwright-page surface we depend on (the test seam). */
export interface PageLike {
  goto(url: string, opts: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  title(): Promise<string>;
  url(): string;
  screenshot(opts: { path: string; fullPage: boolean }): Promise<unknown>;
}

export interface BrowserContextLike {
  newPage(): Promise<PageLike>;
  pages(): PageLike[];
  on(event: 'close', listener: () => void): void;
  close(): Promise<void>;
}

/** Injectable seam so the service can be unit-tested without real Chromium. */
export interface BrowserLauncher {
  ensureBinary(): Promise<void>;
  launchPersistentContext(opts: LaunchOptions): Promise<BrowserContextLike>;
}

/** Handle to a live, operator-driven browser window. */
export interface InteractiveSession {
  /** Fires exactly once when the context closes (window closed or close() called). */
  onClosed(listener: () => void): void;
  /** Force-close the context (also triggers onClosed). */
  close(): Promise<void>;
}

/** A single executable step with all paths already resolved by the caller. */
export type ResolvedFlowStep =
  | { type: 'goto'; url: string; waitUntil?: WaitUntil; timeoutMs?: number }
  | { type: 'wait'; ms: number }
  | { type: 'agent'; task: AgentTask; limits: AgentLimits; transcriptPath?: string }
  | { type: 'screenshot'; screenshotPath: string };

/** Per-step outcome returned by runFlow, in execution order. */
export interface AgentFlowStepResult {
  type: 'agent';
  status: 'completed' | 'failed';
  error: string | null;
  stepsUsed: number;
  stopReason: AgentStopReason;
  result: unknown | null;
  transcriptPath?: string | null;
}

export type FlowStepResult =
  | {
      type: 'goto';
      status: 'completed' | 'failed';
      error: string | null;
      title?: string;
      finalUrl?: string;
    }
  | {
      type: 'wait';
      status: 'completed' | 'failed';
      error: string | null;
    }
  | AgentFlowStepResult
  | {
      type: 'screenshot';
      status: 'completed' | 'failed';
      error: string | null;
      screenshotPath?: string | null;
    };
