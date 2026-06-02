import type {
  BrowserLauncher,
  InteractiveSession,
  LaunchOptions,
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
