import {
  evaluateWithRetry,
  isContextDestroyed,
  wrapPlaywrightPage,
} from './playwright-page-actions';

describe('isContextDestroyed', () => {
  it('detects navigation teardown errors', () => {
    expect(
      isContextDestroyed(new Error('page.evaluate: Execution context was destroyed')),
    ).toBe(true);
    expect(isContextDestroyed(new Error('frame was detached'))).toBe(true);
  });
});

describe('evaluateWithRetry', () => {
  it('retries after execution context destroyed', async () => {
    const page = {
      waitForLoadState: jest.fn().mockResolvedValue(undefined),
    } as unknown as import('playwright-core').Page;
    let calls = 0;
    const result = await evaluateWithRetry(page, async () => {
      calls++;
      if (calls === 1) {
        throw new Error('Execution context was destroyed, most likely because of a navigation');
      }
      return ['ok'];
    });
    expect(result).toEqual(['ok']);
    expect(calls).toBe(2);
    expect(page.waitForLoadState).toHaveBeenCalled();
  });

  it('rethrows non-navigation errors immediately', async () => {
    const page = { waitForLoadState: jest.fn() } as unknown as import('playwright-core').Page;
    await expect(
      evaluateWithRetry(page, async () => {
        throw new Error('No element at index 99');
      }),
    ).rejects.toThrow('No element at index 99');
    expect(page.waitForLoadState).not.toHaveBeenCalled();
  });
});

describe('wrapPlaywrightPage', () => {
  it('does not wait for long navigation timeout on same-page clicks', async () => {
    jest.useFakeTimers();
    try {
      const page = {
        evaluate: jest.fn().mockResolvedValue(undefined),
        url: jest.fn().mockReturnValue('https://example.com'),
        waitForNavigation: jest.fn().mockImplementation(
          () => new Promise((_resolve, reject) => setTimeout(() => reject(new Error('timeout')), 10_000)),
        ),
        waitForURL: jest.fn().mockRejectedValue(new Error('timeout')),
        waitForLoadState: jest.fn().mockResolvedValue(undefined),
        isClosed: () => false,
      };
      const actions = wrapPlaywrightPage(page);
      const clickPromise = actions.click(0);
      await jest.advanceTimersByTimeAsync(500);
      await clickPromise;
      expect(page.waitForLoadState).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('clickSelector resolves via evaluateHandle then uses ElementHandle.click', async () => {
    const elementClick = jest.fn().mockResolvedValue(undefined);
    const page = {
      evaluateHandle: jest.fn().mockResolvedValue({ asElement: () => ({ click: elementClick }) }),
      url: jest.fn().mockReturnValue('https://example.com'),
      waitForNavigation: jest.fn().mockRejectedValue(new Error('timeout')),
      waitForURL: jest.fn().mockRejectedValue(new Error('timeout')),
      waitForLoadState: jest.fn().mockResolvedValue(undefined),
      isClosed: () => false,
    };
    const actions = wrapPlaywrightPage(page);
    await actions.clickSelector('button[id$="-trigger-nft-details"]');
    expect(page.evaluateHandle).toHaveBeenCalled();
    expect(elementClick).toHaveBeenCalledWith({ timeout: 5000 });
  });

  it('retries readDom when evaluate fails due to navigation', async () => {
    let evaluateCalls = 0;
    const page = {
      evaluate: jest.fn().mockImplementation(async () => {
        evaluateCalls++;
        if (evaluateCalls === 1) {
          throw new Error('Execution context was destroyed');
        }
        return [{ index: 0, tag: 'a', role: null, text: 'Home', href: '/', value: null }];
      }),
      waitForLoadState: jest.fn().mockResolvedValue(undefined),
      waitForNavigation: jest.fn().mockRejectedValue(new Error('timeout')),
      url: () => 'https://example.com',
      isClosed: () => false,
    };
    const actions = wrapPlaywrightPage(page);
    const dom = await actions.readDom();
    expect(dom).toHaveLength(1);
    expect(evaluateCalls).toBe(2);
  });
});
