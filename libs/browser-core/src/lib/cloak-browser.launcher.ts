import type { BrowserContextLike, BrowserLauncher, LaunchOptions } from './types';

type CloakModule = typeof import('cloakbrowser');

async function loadCloakModule(): Promise<CloakModule> {
  // Avoid webpack transforming ESM-only cloakbrowser into require().
  const loader = new Function('return import("cloakbrowser")') as () => Promise<CloakModule>;
  return loader();
}

/**
 * Real launcher. Wires LaunchOptions to CloakBrowser's launchPersistentContext.
 * Only verified options are forwarded explicitly (userDataDir, headless, proxy,
 * geoip). `humanize`/`fingerprintSeed` are NOT forwarded in this MVP — they are
 * documented for launch() only and unverified for the persistent-context path.
 */
export class CloakBrowserLauncher implements BrowserLauncher {
  async ensureBinary(): Promise<void> {
    const { ensureBinary } = await loadCloakModule();
    await ensureBinary();
  }

  async launchPersistentContext(opts: LaunchOptions): Promise<BrowserContextLike> {
    const { launchPersistentContext } = await loadCloakModule();
    const launchArgs: {
      userDataDir: string;
      headless?: boolean;
      proxy?: string;
      geoip?: boolean;
    } = { userDataDir: opts.userDataDir };
    if (typeof opts['headless'] === 'boolean') launchArgs.headless = opts['headless'];
    if (opts['proxy']) launchArgs.proxy = opts['proxy'] as string;
    if (opts['geoip']) launchArgs.geoip = opts['geoip'] as boolean;

    const context = await launchPersistentContext(launchArgs);
    return context as unknown as BrowserContextLike;
  }
}
