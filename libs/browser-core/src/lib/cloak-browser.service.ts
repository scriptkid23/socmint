import { writeFile } from 'node:fs/promises';
import { runAgent } from './agent/agent-runner';
import { createLlmClient, type LlmClientConfig } from './agent/llm-client';
import { redactTranscript } from './agent/redact';
import { BrowserClosedError, sleepUntil, throwIfAborted, watchUserClosed } from './browser-user-close';
import { InteractionRecorder } from './interaction-recorder';
import { asPageActions } from './playwright-page-actions';
import type {
  BrowserLauncher,
  FlowStepResult,
  InteractiveSession,
  RecordingSession,
  LaunchOptions,
  ResolvedFlowStep,
  RunFlowOptions,
  RunFlowResult,
  RunPageOptions,
  RunPageResult,
} from './types';

const DEFAULT_WAIT_UNTIL = 'load';
const DEFAULT_TIMEOUT_MS = 60000;

/**
 * Framework-agnostic browser runner. Depends only on a BrowserLauncher seam,
 * so it is unit-testable with a fake and reusable outside NestJS.
 */
export interface RunFlowDeps {
  createLlm?: (config: LlmClientConfig) => ReturnType<typeof createLlmClient>;
}

export class CloakBrowserService {
  constructor(private readonly launcher: BrowserLauncher) {}

  async runPage(launch: LaunchOptions, run: RunPageOptions): Promise<RunPageResult> {
    const context = await this.launcher.launchPersistentContext(launch);
    try {
      const page = await context.newPage();
      await page.goto(run.url, {
        waitUntil: run.waitUntil ?? DEFAULT_WAIT_UNTIL,
        timeout: run.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
      const title = await page.title();
      const finalUrl = page.url();

      let screenshotPath: string | null = null;
      if (run.screenshot && run.screenshotPath) {
        await page.screenshot({ path: run.screenshotPath, fullPage: true });
        screenshotPath = run.screenshotPath;
      }

      return { title, finalUrl, screenshotPath };
    } finally {
      await context.close();
    }
  }

  /**
   * Open one persistent context and execute steps sequentially. Stops at the
   * first failed step. Closes the context unless keepOpenForRecording is set.
   */
  async runFlow(
    launch: LaunchOptions,
    steps: ResolvedFlowStep[],
    deps?: RunFlowDeps,
    options?: RunFlowOptions,
  ): Promise<RunFlowResult> {
    const context = await this.launcher.launchPersistentContext(launch);
    const results: FlowStepResult[] = [];
    let userClosed = false;
    watchUserClosed(context, () => {
      userClosed = true;
    });
    const isAborted = () => userClosed;
    let recordingSession: RecordingSession | undefined;

    try {
      const rawPage = await context.newPage();
      const page = asPageActions(rawPage);
      const createLlm = deps?.createLlm ?? createLlmClient;

      for (const step of steps) {
        try {
          throwIfAborted(isAborted);
          if (step.type === 'goto') {
            await page.goto(step.url, {
              waitUntil: step.waitUntil ?? DEFAULT_WAIT_UNTIL,
              timeout: step.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            });
            results.push({
              type: 'goto',
              status: 'completed',
              error: null,
              title: await page.title(),
              finalUrl: page.url(),
            });
          } else if (step.type === 'wait') {
            await sleepUntil(step.ms, isAborted);
            results.push({
              type: 'wait',
              status: 'completed',
              error: null,
            });
          } else if (step.type === 'agent') {
            const llm = createLlm({
              provider: step.task.provider,
              model: step.task.model,
              apiKey: step.task.apiKey,
              baseUrl: step.task.baseUrl,
            });
            const agentResult = await runAgent(page, step.task, llm, step.limits);
            if (step.transcriptPath) {
              await writeFile(
                step.transcriptPath,
                JSON.stringify(redactTranscript(agentResult.transcript), null, 2),
                'utf8',
              );
            }
            results.push({
              type: 'agent',
              status: agentResult.status,
              error: agentResult.error,
              stepsUsed: agentResult.stepsUsed,
              stopReason: agentResult.stopReason,
              result: agentResult.result,
              transcriptPath: step.transcriptPath ?? null,
            });
            if (agentResult.status === 'failed') break;
          } else {
            await page.screenshot({ path: step.screenshotPath, fullPage: true });
            results.push({
              type: 'screenshot',
              status: 'completed',
              error: null,
              screenshotPath: step.screenshotPath,
            });
          }
        } catch (err) {
          const base = {
            status: 'failed' as const,
            error:
              err instanceof BrowserClosedError
                ? err.message
                : err instanceof Error
                  ? err.message
                  : String(err),
          };
          if (step.type === 'goto') {
            results.push({ type: 'goto', ...base });
          } else if (step.type === 'wait') {
            results.push({ type: 'wait', ...base });
          } else if (step.type === 'agent') {
            results.push({
              type: 'agent',
              ...base,
              stepsUsed: 0,
              stopReason: 'error',
              result: null,
              transcriptPath: step.transcriptPath ?? null,
            });
          } else {
            results.push({ type: 'screenshot', ...base, screenshotPath: null });
          }
          break;
        }
      }

      const failed = results.some((r) => r.status === 'failed');
      if (options?.keepOpenForRecording && !failed && !userClosed) {
        const recorder = new InteractionRecorder();
        await recorder.attach(context);
        const listeners: Array<() => void> = [];
        let fired = false;
        const fire = () => {
          if (fired) return;
          fired = true;
          listeners.forEach((l) => l());
        };
        watchUserClosed(context, fire);
        recordingSession = {
          getSteps: () => recorder.getSteps(),
          onClosed(listener: () => void) {
            listeners.push(listener);
          },
          async close() {
            await context.close();
          },
        };
      }

      return { results, recordingSession };
    } finally {
      if (!recordingSession) {
        await context.close();
      }
    }
  }

  /** Launch a visible browser window that records user interactions. */
  async openRecordingSession(launch: LaunchOptions): Promise<RecordingSession> {
    const context = await this.launcher.launchPersistentContext({ ...launch, headless: false });
    const recorder = new InteractionRecorder();
    await recorder.attach(context);

    if (context.pages().length === 0) {
      await context.newPage();
    }

    const listeners: Array<() => void> = [];
    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      listeners.forEach((l) => l());
    };
    watchUserClosed(context, fire);

    return {
      getSteps: () => recorder.getSteps(),
      onClosed(listener: () => void) {
        listeners.push(listener);
      },
      async close() {
        await context.close();
      },
    };
  }

  /** Launch a visible, operator-driven window bound to a profile's userDataDir. */
  async openInteractiveSession(launch: LaunchOptions): Promise<InteractiveSession> {
    const context = await this.launcher.launchPersistentContext({ ...launch, headless: false });

    if (context.pages().length === 0) {
      await context.newPage();
    }

    const listeners: Array<() => void> = [];
    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      listeners.forEach((l) => l());
    };
    watchUserClosed(context, fire);

    return {
      onClosed(listener: () => void) {
        listeners.push(listener);
      },
      async close() {
        await context.close();
      },
    };
  }
}
