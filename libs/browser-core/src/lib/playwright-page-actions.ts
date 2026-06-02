import type { Page } from 'playwright-core';
import { EXTRACT_DOM_SCRIPT } from './agent/dom-serializer';
import type { DomElement, PageActions } from './agent/types';
import {
  CLICK_BY_INDEX_FN,
  FOCUS_INPUT_BY_INDEX_FN,
  SCROLL_FN,
} from './playwright-browser-scripts';

function evaluateInPage(page: Page, fnSource: string, arg: number | string): Promise<void> {
  // fnSource is a parenthesized function expression; invoke it with the arg.
  const expr = `${fnSource.trim()}(${JSON.stringify(arg)})`;
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

function isContextDestroyed(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /Execution context was destroyed|context or browser has been closed|frame was detached/i.test(
    msg,
  );
}

/** Let any in-flight navigation settle so the next page.evaluate has a live context. */
async function settle(page: Page): Promise<void> {
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
  } catch {
    // ignore: page may already be loaded or have no pending navigation
  }
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
      try {
        return (await page.evaluate(EXTRACT_DOM_SCRIPT)) as DomElement[];
      } catch (err) {
        // A navigation (e.g. after pressEnter) can destroy the execution
        // context mid-evaluate. Wait for the new document, then retry once.
        if (!isContextDestroyed(err)) throw err;
        await settle(page);
        return (await page.evaluate(EXTRACT_DOM_SCRIPT)) as DomElement[];
      }
    },
    async click(index: number) {
      await evaluateInPage(page, CLICK_BY_INDEX_FN, index);
      await settle(page);
    },
    async type(index: number, text: string) {
      await evaluateInPage(page, FOCUS_INPUT_BY_INDEX_FN, index);
      await page.keyboard.type(text);
    },
    async pressEnter() {
      await page.keyboard.press('Enter');
      await settle(page);
    },
    async scroll(direction: 'up' | 'down') {
      await evaluateInPage(page, SCROLL_FN, direction);
    },
    isClosed: () => page.isClosed(),
  };
}
