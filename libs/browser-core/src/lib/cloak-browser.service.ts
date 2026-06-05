import { writeFile } from 'node:fs/promises';
import { runAgent } from './agent/agent-runner';
import { createLlmClient, type LlmClientConfig } from './agent/llm-client';
import { redactTranscript } from './agent/redact';
import { BrowserClosedError, sleepUntil, throwIfAborted, watchUserClosed } from './browser-user-close';
import { InteractionRecorder } from './interaction-recorder';
import { asPageActions } from './playwright-page-actions';
import { buildWalletInitScript } from './wallet/provider-injection';
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

const DEFAULT_WAIT_UNTIL = 'domcontentloaded';
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

      const failResult = (step: ResolvedFlowStep, err: unknown): FlowStepResult => {
        const base = {
          status: 'failed' as const,
          error:
            err instanceof BrowserClosedError
              ? err.message
              : err instanceof Error
                ? err.message
                : String(err),
        };
        if (step.type === 'goto') return { type: 'goto', ...base };
        if (step.type === 'wait') return { type: 'wait', ...base };
        if (step.type === 'agent') {
          return {
            type: 'agent',
            ...base,
            stepsUsed: 0,
            stopReason: 'error',
            result: null,
            transcriptPath: step.transcriptPath ?? null,
          };
        }
        if (step.type === 'wallet') return { type: 'wallet', ...base };
        if (step.type === 'fill') return { type: 'fill', ...base };
        if (step.type === 'click') return { type: 'click', ...base };
        if (step.type === 'scroll') return { type: 'scroll', ...base };
        if (step.type === 'screenshot') return { type: 'screenshot', ...base, screenshotPath: null };
        if (step.type === 'if') return { type: 'if', ...base, branch: 'then' };
        return { type: 'script', ...base };
      };

      const executeAll = async (stepList: ResolvedFlowStep[]): Promise<boolean> => {
        for (const step of stepList) {
          try {
            throwIfAborted(isAborted);
            if (step.type === 'if') {
              const exists = await page.selectorExists(step.selector);
              const takeThen = step.condition === 'exists' ? exists : !exists;
              results.push({
                type: 'if',
                status: 'completed',
                error: null,
                branch: takeThen ? 'then' : 'else',
              });
              const branch = takeThen ? step.thenSteps : step.elseSteps;
              if (!(await executeAll(branch))) return false;
              continue;
            }
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
              results.push({ type: 'wait', status: 'completed', error: null });
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
              if (agentResult.status === 'failed') return false;
            } else if (step.type === 'wallet') {
              await context.addInitScript(
                buildWalletInitScript({
                  privateKey: step.privateKey,
                  chains: step.chains,
                  activeChainId: step.activeChainId,
                }),
              );
              results.push({ type: 'wallet', status: 'completed', error: null });
            } else if (step.type === 'fill') {
              await page.fill(step.selector, step.value);
              results.push({ type: 'fill', status: 'completed', error: null });
            } else if (step.type === 'click') {
              await page.clickSelector(step.selector);
              results.push({ type: 'click', status: 'completed', error: null });
            } else if (step.type === 'scroll') {
              await page.scroll(step.direction);
              results.push({ type: 'scroll', status: 'completed', error: null });
            } else if (step.type === 'script') {
              await page.runScript(step.code);
              results.push({ type: 'script', status: 'completed', error: null });
            } else if (step.type === 'screenshot') {
              await page.screenshot({ path: step.screenshotPath, fullPage: false });
              results.push({
                type: 'screenshot',
                status: 'completed',
                error: null,
                screenshotPath: step.screenshotPath,
              });
            }
          } catch (err) {
            results.push(failResult(step, err));
            return false;
          }
        }
        return true;
      };

      await executeAll(steps);

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
