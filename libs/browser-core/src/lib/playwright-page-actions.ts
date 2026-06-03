import type { Page } from 'playwright-core';
import { EXTRACT_DOM_SCRIPT } from './agent/dom-serializer';
import type { DomElement, PageActions } from './agent/types';
import { CLICK_BY_INDEX_FN, SCROLL_FN, TYPE_BY_INDEX_FN } from './playwright-browser-scripts';

const SETTLE_TIMEOUT_MS = 15000;
const NAV_WAIT_MS = 8000;
const EVALUATE_MAX_ATTEMPTS = 3;

function evaluateInPage(
  page: Page,
  fnSource: string,
  ...args: Array<number | string>
): Promise<void> {
  const expr = `${fnSource.trim()}(${args.map((a) => JSON.stringify(a)).join(', ')})`;
  return page.evaluate(expr) as Promise<void>;
}

export function isPageActions(page: unknown): page is PageActions {
  const p = page as PageActions;
  return typeof p?.readDom === 'function' && typeof p?.click === 'function';
}

export function asPageActions(raw: unknown): PageActions {
  if (isPageActions(raw)) return raw;
  return wrapPlaywrightPage(raw);
}

export function isContextDestroyed(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /Execution context was destroyed|context or browser has been closed|frame was detached/i.test(
    msg,
  );
}

/** Let any in-flight navigation settle so the next page.evaluate has a live context. */
async function settle(page: Page): Promise<void> {
  for (const state of ['domcontentloaded', 'load'] as const) {
    try {
      await page.waitForLoadState(state, { timeout: SETTLE_TIMEOUT_MS });
    } catch {
      // page may already be at this state or navigation may have been aborted
    }
  }
}

async function waitForPossibleNavigation(page: Page): Promise<void> {
  try {
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: NAV_WAIT_MS });
  } catch {
    // no navigation (e.g. click on a button that stays on the same page)
  }
}

/** Retry evaluate when a navigation destroys the execution context mid-call. */
export async function evaluateWithRetry<T>(
  page: Page,
  fn: () => Promise<T>,
  maxAttempts = EVALUATE_MAX_ATTEMPTS,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isContextDestroyed(err) || attempt >= maxAttempts - 1) throw err;
      await settle(page);
    }
  }
  throw lastErr;
}

export function wrapPlaywrightPage(raw: unknown): PageActions {
  const page = raw as Page;

  return {
    goto(url, opts) {
      return page.goto(url, {
        waitUntil: (opts.waitUntil ?? 'domcontentloaded') as 'load' | 'domcontentloaded' | 'commit',
        timeout: opts.timeout ?? 60000,
      });
    },
    title: () => page.title(),
    url: () => page.url(),
    screenshot: (opts) => page.screenshot({ path: opts.path, fullPage: opts.fullPage }),
    async readDom(): Promise<DomElement[]> {
      return evaluateWithRetry(page, async () => {
        return (await page.evaluate(EXTRACT_DOM_SCRIPT)) as DomElement[];
      });
    },
    async click(index: number) {
      await evaluateWithRetry(page, () => evaluateInPage(page, CLICK_BY_INDEX_FN, index));
      await waitForPossibleNavigation(page);
      await settle(page);
    },
    async type(index: number, text: string) {
      await evaluateWithRetry(page, () => evaluateInPage(page, TYPE_BY_INDEX_FN, index, text));
    },
    async pressEnter() {
      await page.keyboard.press('Enter');
      await waitForPossibleNavigation(page);
      await settle(page);
    },
    async scroll(direction: 'up' | 'down') {
      await evaluateWithRetry(page, () => evaluateInPage(page, SCROLL_FN, direction));
    },
    isClosed: () => page.isClosed(),
  };
}
