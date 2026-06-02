import { CloakBrowserService } from './cloak-browser.service';
import type {
  BrowserContextLike,
  BrowserLauncher,
  LaunchOptions,
  PageLike,
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
  constructor(public readonly page: FakePage) {}
  async newPage() {
    return this.page;
  }
  async close() {
    this.closed = true;
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
