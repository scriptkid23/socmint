import { CloakBrowserService } from './cloak-browser.service';
import type { PageActions } from './agent/types';
import type {
  BrowserContextLike,
  BrowserLauncher,
  FlowStepResult,
  LaunchOptions,
  PageLike,
  ResolvedFlowStep,
} from './types';

class FakePage implements PageLike {
  public gotoArgs: unknown[] | null = null;
  public screenshotArgs: { path: string; fullPage: boolean } | null = null;
  constructor(
    private readonly titleValue = 'Example',
    private readonly finalUrl = 'https://example.com/final',
  ) {}
  async goto(url: string, opts: { waitUntil?: string; timeout?: number }) {
    this.gotoArgs = [url, opts];
    return null;
  }
  async title() {
    return this.titleValue;
  }
  url() {
    return this.finalUrl;
  }
  async screenshot(opts: { path: string; fullPage: boolean }) {
    this.screenshotArgs = opts;
    return null;
  }
}

class FakeContext implements BrowserContextLike {
  public closed = false;
  private closeListeners: Array<() => void> = [];

  constructor(public readonly page: FakePage) {}

  pages() {
    return [this.page];
  }

  async newPage() {
    return this.page;
  }

  on(_event: 'close', listener: () => void) {
    this.closeListeners.push(listener);
  }

  async close() {
    this.closed = true;
    this.closeListeners.forEach((l) => l());
  }
}

class FakeLauncher implements BrowserLauncher {
  public lastLaunch: LaunchOptions | null = null;
  constructor(public readonly context: FakeContext) {}
  async ensureBinary() {
    /* noop */
  }
  async launchPersistentContext(opts: LaunchOptions) {
    this.lastLaunch = opts;
    return this.context;
  }
}

describe('CloakBrowserService.runPage', () => {
  function build(page = new FakePage()) {
    const context = new FakeContext(page);
    const launcher = new FakeLauncher(context);
    return { service: new CloakBrowserService(launcher), launcher, context, page };
  }

  it('navigates and returns title + finalUrl', async () => {
    const { service, page } = build();
    const result = await service.runPage(
      { userDataDir: '/data/u' },
      { url: 'https://example.com' },
    );
    expect(result).toEqual({
      title: 'Example',
      finalUrl: 'https://example.com/final',
      screenshotPath: null,
    });
    expect(page.gotoArgs).toEqual([
      'https://example.com',
      { waitUntil: 'load', timeout: 60000 },
    ]);
  });

  it('captures a full-page screenshot when requested', async () => {
    const { service, page } = build();
    const result = await service.runPage(
      { userDataDir: '/data/u' },
      {
        url: 'https://example.com',
        screenshot: true,
        screenshotPath: '/artifacts/r/shot.png',
      },
    );
    expect(page.screenshotArgs).toEqual({
      path: '/artifacts/r/shot.png',
      fullPage: true,
    });
    expect(result.screenshotPath).toBe('/artifacts/r/shot.png');
  });

  it('always closes the context, even when goto throws', async () => {
    const page = new FakePage();
    page.goto = async () => {
      throw new Error('nav timeout');
    };
    const { service, context } = build(page);
    await expect(
      service.runPage({ userDataDir: '/data/u' }, { url: 'https://example.com' }),
    ).rejects.toThrow('nav timeout');
    expect(context.closed).toBe(true);
  });

  it('honors custom waitUntil and timeout', async () => {
    const { service, page } = build();
    await service.runPage(
      { userDataDir: '/data/u' },
      {
        url: 'https://example.com',
        waitUntil: 'domcontentloaded',
        timeoutMs: 15000,
      },
    );
    expect(page.gotoArgs).toEqual([
      'https://example.com',
      { waitUntil: 'domcontentloaded', timeout: 15000 },
    ]);
  });
});

