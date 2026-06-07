import type { BrowserContextLike } from './types';

export class BrowserClosedError extends Error {
  constructor(message = 'Browser window was closed') {
    super(message);
    this.name = 'BrowserClosedError';
  }
}

function once(fn: () => void): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    fn();
  };
}

/** Fires when the operator closes the last browser tab/window or the context closes. */
export function watchUserClosed(context: unknown, onClosed: () => void): () => void {
  const fire = once(onClosed);
  const ctxLike = context as BrowserContextLike;
  ctxLike.on('close', fire);

  const pw = context as import('playwright-core').BrowserContext;
  if (typeof pw?.on !== 'function' || typeof pw?.pages !== 'function') {
    return () => undefined;
  }

  const attach = (page: import('playwright-core').Page) => {
    if (!page || typeof page.on !== 'function') return;
    page.on('close', () => {
      try {
        // Closing the window closes every tab; once none remain the run is over.
        if (pw.pages().length === 0) fire();
      } catch {
        fire();
      }
    });
  };

  try {
    for (const page of pw.pages()) attach(page);
    pw.on('page', attach);
  } catch {
    // non-Playwright context; the context 'close' listener above still applies
  }
  return () => undefined;
}

export async function sleepUntil(ms: number, isAborted: () => boolean): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (isAborted()) throw new BrowserClosedError();
    await new Promise((resolve) => setTimeout(resolve, Math.min(200, end - Date.now())));
  }
}

export function throwIfAborted(isAborted: () => boolean): void {
  if (isAborted()) throw new BrowserClosedError();
}
