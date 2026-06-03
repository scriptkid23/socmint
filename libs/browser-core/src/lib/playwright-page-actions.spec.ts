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