describe('CloakBrowserService.openInteractiveSession', () => {
  class InteractiveFakeContext implements BrowserContextLike {
    public closed = false;
    public newPageCalls = 0;
    private closeListeners: Array<() => void> = [];
    constructor(private startPages: PageLike[] = []) {}
    pages() {
      return this.startPages;
    }
    async newPage() {
      this.newPageCalls++;
      const p = new FakePage();
      this.startPages = [...this.startPages, p];
      return p;
    }
    on(_event: 'close', listener: () => void) {
      this.closeListeners.push(listener);
    }
    async close() {
      this.closed = true;
      this.emitClose();
    }
    emitClose() {
      this.closeListeners.forEach((l) => l());
    }
  }

  class InteractiveFakeLauncher implements BrowserLauncher {
    public lastLaunch: LaunchOptions | null = null;
    constructor(public readonly context: InteractiveFakeContext) {}
    async ensureBinary() {}
    async launchPersistentContext(opts: LaunchOptions) {
      this.lastLaunch = opts;
      return this.context;
    }
  }

  it('forces headless:false and opens a window when none exists', async () => {
    const context = new InteractiveFakeContext([]);
    const launcher = new InteractiveFakeLauncher(context);
    const service = new CloakBrowserService(launcher);
    await service.openInteractiveSession({ userDataDir: '/d/u', headless: true });
    expect(launcher.lastLaunch?.headless).toBe(false);
    expect(context.newPageCalls).toBe(1);
  });

  it('does not open an extra page when one already exists', async () => {
    const context = new InteractiveFakeContext([new FakePage()]);
    const service = new CloakBrowserService(new InteractiveFakeLauncher(context));
    await service.openInteractiveSession({ userDataDir: '/d/u' });
    expect(context.newPageCalls).toBe(0);
  });

  it('fires onClosed exactly once when the window closes', async () => {
    const context = new InteractiveFakeContext([new FakePage()]);
    const service = new CloakBrowserService(new InteractiveFakeLauncher(context));
    const session = await service.openInteractiveSession({ userDataDir: '/d/u' });
    let calls = 0;
    session.onClosed(() => {
      calls++;
    });
    context.emitClose();
    context.emitClose();
    expect(calls).toBe(1);
  });

  it('close() closes the underlying context', async () => {
    const context = new InteractiveFakeContext([new FakePage()]);
    const service = new CloakBrowserService(new InteractiveFakeLauncher(context));
    const session = await service.openInteractiveSession({ userDataDir: '/d/u' });
    await session.close();
    expect(context.closed).toBe(true);
  });
});

