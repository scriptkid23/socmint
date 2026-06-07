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

function stubEvaluateHandle(
  page: object,
  opts?: { error?: Error; evals?: string[] },
): void {
  Object.assign(page, {
    evaluateHandle: async (expr: string) => {
      opts?.evals?.push(expr);
      if (opts?.error) throw opts.error;
      return { asElement: () => ({ click: async () => undefined }) };
    },
  });
}

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

  async addInitScript() {
    /* noop */
  }

  async exposeFunction() {
    /* noop */
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
      { waitUntil: 'domcontentloaded', timeout: 60000 },
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
    async addInitScript() {
      /* noop */
    }
    async exposeFunction() {
      /* noop */
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
      async evaluate() {},
      async screenshot({ path }: { path: string }) {
        calls.push(`shot:${path}`);
        return undefined;
      },
      on() {},
    } as PageLike & { on: () => void; evaluate: () => Promise<void> };
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
      exposeFunction: async () => {},
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
      async fill() {},
      async clickSelector() {},
      async pressEnter() {},
      async scroll() {},
      async selectorExists() {
        return false;
      },
      async runScript() {},
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
      async addInitScript() {},
      async exposeFunction() {},
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

  it('injects the in-page wallet provider via addInitScript before navigation', async () => {
    const initScripts: string[] = [];
    const page = {
      async goto() {},
      async title() {
        return 'T';
      },
      url() {
        return 'https://dapp.example/';
      },
      async screenshot() {},
      on() {},
    } as unknown as PageLike;
    const context: BrowserContextLike = {
      async newPage() {
        return page;
      },
      pages() {
        return [page];
      },
      on() {},
      async close() {},
      async addInitScript(s: string) {
        initScripts.push(s);
      },
      async exposeFunction() {},
    };
    const launcher: BrowserLauncher = {
      async ensureBinary() {},
      async launchPersistentContext() {
        return context;
      },
    };
    const svc = new CloakBrowserService(launcher);

    const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    const { results } = await svc.runFlow(launch, [
      {
        type: 'wallet',
        privateKey,
        chains: [{ chainId: 1, rpcUrl: 'https://eth.example', name: 'Ethereum' }],
        activeChainId: 1,
      },
    ]);

    expect(results[0]).toMatchObject({ type: 'wallet', status: 'completed', error: null });
    expect(initScripts).toHaveLength(1);
    // The self-contained in-page bundle carries the wallet config (key + chain).
    expect(initScripts[0]).toContain('__CLOAK_WALLET_CONFIG__');
    expect(initScripts[0]).toContain(privateKey);
  });

  it('fills an input by selector via an in-page evaluate', async () => {
    const evals: string[] = [];
    const page = {
      async goto() {},
      async title() {
        return 'T';
      },
      url() {
        return 'https://form.example/';
      },
      async evaluate(expr: string) {
        evals.push(expr);
      },
      async screenshot() {},
      on() {},
    } as unknown as PageLike;
    const launcher: BrowserLauncher = {
      async ensureBinary() {},
      async launchPersistentContext() {
        return {
          async newPage() {
            return page;
          },
          pages() {
            return [page];
          },
          on() {},
          async close() {},
          async addInitScript() {},
          async exposeFunction() {},
        } as BrowserContextLike;
      },
    };
    const svc = new CloakBrowserService(launcher);

    const { results } = await svc.runFlow(launch, [
      { type: 'fill', selector: '#email', value: 'hi@example.com' },
    ]);

    expect(results[0]).toMatchObject({ type: 'fill', status: 'completed', error: null });
    expect(evals).toHaveLength(1);
    expect(evals[0]).toContain('"#email"');
    expect(evals[0]).toContain('"hi@example.com"');
  });

  it('marks a fill step failed when the selector cannot be evaluated', async () => {
    const page = {
      async goto() {},
      async title() {
        return 'T';
      },
      url() {
        return 'https://form.example/';
      },
      async evaluate() {
        throw new Error('No element matches selector: #missing');
      },
      async screenshot() {},
      on() {},
    } as unknown as PageLike;
    const launcher: BrowserLauncher = {
      async ensureBinary() {},
      async launchPersistentContext() {
        return {
          async newPage() {
            return page;
          },
          pages() {
            return [page];
          },
          on() {},
          async close() {},
          async addInitScript() {},
          async exposeFunction() {},
        } as BrowserContextLike;
      },
    };
    const svc = new CloakBrowserService(launcher);

    const { results } = await svc.runFlow(launch, [
      { type: 'fill', selector: '#missing', value: 'x' },
    ]);

    expect(results[0]).toMatchObject({ type: 'fill', status: 'failed' });
    expect(results[0].error).toMatch(/selector/i);
  });

  it('clicks an element by selector via evaluateHandle + ElementHandle.click', async () => {
    const evals: string[] = [];
    const page = {
      async goto() {},
      async title() {
        return 'T';
      },
      url() {
        return 'https://app.example/';
      },
      async evaluate(expr: string) {
        evals.push(expr);
      },
      async screenshot() {},
      on() {},
    } as unknown as PageLike;
    stubEvaluateHandle(page, { evals });
    const launcher: BrowserLauncher = {
      async ensureBinary() {},
      async launchPersistentContext() {
        return {
          async newPage() {
            return page;
          },
          pages() {
            return [page];
          },
          on() {},
          async close() {},
          async addInitScript() {},
          async exposeFunction() {},
        } as BrowserContextLike;
      },
    };
    const svc = new CloakBrowserService(launcher);

    const { results } = await svc.runFlow(launch, [
      { type: 'click', selector: 'button.submit' },
    ]);

    expect(results[0]).toMatchObject({ type: 'click', status: 'completed', error: null });
    expect(evals.some((e) => e.includes('"button.submit"'))).toBe(true);
  });

  it('scrolls the page via an in-page evaluate during runFlow', async () => {
    const evals: string[] = [];
    const page = {
      async goto() {},
      async title() {
        return 'T';
      },
      url() {
        return 'https://app.example/';
      },
      async evaluate(expr: string) {
        evals.push(expr);
      },
      async screenshot() {},
      on() {},
    } as unknown as PageLike;
    const launcher: BrowserLauncher = {
      async ensureBinary() {},
      async launchPersistentContext() {
        return {
          async newPage() {
            return page;
          },
          pages() {
            return [page];
          },
          on() {},
          async close() {},
          async addInitScript() {},
          async exposeFunction() {},
        } as BrowserContextLike;
      },
    };
    const svc = new CloakBrowserService(launcher);

    const { results } = await svc.runFlow(launch, [{ type: 'scroll', direction: 'down' }]);

    expect(results[0]).toMatchObject({ type: 'scroll', status: 'completed', error: null });
    expect(evals.some((e) => e.includes('"down"'))).toBe(true);
  });

  it('marks a click step failed when the selector cannot be evaluated', async () => {
    const page = {
      async goto() {},
      async title() {
        return 'T';
      },
      url() {
        return 'https://app.example/';
      },
      async evaluate() {},
      async screenshot() {},
      on() {},
    } as unknown as PageLike;
    stubEvaluateHandle(page, {
      error: new Error('No element matches selector: #missing'),
    });
    const launcher: BrowserLauncher = {
      async ensureBinary() {},
      async launchPersistentContext() {
        return {
          async newPage() {
            return page;
          },
          pages() {
            return [page];
          },
          on() {},
          async close() {},
          async addInitScript() {},
          async exposeFunction() {},
        } as BrowserContextLike;
      },
    };
    const svc = new CloakBrowserService(launcher);

    const { results } = await svc.runFlow(launch, [
      { type: 'click', selector: '#missing' },
    ]);

    expect(results[0]).toMatchObject({ type: 'click', status: 'failed' });
    expect(results[0].error).toMatch(/selector/i);
  });

  it('runs the then branch when the selector exists', async () => {
    const evals: string[] = [];
    const page = {
      async goto() {},
      async title() {
        return 'T';
      },
      url() {
        return 'https://app.example/';
      },
      async evaluate(expr: string) {
        evals.push(expr);
        if (expr.includes('document.querySelector')) return true;
        return undefined;
      },
      async screenshot() {},
      on() {},
    } as unknown as PageLike;
    stubEvaluateHandle(page, { evals });
    const launcher: BrowserLauncher = {
      async ensureBinary() {},
      async launchPersistentContext() {
        return {
          async newPage() {
            return page;
          },
          pages() {
            return [page];
          },
          on() {},
          async close() {},
          async addInitScript() {},
          async exposeFunction() {},
        } as BrowserContextLike;
      },
    };
    const svc = new CloakBrowserService(launcher);

    const { results } = await svc.runFlow(launch, [
      {
        type: 'if',
        selector: '#ok',
        condition: 'exists',
        thenSteps: [{ type: 'click', selector: '#go' }],
        elseSteps: [{ type: 'wait', ms: 1 }],
      },
    ]);

    expect(results[0]).toMatchObject({ type: 'if', status: 'completed', branch: 'then' });
    expect(results[1]).toMatchObject({ type: 'click', status: 'completed' });
    expect(evals.some((e) => e.includes('"#go"'))).toBe(true);
  });

  it('runs the else branch when the selector is missing', async () => {
    jest.useFakeTimers();
    try {
      const page = {
        async goto() {},
        async title() {
          return 'T';
        },
        url() {
          return 'https://app.example/';
        },
        async evaluate(expr: string) {
          if (expr.includes('document.querySelector')) return false;
          return undefined;
        },
        async screenshot() {},
        on() {},
      } as unknown as PageLike;
      const launcher: BrowserLauncher = {
        async ensureBinary() {},
        async launchPersistentContext() {
          return {
            async newPage() {
              return page;
            },
            pages() {
              return [page];
            },
            on() {},
            async close() {},
            async addInitScript() {},
            async exposeFunction() {},
          } as BrowserContextLike;
        },
      };
      const svc = new CloakBrowserService(launcher);
      const run = svc.runFlow(launch, [
        {
          type: 'if',
          selector: '#missing',
          condition: 'exists',
          thenSteps: [{ type: 'click', selector: '#go' }],
          elseSteps: [{ type: 'wait', ms: 100 }],
        },
      ]);
      await jest.advanceTimersByTimeAsync(100);
      const { results } = await run;

      expect(results[0]).toMatchObject({ type: 'if', status: 'completed', branch: 'else' });
      expect(results[1]).toMatchObject({ type: 'wait', status: 'completed' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('runs script steps in the page context', async () => {
    const evals: string[] = [];
    const page = {
      async goto() {},
      async title() {
        return 'T';
      },
      url() {
        return 'https://app.example/';
      },
      async evaluate(expr: string) {
        evals.push(expr);
      },
      async screenshot() {},
      on() {},
    } as unknown as PageLike;
    const launcher: BrowserLauncher = {
      async ensureBinary() {},
      async launchPersistentContext() {
        return {
          async newPage() {
            return page;
          },
          pages() {
            return [page];
          },
          on() {},
          async close() {},
          async addInitScript() {},
          async exposeFunction() {},
        } as BrowserContextLike;
      },
    };
    const svc = new CloakBrowserService(launcher);

    const { results } = await svc.runFlow(launch, [{ type: 'script', code: 'alert("hi")' }]);

    expect(results[0]).toMatchObject({ type: 'script', status: 'completed' });
    expect(evals.some((e) => e.includes('alert'))).toBe(true);
  });

  it('emits a result marker without touching the page', async () => {
    const { launcher, calls, isClosed } = makeFakes();
    const svc = new CloakBrowserService(launcher);
    const { results } = await svc.runFlow(launch, [
      { type: 'goto', url: 'https://example.com' },
      { type: 'result', nodeId: 'r1', kind: 'pass' },
    ]);
    expect(calls).toEqual(['goto:https://example.com']);
    expect(results[1]).toMatchObject({
      type: 'result',
      status: 'completed',
      error: null,
      nodeId: 'r1',
      kind: 'pass',
    });
    expect(isClosed()).toBe(true);
  });

  it('emits only the Result marker from the if branch selected at runtime', async () => {
    const page = {
      async goto() {},
      async title() {
        return 'T';
      },
      url() {
        return 'https://app.example/';
      },
      async evaluate(expr: string) {
        if (expr.includes('document.querySelector')) return true;
        return undefined;
      },
      async screenshot() {},
      on() {},
    } as unknown as PageLike;
    const launcher: BrowserLauncher = {
      async ensureBinary() {},
      async launchPersistentContext() {
        return {
          async newPage() {
            return page;
          },
          pages() {
            return [page];
          },
          on() {},
          async close() {},
          async addInitScript() {},
          async exposeFunction() {},
        } as BrowserContextLike;
      },
    };
    const svc = new CloakBrowserService(launcher);
    const { results } = await svc.runFlow(launch, [
      {
        type: 'if',
        selector: '#ok',
        condition: 'exists',
        thenSteps: [{ type: 'result', nodeId: 'pass-node', kind: 'pass' }],
        elseSteps: [{ type: 'result', nodeId: 'fail-node', kind: 'fail' }],
      },
    ]);
    expect(results.filter((r) => r.type === 'result')).toEqual([
      expect.objectContaining({ nodeId: 'pass-node', kind: 'pass', status: 'completed' }),
    ]);
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
