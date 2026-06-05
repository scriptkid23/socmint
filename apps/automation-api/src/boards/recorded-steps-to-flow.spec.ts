import { compileRecordedSteps } from './recorded-steps-to-flow';
import { BoardGraphError } from './board.errors';

describe('compileRecordedSteps', () => {
  it('compiles navigate, click, type, scroll', () => {
    expect(
      compileRecordedSteps([
        { type: 'navigate', url: 'https://example.com', at: 't1' },
        { type: 'click', tag: 'button', text: 'Go', href: null, selector: 'button.go', at: 't2' },
        { type: 'type', tag: 'input', text: 'qty', selector: '#qty', value: '10', at: 't3' },
        { type: 'scroll', direction: 'down', at: 't4' },
      ]),
    ).toEqual([
      { type: 'goto', url: 'https://example.com' },
      { type: 'wait', ms: 300 },
      { type: 'click', selector: 'button.go' },
      { type: 'wait', ms: 150 },
      { type: 'fill', selector: '#qty', value: '10' },
      { type: 'wait', ms: 150 },
      { type: 'scroll', direction: 'down' },
    ]);
  });

  it('skips about: navigates', () => {
    expect(compileRecordedSteps([{ type: 'navigate', url: 'about:blank', at: 't1' }])).toEqual([]);
  });

  it('allows an empty value on a type step (clears the field)', () => {
    expect(
      compileRecordedSteps([
        { type: 'type', tag: 'input', text: '', selector: '#q', value: '', at: 't1' },
      ]),
    ).toEqual([
      { type: 'fill', selector: '#q', value: '' },
      { type: 'wait', ms: 150 },
    ]);
  });

  it('throws when a click step has an empty selector', () => {
    expect(() =>
      compileRecordedSteps([
        { type: 'click', tag: 'a', text: '', href: null, selector: '  ', at: 't1' },
      ]),
    ).toThrow(BoardGraphError);
  });

  it('throws when a type step has an empty selector', () => {
    expect(() =>
      compileRecordedSteps([{ type: 'type', tag: 'input', text: '', selector: '', value: 'x', at: 't1' }]),
    ).toThrow(BoardGraphError);
  });
});
