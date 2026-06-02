import type { AgentProvider, LlmClient, LlmCompleteOptions, LlmMessage } from './types';

export const AGENT_SYSTEM_PROMPT = `You are a browser automation agent. You receive the current URL and a list of indexed DOM elements.
Respond with ONLY valid JSON (no markdown outside a json code block if needed) matching:
{
  "thought": "brief reasoning",
  "action": { "type": "<action>", ...args },
  "done": false
}

Allowed action types:
- navigate: { "type": "navigate", "url": "https://..." }
- click: { "type": "click", "index": <number> }
- type: { "type": "type", "index": <number>, "text": "..." }
- pressEnter: { "type": "pressEnter" }
- scroll: { "type": "scroll", "direction": "up"|"down" }
- extract: { "type": "extract", "data": <any JSON> }
- finish: { "type": "finish", "result": <structured JSON matching the user task> }

When the task is complete, use finish with the collected structured result.
Do not invent element indices; only use indices from the DOM list.
When read-only mode is indicated, never navigate outside allowed domains and never submit posts or send messages.

IMPORTANT rules for typing and search:
- The DOM list shows the current value of each input/textarea as value="...". After a type action succeeds, that value will appear on the element on the next step.
- If an input/textarea already shows the text you intended to enter (check its value="..."), do NOT type it again. Move on (usually pressEnter to submit a search).
- To run a search: type the query into the search box once, then on the next step use pressEnter. Do not repeat the same type action.
- After submitting, read the results from the DOM and use extract/finish to return them. Never repeat an identical action more than twice.`;

export interface LlmClientConfig {
  provider: AgentProvider;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

export function createLlmClient(
  config: LlmClientConfig,
  fetchImpl: typeof fetch = globalThis.fetch,
): LlmClient {
  switch (config.provider) {
    case 'openai':
      return createOpenAiClient(config, fetchImpl);
    case 'anthropic':
      return createAnthropicClient(config, fetchImpl);
    case 'gemini':
      return createGeminiClient(config, fetchImpl);
    case 'ollama':
      return createOllamaClient(config, fetchImpl);
    default:
      throw new Error(`Unsupported LLM provider: ${config.provider}`);
  }
}

function createOpenAiClient(config: LlmClientConfig, fetchImpl: typeof fetch): LlmClient {
  return {
    async complete(messages: LlmMessage[], opts?: LlmCompleteOptions) {
      const res = await fetchImpl('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal: opts?.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          response_format: { type: 'json_object' },
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`OpenAI request failed (${res.status}): ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('OpenAI returned empty content');
      return { content };
    },
  };
}

function createAnthropicClient(config: LlmClientConfig, fetchImpl: typeof fetch): LlmClient {
  return {
    async complete(messages: LlmMessage[], opts?: LlmCompleteOptions) {
      const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
      const chatMessages = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

      const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: opts?.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: 4096,
          system: system || AGENT_SYSTEM_PROMPT,
          messages: chatMessages,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Anthropic request failed (${res.status}): ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };
      const text = data.content?.find((c) => c.type === 'text')?.text;
      if (!text) throw new Error('Anthropic returned empty content');
      return { content: text };
    },
  };
}

function normalizeOllamaBaseUrl(baseUrl: string | undefined): string {
  return (baseUrl?.trim() || 'http://127.0.0.1:11434').replace(/\/+$/, '');
}

function createOllamaClient(config: LlmClientConfig, fetchImpl: typeof fetch): LlmClient {
  const base = normalizeOllamaBaseUrl(config.baseUrl);
  return {
    async complete(messages: LlmMessage[], opts?: LlmCompleteOptions) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (config.apiKey?.trim()) {
        headers['Authorization'] = `Bearer ${config.apiKey.trim()}`;
      }
      const res = await fetchImpl(`${base}/api/chat`, {
        method: 'POST',
        signal: opts?.signal,
        headers,
        body: JSON.stringify({
          model: config.model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          stream: false,
          format: 'json',
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Ollama request failed (${res.status}): ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as { message?: { content?: string } };
      const content = data.message?.content;
      if (!content) throw new Error('Ollama returned empty content');
      return { content };
    },
  };
}

function createGeminiClient(config: LlmClientConfig, fetchImpl: typeof fetch): LlmClient {
  return {
    async complete(messages: LlmMessage[], opts?: LlmCompleteOptions) {
      const contents = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }));
      const systemInstruction = messages.find((m) => m.role === 'system')?.content ?? AGENT_SYSTEM_PROMPT;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;
      const res = await fetchImpl(url, {
        method: 'POST',
        signal: opts?.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents,
          generationConfig: { responseMimeType: 'application/json' },
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Gemini request failed (${res.status}): ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Gemini returned empty content');
      return { content: text };
    },
  };
}
