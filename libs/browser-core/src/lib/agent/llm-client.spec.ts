import { createLlmClient } from './llm-client';
import type { LlmMessage } from './types';

describe('createLlmClient', () => {
  const messages: LlmMessage[] = [{ role: 'user', content: 'hi' }];

  it('calls OpenAI chat completions', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"thought":"x","action":{"type":"finish","result":{}}}' } }],
      }),
    });
    const client = createLlmClient(
      { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test' },
      fetchMock as unknown as typeof fetch,
    );
    const res = await client.complete(messages);
    expect(res.content).toContain('finish');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('calls Anthropic messages API', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: '{"thought":"x","action":{"type":"finish","result":{}}}' }],
      }),
    });
    const client = createLlmClient(
      { provider: 'anthropic', model: 'claude-3-5-haiku-20241022', apiKey: 'sk-ant-test' },
      fetchMock as unknown as typeof fetch,
    );
    const res = await client.complete(messages);
    expect(res.content).toContain('finish');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('calls Gemini generateContent', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '{"thought":"x","action":{"type":"finish","result":{}}}' }] } }],
      }),
    });
    const client = createLlmClient(
      { provider: 'gemini', model: 'gemini-2.0-flash', apiKey: 'gem-key' },
      fetchMock as unknown as typeof fetch,
    );
    const res = await client.complete(messages);
    expect(res.content).toContain('finish');
    expect(fetchMock.mock.calls[0][0]).toContain('generativelanguage.googleapis.com');
  });

  it('calls Ollama local chat API', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { content: '{"thought":"x","action":{"type":"finish","result":{}}}' },
      }),
    });
    const client = createLlmClient(
      {
        provider: 'ollama',
        model: 'llama3.2',
        apiKey: '',
        baseUrl: 'http://127.0.0.1:11434',
      },
      fetchMock as unknown as typeof fetch,
    );
    const res = await client.complete(messages);
    expect(res.content).toContain('finish');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/chat',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"format":"json"'),
      }),
    );
  });

  it('throws on unsupported provider', () => {
    expect(() =>
      createLlmClient({ provider: 'unknown' as 'openai', model: 'x', apiKey: 'k' }),
    ).toThrow(/Unsupported/);
  });
});
