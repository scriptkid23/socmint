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
  | { type: 'wait'; ms: number }
  | {
      type: 'agent';
      prompt: string;
      provider: 'openai' | 'anthropic' | 'gemini' | 'ollama';
      model: string;
      apiKey: string;
      baseUrl?: string;
      maxSteps?: number;
      timeoutMs?: number;
      allowDomains?: string[];
      readOnly?: boolean;
    }
  | { type: 'screenshot' };

export interface FlowStepRecord {
  type: 'goto' | 'wait' | 'agent' | 'screenshot';
  status: 'completed' | 'failed';
  error: string | null;
  /** goto only */
  title?: string;
  /** goto only */
  finalUrl?: string;
  /** screenshot only; relative artifact path "runs/<runId>/step-<n>.png" or null */
  screenshot?: string | null;
  /** agent only */
  stepsUsed?: number;
  stopReason?: 'finished' | 'max-steps' | 'timeout' | 'error';
  result?: unknown;
  transcript?: string;
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