describe('CloakBrowserService.runFlow', () => {
  function makeFakes(opts?: { failOnGoto?: boolean }) {
    const calls: string[] = [];
    let closed = false;
    const page = {
      async goto(url: string) {
        calls.push(`goto:${url}`);
        if (opts?.failOnGoto) throw new Error('nav boom');
        return undefined;
      },
      async title() {
        return 'Example Domain';
      },
      url() {
        return 'https://example.com/';
      },
      async screenshot({ path }: { path: string }) {
        calls.push(`shot:${path}`);
        return undefined;
      },
      on() {},
    } as PageLike & { on: () => void };
    const context: BrowserContextLike = {
      async newPage() {
        return page;
      },
      pages() {
        return [page];
      },
      on() {},
      async close() {
        closed = true;
      },
      exposeBinding: async () => {},
      addInitScript: async () => {},
    } as BrowserContextLike;
    const launcher: BrowserLauncher = {
      async ensureBinary() {},
      async launchPersistentContext() {
        return context;
      },
    };
    return { launcher, calls, isClosed: () => closed };
  }

  const launch: LaunchOptions = { userDataDir: '/tmp/x' };

  it('runs steps in order and returns per-step results', async () => {
    const { launcher, calls, isClosed } = makeFakes();
    const svc = new CloakBrowserService(launcher);
    const steps: ResolvedFlowStep[] = [
      { type: 'goto', url: 'https://example.com' },
      { type: 'screenshot', screenshotPath: '/abs/step-1.png' },
    ];

    const { results } = await svc.runFlow(launch, steps);

    expect(calls).toEqual(['goto:https://example.com', 'shot:/abs/step-1.png']);
    expect(results[0]).toMatchObject({ type: 'goto', status: 'completed', title: 'Example Domain', finalUrl: 'https://example.com/' });
    expect(results[1]).toMatchObject({ type: 'screenshot', status: 'completed', screenshotPath: '/abs/step-1.png' });
    expect(isClosed()).toBe(true);
  });

  it('waits for the requested duration between steps', async () => {
    jest.useFakeTimers();
    try {
      const { launcher, calls, isClosed } = makeFakes();
      const svc = new CloakBrowserService(launcher);
      const run = svc.runFlow(launch, [
        { type: 'goto', url: 'https://example.com' },
        { type: 'wait', ms: 2000 },
      ]);

      await jest.advanceTimersByTimeAsync(2000);
      const { results } = await run;

      expect(calls).toEqual(['goto:https://example.com']);
      expect(results[1]).toMatchObject({ type: 'wait', status: 'completed', error: null });
      expect(isClosed()).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('runs an agent step via injected LLM', async () => {
    const agentPage: PageActions = {
      async goto(url) {
        return undefined;
      },
      async title() {
        return 'T';
      },
      url: () => 'https://example.com/',
      async screenshot() {},
      async click() {},
      async type() {},
      async pressEnter() {},
      async scroll() {},
      async readDom() {
        return [{ index: 0, tag: 'button', role: 'button', text: 'Go', href: null }];
      },
    };
    const context: BrowserContextLike = {
      async newPage() {
        return agentPage as unknown as PageLike;
      },
      pages() {
        return [];
      },
      on() {},
      async close() {},
    };
    const launcher: BrowserLauncher = {
      async ensureBinary() {},
      async launchPersistentContext() {
        return context;
      },
    };
    const svc = new CloakBrowserService(launcher);
    const { results } = await svc.runFlow(
      launch,
      [
        {
          type: 'agent',
          task: {
            prompt: 'get data',
            provider: 'openai',
            model: 'gpt-4o-mini',
            apiKey: 'sk-test',
          },
          limits: {
            maxSteps: 5,
            timeoutMs: 60_000,
            allowDomains: ['example.com'],
            readOnly: true,
          },
        },
      ],
      {
        createLlm: () => ({
          async complete() {
            return {
              content: JSON.stringify({
                thought: 'done',
                action: { type: 'finish', result: { ok: true } },
                done: true,
              }),
            };
          },
        }),
      },
    );

    expect(results[0]).toMatchObject({
      type: 'agent',
      status: 'completed',
      stopReason: 'finished',
      result: { ok: true },
    });
  });

  it('stops after a failed step and closes the context', async () => {
    const { launcher, calls, isClosed } = makeFakes({ failOnGoto: true });
    const svc = new CloakBrowserService(launcher);
    const steps: ResolvedFlowStep[] = [
      { type: 'goto', url: 'https://example.com' },
      { type: 'screenshot', screenshotPath: '/abs/step-1.png' },
    ];

    const { results } = await svc.runFlow(launch, steps);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ type: 'goto', status: 'failed', error: 'nav boom' });
    expect(calls).toEqual(['goto:https://example.com']);
    expect(isClosed()).toBe(true);
  });

  it('keeps browser open for recording when requested', async () => {
    const { launcher, calls, isClosed } = makeFakes();
    const svc = new CloakBrowserService(launcher);
    const { results, recordingSession } = await svc.runFlow(
      launch,
      [{ type: 'goto', url: 'https://example.com' }],
      undefined,
      { keepOpenForRecording: true },
    );

    expect(results[0]).toMatchObject({ type: 'goto', status: 'completed' });
    expect(recordingSession).toBeDefined();
    expect(isClosed()).toBe(false);
    expect(calls).toEqual(['goto:https://example.com']);
    await recordingSession?.close();
    expect(isClosed()).toBe(true);
  });
});
