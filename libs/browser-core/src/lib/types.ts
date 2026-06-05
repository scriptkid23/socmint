import type { AgentLimits, AgentStopReason, AgentTask } from './agent/types';
import type { RecordedStep } from './recorded-step.types';
import type { WalletChainConfig } from './wallet/wallet.types';

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
  /** Register a script run on every new document (Playwright BrowserContext.addInitScript). */
  addInitScript(script: string): Promise<void>;
  /** Expose a Node function callable from the page as window[name] (Playwright exposeFunction). */
  exposeFunction(name: string, callback: (arg: unknown) => unknown): Promise<void>;
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

/** Interactive window that captures user actions into steps. */
export interface RecordingSession extends InteractiveSession {
  /** Snapshot of recorded steps so far. */
  getSteps(): RecordedStep[];
}

/** A single executable step with all paths already resolved by the caller. */
export type ResolvedFlowStep =
  | { type: 'goto'; url: string; waitUntil?: WaitUntil; timeoutMs?: number }
  | { type: 'wait'; ms: number }
  | { type: 'agent'; task: AgentTask; limits: AgentLimits; transcriptPath?: string }
  | { type: 'screenshot'; screenshotPath: string }
  | { type: 'fill'; selector: string; value: string }
  | { type: 'click'; selector: string }
  | { type: 'scroll'; direction: 'up' | 'down' }
  | { type: 'wallet'; privateKey: string; chains: WalletChainConfig[]; activeChainId: number }
  | {
      type: 'if';
      selector: string;
      condition: 'exists' | 'not_exists';
      thenSteps: ResolvedFlowStep[];
      elseSteps: ResolvedFlowStep[];
    }
  | { type: 'script'; code: string };

export interface RunFlowOptions {
  /** When true, keep the browser open and attach a recorder after steps finish. */
  keepOpenForRecording?: boolean;
}

export interface RunFlowResult {
  results: FlowStepResult[];
  /** Present when keepOpenForRecording was set and steps completed without fatal close. */
  recordingSession?: RecordingSession;
}

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
    }
  | {
      type: 'fill';
      status: 'completed' | 'failed';
      error: null | string;
    }
  | {
      type: 'click';
      status: 'completed' | 'failed';
      error: null | string;
    }
  | {
      type: 'scroll';
      status: 'completed' | 'failed';
      error: null | string;
    }
  | {
      type: 'wallet';
      status: 'completed' | 'failed';
      error: null | string;
    }
  | {
      type: 'if';
      status: 'completed' | 'failed';
      error: string | null;
      branch: 'then' | 'else';
    }
  | {
      type: 'script';
      status: 'completed' | 'failed';
      error: string | null;
    };
