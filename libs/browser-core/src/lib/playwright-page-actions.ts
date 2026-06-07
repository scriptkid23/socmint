import type { Page } from 'playwright-core';
import { EXTRACT_DOM_SCRIPT } from './agent/dom-serializer';
import type { DomElement, PageActions } from './agent/types';
import {
  CLICK_BY_INDEX_FN,
  CLICK_BY_SELECTOR_FN,
  FILL_BY_SELECTOR_FN,
  RUN_SCRIPT_FN,
  SCROLL_FN,
  SELECTOR_EXISTS_FN,
  TYPE_BY_INDEX_FN,
} from './playwright-browser-scripts';

const SETTLE_TIMEOUT_MS = 8000;
/** Short probe for clicks — same-page clicks must not block for multi-second nav timeouts. */
const NAV_PROBE_MS = 400;
/** Enter/submit often starts navigation slightly later than a bare click. */
const NAV_PROBE_ENTER_MS = 1000;
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

/** Wait for DOM ready after a real navigation (skipped for same-page interactions). */
async function settleAfterNavigation(page: Page): Promise<void> {
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: SETTLE_TIMEOUT_MS });
  } catch {
    // page may already be loaded
  }
}

/**
 * Returns true when the click/keypress triggered navigation. Uses a short probe
 * so same-page clicks return in ~400ms instead of waiting the full nav timeout.
 */
async function probeNavigation(
  page: Page,
  urlBefore: string,
  probeMs: number,
): Promise<boolean> {
  const waiters: Array<Promise<boolean>> = [];
  if (typeof page.waitForNavigation === 'function') {
    waiters.push(
      page
        .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: probeMs })
        .then(() => true)
        .catch(() => false),
    );
  }
  if (typeof page.waitForURL === 'function') {
    waiters.push(
      page
        .waitForURL((u) => u.toString() !== urlBefore, { timeout: probeMs })
        .then(() => true)
        .catch(() => false),
    );
  }
  if (waiters.length === 0) {
    return page.url() !== urlBefore;
  }
  const probe = Promise.race(waiters);
  const raced = await Promise.race([
    probe,
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), probeMs)),
  ]);
  return raced || page.url() !== urlBefore;
}

async function afterInteraction(
  page: Page,
  urlBefore: string,
  probeMs = NAV_PROBE_MS,
): Promise<void> {
  if (await probeNavigation(page, urlBefore, probeMs)) {
    await settleAfterNavigation(page);
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
      await settleAfterNavigation(page);
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
      const urlBefore = page.url();
      await evaluateWithRetry(page, () => evaluateInPage(page, CLICK_BY_INDEX_FN, index));
      await afterInteraction(page, urlBefore);
    },
    async type(index: number, text: string) {
      await evaluateWithRetry(page, () => evaluateInPage(page, TYPE_BY_INDEX_FN, index, text));
    },
    async fill(selector: string, value: string) {
      await evaluateWithRetry(page, () => evaluateInPage(page, FILL_BY_SELECTOR_FN, selector, value));
    },
    async clickSelector(selector: string) {
      const urlBefore = page.url();
      await evaluateWithRetry(page, () => evaluateInPage(page, CLICK_BY_SELECTOR_FN, selector));
      await afterInteraction(page, urlBefore);
    },
    async pressEnter() {
      const urlBefore = page.url();
      await page.keyboard.press('Enter');
      await afterInteraction(page, urlBefore, NAV_PROBE_ENTER_MS);
    },
    async scroll(direction: 'up' | 'down') {
      await evaluateWithRetry(page, () => evaluateInPage(page, SCROLL_FN, direction));
    },
    async selectorExists(selector: string) {
      return evaluateWithRetry(page, async () => {
        const expr = `${SELECTOR_EXISTS_FN.trim()}(${JSON.stringify(selector)})`;
        return (await page.evaluate(expr)) as boolean;
      });
    },
    async runScript(code: string) {
      await evaluateWithRetry(page, () => evaluateInPage(page, RUN_SCRIPT_FN, code));
    },
    isClosed: () => page.isClosed(),
  };
}
