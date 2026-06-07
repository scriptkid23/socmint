import { describe, expect, it } from 'vitest';
import { normalizeRecordedSteps } from './replay-selector';

describe('normalizeRecordedSteps', () => {
  it('rewrites unstable radix click selectors to id suffix selectors', () => {
    const steps = normalizeRecordedSteps([
      {
        type: 'click',
        tag: 'button',
        text: 'Property Details',
        href: null,
        selector: '#radix-:r_b:-trigger-property-details',
        at: 't1',
      },
    ]);
    expect(steps[0].type === 'click' && steps[0].selector).toBe(
      'button[id$="-trigger-property-details"]',
    );
  });
});
