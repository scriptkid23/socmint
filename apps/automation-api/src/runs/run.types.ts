import type { WaitUntil } from '@socmint/browser-core';

export type RunStatus = 'completed' | 'failed';

export interface RunRecord {
  id: string;
  profileId: string;
  url: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string;
  error: string | null;
  page: { title: string; finalUrl: string } | null;
  artifacts: { screenshot: string | null };
}

/** A step as authored on a board (paths not yet resolved). */
export type FlowStep =
  | { type: 'goto'; url: string; waitUntil?: WaitUntil; timeoutMs?: number }
  | { type: 'screenshot' };

export interface FlowStepRecord {
  type: 'goto' | 'screenshot';
  status: 'completed' | 'failed';
  error: string | null;
  /** goto only */
  title?: string;
  /** goto only */
  finalUrl?: string;
  /** screenshot only; relative artifact path "runs/<runId>/step-<n>.png" or null */
  screenshot?: string | null;
}

export interface FlowRunRecord {
  id: string;
  profileId: string;
  status: 'completed' | 'failed';
  startedAt: string;
  finishedAt: string;
  error: string | null;
  steps: FlowStepRecord[];
}
