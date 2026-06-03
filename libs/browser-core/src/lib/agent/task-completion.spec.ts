import { countEffectiveActions, pageSignature } from './task-completion';
import type { AgentResult, DomElement } from './types';

const dom = (texts: string[]): DomElement[] =>
  texts.map((t, i) => ({ index: i, tag: 'div', role: null, text: t, href: null }));

describe('pageSignature', () => {
  it('is stable for identical url + dom', () => {
    const a = pageSignature('https://x.com/', dom(['a', 'b']));
    const b = pageSignature('https://x.com/', dom(['a', 'b']));
    expect(a).toBe(b);
  });

  it('changes when the url changes', () => {
    expect(pageSignature('https://x.com/', dom(['a']))).not.toBe(
      pageSignature('https://x.com/next', dom(['a'])),
    );
  });

  it('changes when new elements appear', () => {
    expect(pageSignature('https://x.com/', dom(['a']))).not.toBe(
      pageSignature('https://x.com/', dom(['a', 'b'])),
    );
  });
});

describe('countEffectiveActions', () => {
  it('counts only non-blocked page-changing actions', () => {
    const transcript: AgentResult['transcript'] = [
      { step: 1, thought: '', action: { type: 'click', index: 0 }, observation: '' },
      { step: 2, thought: '', action: { type: 'navigate', url: 'https://x' }, observation: '', blocked: true },
      { step: 3, thought: '', action: { type: 'extract', data: {} }, observation: '' },
      { step: 4, thought: '', action: { type: 'type', index: 1, text: 'hi' }, observation: '' },
    ];
    expect(countEffectiveActions(transcript)).toBe(2);
  });
});
