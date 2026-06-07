import { BrowserClosedError, sleepUntil, watchUserClosed } from './browser-user-close';

describe('watchUserClosed', () => {
  it('fires when the last page closes', () => {
    let closed = false;
    const pages: Array<{ on: (e: string, fn: () => void) => void }> = [];
    const page = {
      on: (_e: string, fn: () => void) => {
        pageClose = fn;
      },
    };
    let pageClose: () => void = () => undefined;
    pages.push(page);

    let pageHandler: (p: typeof page) => void = () => undefined;
    let closeHandler: () => void = () => undefined;

    const ctx = {
      pages: () => pages,
      newPage: async () => page,
      browser: () => ({}),
      on: (ev: string, fn: unknown) => {
        if (ev === 'close') closeHandler = fn as () => void;
        if (ev === 'page') pageHandler = fn as (p: typeof page) => void;
      },
    };

    watchUserClosed(ctx, () => {
      closed = true;
    });

    pages.length = 0;
    pageClose();
    expect(closed).toBe(true);
  });
});

describe('sleepUntil', () => {
  it('throws BrowserClosedError when aborted', async () => {
    await expect(
      sleepUntil(5000, () => true),
    ).rejects.toThrow(BrowserClosedError);
  });
});
