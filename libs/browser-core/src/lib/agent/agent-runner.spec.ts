import { isClickStuck, isTypeRedundant, runAgent } from './agent-runner';
import type { AgentLimits, AgentTask, DomElement, LlmClient, PageActions } from './types';

class FakePage implements PageActions {
  urlValue = 'https://example.com/';
  dom: DomElement[] = [{ index: 0, tag: 'button', role: 'button', text: 'Go', href: null }];
  clicks: number[] = [];
  isClosed?: () => boolean;

  async goto(url: string) {
    this.urlValue = url;
  }
  async title() {
    return 'Example';
  }
  url() {
    return this.urlValue;
  }
  async screenshot() {}
  async click(index: number) {
    this.clicks.push(index);
  }
  async type() {}
  async pressEnter() {}
  async scroll() {}
  async readDom() {
    return this.dom;
  }
}

function scriptedLlm(responses: string[]): LlmClient {
  let i = 0;
  return {
    async complete() {
      const content = responses[i++] ?? responses[responses.length - 1];
      return { content };
    },
  };
}

const task: AgentTask = {
  prompt: 'collect data',
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKey: 'sk-test',
};

const limits: AgentLimits = {
  maxSteps: 10,
  timeoutMs: 60_000,
  allowDomains: ['example.com'],
  readOnly: true,
};

describe('runAgent', () => {
  it('completes with structured result', async () => {
    const page = new FakePage();
    const llm = scriptedLlm([
      JSON.stringify({ thought: 'click', action: { type: 'click', index: 0 } }),
      JSON.stringify({
        thought: 'done',
        action: { type: 'finish', result: { posts: [{ id: 1 }] } },
        done: true,
      }),
    ]);

    const result = await runAgent(page, task, llm, limits);

    expect(result.status).toBe('completed');
    expect(result.stopReason).toBe('finished');
    expect(result.result).toEqual({ posts: [{ id: 1 }] });
    expect(page.clicks).toEqual([0]);
  });

  it('stops at maxSteps with partial result', async () => {
    const page = new FakePage();
    const llm = scriptedLlm([
      JSON.stringify({ thought: 'extract', action: { type: 'extract', data: { partial: true } } }),
    ]);

    const result = await runAgent(page, task, llm, { ...limits, maxSteps: 1 });

    expect(result.stopReason).toBe('max-steps');
    expect(result.result).toEqual({ partial: true });
  });

  it('blocks navigate to disallowed domain', async () => {
    const page = new FakePage();
    const llm = scriptedLlm([
      JSON.stringify({
        thought: 'go fb',
        action: { type: 'navigate', url: 'https://facebook.com/' },
      }),
      JSON.stringify({
        thought: 'done',
        action: { type: 'finish', result: {} },
        done: true,
      }),
    ]);

    const result = await runAgent(page, task, llm, limits);

    expect(result.transcript.some((t) => t.blocked)).toBe(true);
    expect(page.urlValue).toBe('https://example.com/');
  });

  it('stops with error on invalid LLM JSON', async () => {
    const page = new FakePage();
    const llm = scriptedLlm(['not-json']);

    const result = await runAgent(page, task, llm, limits);

    expect(result.stopReason).toBe('error');
    expect(result.status).toBe('failed');
  });

  it('skips type when the field already has the target value', async () => {
    const page = new FakePage();
    page.dom = [
      { index: 0, tag: 'input', role: 'searchbox', text: 'Search', href: null, value: 'cats' },
    ];
    const llm = scriptedLlm([
      JSON.stringify({ thought: 't', action: { type: 'type', index: 0, text: 'cats' } }),
      JSON.stringify({ thought: 'done', action: { type: 'finish', result: {} }, done: true }),
    ]);

    const result = await runAgent(page, task, llm, limits);

    expect(result.status).toBe('completed');
    expect(result.transcript[0]?.observation).toMatch(/Skipped type/i);
  });

  it('auto-submits with Enter when type is repeated 3 times', async () => {
    let presses = 0;
    const page = new FakePage();
    page.pressEnter = async () => {
      presses++;
    };
    const llm = scriptedLlm([
      JSON.stringify({ thought: 'x', action: { type: 'type', index: 0, text: 'hi' } }),
    ]);

    const result = await runAgent(page, task, llm, { ...limits, maxSteps: 4 });

    expect(presses).toBe(1);
    expect(result.transcript.some((t) => t.observation.includes('Auto-submitted'))).toBe(true);
  });

  it('auto-scrolls when click is repeated 3 times', async () => {
    let scrolls = 0;
    const page = new FakePage();
    page.scroll = async () => {
      scrolls++;
    };
    const llm = scriptedLlm([
      JSON.stringify({ thought: 'x', action: { type: 'click', index: 0 } }),
    ]);

    const result = await runAgent(page, task, llm, { ...limits, maxSteps: 4 });

    expect(scrolls).toBe(1);
    expect(result.transcript.some((t) => t.observation.includes('Auto-scrolled'))).toBe(true);
  });

  it('skips click when the same index had no effect on URL', async () => {
    const page = new FakePage();
    page.urlValue = 'https://example.com/search';
    const llm = scriptedLlm([
      JSON.stringify({ thought: 'c1', action: { type: 'click', index: 2 } }),
      JSON.stringify({ thought: 'c2', action: { type: 'click', index: 2 } }),
      JSON.stringify({ thought: 'done', action: { type: 'finish', result: {} }, done: true }),
    ]);

    const result = await runAgent(page, task, llm, limits);

    expect(result.status).toBe('completed');
    expect(result.transcript.some((t) => t.observation.includes('Skipped click'))).toBe(true);
    expect(page.clicks.filter((i) => i === 2).length).toBe(1);
  });

  it('stops when the model repeats the same navigate action 3 times', async () => {
    const page = new FakePage();
    const llm = scriptedLlm([
      JSON.stringify({
        thought: 'x',
        action: { type: 'navigate', url: 'https://example.com/page' },
      }),
    ]);

    const result = await runAgent(page, task, llm, limits);

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/repeated/i);
  });

  it('detects stuck click from URL', () => {
    expect(
      isClickStuck(
        { type: 'click', index: 3 },
        { index: 3, url: 'https://example.com/x' },
        'https://example.com/x',
      ),
    ).toBe(true);
    expect(
      isClickStuck(
        { type: 'click', index: 3 },
        { index: 3, url: 'https://example.com/x' },
        'https://example.com/y',
      ),
    ).toBe(false);
  });

  it('detects redundant type from DOM value', () => {
    const dom = [{ index: 0, tag: 'input', role: null, text: 'q', href: null, value: 'hello' }];
    expect(isTypeRedundant(dom, { type: 'type', index: 0, text: 'hello' })).toBe(true);
    expect(isTypeRedundant(dom, { type: 'type', index: 0, text: 'other' })).toBe(false);
  });

  it('stops when the browser page is closed', async () => {
    const page = new FakePage();
    page.isClosed = () => true;
    const llm = scriptedLlm([
      JSON.stringify({ thought: 'x', action: { type: 'click', index: 0 } }),
    ]);

    const result = await runAgent(page, task, llm, limits);

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/closed/i);
  });
});
