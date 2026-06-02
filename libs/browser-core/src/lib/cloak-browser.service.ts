import type {
  BrowserLauncher,
  FlowStepResult,
  InteractiveSession,
  LaunchOptions,
  ResolvedFlowStep,
  RunPageOptions,
  RunPageResult,
} from './types';

const DEFAULT_WAIT_UNTIL = 'load';
const DEFAULT_TIMEOUT_MS = 60000;

/**
 * Framework-agnostic browser runner. Depends only on a BrowserLauncher seam,
 * so it is unit-testable with a fake and reusable outside NestJS.
 */
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
   * first failed step. Always closes the context.
   */
  async runFlow(launch: LaunchOptions, steps: ResolvedFlowStep[]): Promise<FlowStepResult[]> {
    const context = await this.launcher.launchPersistentContext(launch);
    const results: FlowStepResult[] = [];
    try {
      const page = await context.newPage();
      for (const step of steps) {
        try {
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
            await new Promise((resolve) => setTimeout(resolve, step.ms));
            results.push({
              type: 'wait',
              status: 'completed',
              error: null,
            });
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
          results.push({
            type: step.type,
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
            screenshotPath: step.type === 'screenshot' ? null : undefined,
          });
          break;
        }
      }
      return results;
    } finally {
      await context.close();
    }
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
    context.on('close', fire);

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
