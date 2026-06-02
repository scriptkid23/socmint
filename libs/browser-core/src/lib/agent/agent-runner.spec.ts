import { runAgent } from './agent-runner';
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

  it('stops when the model repeats the same action 3 times', async () => {
    const page = new FakePage();
    const llm = scriptedLlm([
      JSON.stringify({ thought: 'x', action: { type: 'type', index: 0, text: 'hi' } }),
    ]);

    const result = await runAgent(page, task, llm, limits);

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/repeated/i);
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
