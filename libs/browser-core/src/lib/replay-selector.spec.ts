import {
  normalizeRecordedSteps,
  radixTriggerSuffix,
  replayClickSelector,
  stableRadixTriggerSelector,
} from './replay-selector';

describe('radixTriggerSuffix', () => {
  it('extracts suffix from Selenium-style radix ids', () => {
    expect(radixTriggerSuffix('radix-:r_b:-trigger-nft-details')).toBe('nft-details');
    expect(radixTriggerSuffix('radix-_r_a_-trigger-property-details')).toBe('property-details');
  });
});

describe('stableRadixTriggerSelector', () => {
  it('builds suffix attribute selectors', () => {
    expect(stableRadixTriggerSelector('button', 'property-details')).toBe(
      'button[id$="-trigger-property-details"]',
    );
    expect(stableRadixTriggerSelector('button', 'nft-details', 'tab')).toBe(
      '[role="tab"][id$="-trigger-nft-details"]',
    );
  });
});

describe('replayClickSelector', () => {
  it('maps unstable radix ids to suffix selectors', () => {
    expect(
      replayClickSelector({
        type: 'click',
        tag: 'button',
        text: 'NFT Details',
        href: null,
        selector: '#radix-_r_a_-trigger-nft-details',
        at: 't1',
      }),
    ).toBe('button[id$="-trigger-nft-details"]');
  });

  it('maps text= steps to suffix selectors from label slug', () => {
    expect(
      replayClickSelector({
        type: 'click',
        tag: 'button',
        text: 'Property Details',
        href: null,
        selector: 'text=Property Details',
        at: 't1',
      }),
    ).toBe('button[id$="-trigger-property-details"]');
  });

  it('keeps stable css selectors', () => {
    expect(
      replayClickSelector({
        type: 'click',
        tag: 'button',
        text: 'Go',
        href: null,
        selector: 'button.submit',
        at: 't1',
      }),
    ).toBe('button.submit');
  });
});

describe('normalizeRecordedSteps', () => {
  it('rewrites click steps in place', () => {
    const steps = normalizeRecordedSteps([
      {
        type: 'click',
        tag: 'button',
        text: 'Market',
        href: null,
        selector: '#radix-_r_b_-trigger-market',
        at: 't1',
      },
    ]);
    expect(steps[0].type === 'click' && steps[0].selector).toBe(
      'button[id$="-trigger-market"]',
    );
  });
});
