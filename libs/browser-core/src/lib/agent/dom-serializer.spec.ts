import { formatDomForPrompt, parseAgentDecision } from './dom-serializer';

describe('formatDomForPrompt', () => {
  it('formats indexed elements for the LLM', () => {
    const text = formatDomForPrompt([
      { index: 0, tag: 'button', role: 'button', text: 'Search', href: null },
      { index: 1, tag: 'a', role: 'link', text: 'Jane', href: 'https://fb.com/jane' },
    ]);
    expect(text).toContain('[0]');
    expect(text).toContain('Search');
    expect(text).toContain('[1]');
  });

  it('shows the current value of input/textarea elements', () => {
    const text = formatDomForPrompt([
      { index: 0, tag: 'textarea', role: 'combobox', text: 'Search', href: null, value: 'pho hanoi' },
    ]);
    expect(text).toContain('value="pho hanoi"');
  });
});

describe('parseAgentDecision', () => {
  it('parses JSON from a fenced code block', () => {
    const raw = '```json\n{"thought":"go","action":{"type":"click","index":0}}\n```';
    const d = parseAgentDecision(raw);
    expect(d.action.type).toBe('click');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseAgentDecision('not json')).toThrow();
  });
});
