# AI Agent Browser Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an **AI Agent** node to the Automation flow board that runs a DOM-based LLM agent loop on the profile's logged-in browser session and returns structured JSON.

**Architecture:** Extend the existing board → `resolveChains` → `executeFlow` → `runFlow` pipeline with a new `agent` step type. The agent loop lives in `libs/browser-core/src/lib/agent/` behind `PageActions` and `LlmClient` seams. `runFlow` invokes `AgentRunner` on the same page as prior Goto steps. API keys are stored in the board graph (local disk) but redacted from artifacts, transcripts, and audit logs.

**Tech Stack:** Nx monorepo. NestJS 11 + Jest (`automation-api`). `libs/browser-core` (CloakBrowser/Playwright seam). React 19 + `@xyflow/react` + Vitest (`web`). LLM calls via Node `fetch` (no new SDK deps in v1).

Spec: `docs/superpowers/specs/2026-06-02-ai-agent-browser-node-design.md`.

---

## File Structure

**`libs/browser-core/src/lib/agent/` (new)**
- `types.ts` — `PageActions`, `LlmClient`, `AgentLimits`, `AgentAction`, `AgentResult`, messages
- `dom-serializer.ts` — pure format helpers + browser-side extract script string
- `dom-serializer.spec.ts`
- `llm-client.ts` — `createLlmClient({ provider, model, apiKey })` + OpenAI/Anthropic/Gemini fetch adapters
- `llm-client.spec.ts`
- `agent-runner.ts` — observe→decide→act loop, guardrails, read-only enforcement
- `agent-runner.spec.ts`
- `redact.ts` — `redactSecrets(obj)` for transcripts

**`libs/browser-core/src/lib/` (modify)**
- `types.ts` — extend `PageLike` → `PageActions`; add `ResolvedFlowStep`/`FlowStepResult` agent variants
- `playwright-page-actions.ts` (new) — wrap real Playwright `Page` as `PageActions`
- `cloak-browser.service.ts` — `runFlow` handles `agent` step; wrap page with `wrapPlaywrightPage`
- `cloak-browser.service.spec.ts` — agent step with mocked `AgentRunner` or fake page+fake llm injection
- `index.ts` — export agent public API

**`apps/automation-api/src/boards/`**
- `board.types.ts` — `AgentNodeData`, `BoardNode` `agent` variant
- `resolve-chains.ts` — map `agent` node → `FlowStep`; derive `allowDomains` from goto URLs in chain
- `resolve-chains.spec.ts`

**`apps/automation-api/src/runs/`**
- `run.types.ts` — `FlowStep` + `FlowStepRecord` agent variants
- `run.service.ts` — resolve agent steps; map `AgentFlowStepResult` to records (no apiKey); write transcript
- `run.service.spec.ts`
- `audit.logger.ts` (modify if needed) — ensure agent audit lines never include apiKey

**`apps/automation-api/src/e2e/`**
- `agent-run.e2e.spec.ts` (new, gated `RUN_E2E=1`)

**`apps/web/src/`**
- `api/client.ts` — `AgentNodeData`, board node union, `FlowStepRecord` agent fields
- `components/automation/nodes/agent-node.tsx` (new)
- `components/automation/flow-canvas.tsx` — register node, palette, strip/inject, results JSON
- `components/automation/graph-validation.ts` + spec

---

## Task 1: Agent types and DOM serializer

**Files:**
- Create: `libs/browser-core/src/lib/agent/types.ts`
- Create: `libs/browser-core/src/lib/agent/dom-serializer.ts`
- Test: `libs/browser-core/src/lib/agent/dom-serializer.spec.ts`

- [ ] **Step 1: Write `agent/types.ts`**

```ts
export type AgentProvider = 'openai' | 'anthropic' | 'gemini';

export type AgentActionType =
  | 'navigate'
  | 'click'
  | 'type'
  | 'pressEnter'
  | 'scroll'
  | 'extract'
  | 'finish';

export interface AgentAction {
  type: AgentActionType;
  url?: string;
  index?: number;
  text?: string;
  direction?: 'up' | 'down';
  data?: unknown;
  result?: unknown;
}

export interface AgentDecision {
  thought: string;
  action: AgentAction;
  done?: boolean;
}

export interface AgentLimits {
  maxSteps: number;
  timeoutMs: number;
  allowDomains: string[];
  readOnly: boolean;
}

export interface AgentTask {
  prompt: string;
  provider: AgentProvider;
  model: string;
  apiKey: string;
}

export type AgentStopReason = 'finished' | 'max-steps' | 'timeout' | 'error';

export interface AgentResult {
  status: 'completed' | 'failed';
  stopReason: AgentStopReason;
  stepsUsed: number;
  error: string | null;
  result: unknown | null;
  transcript: Array<{ step: number; thought: string; action: AgentAction; observation: string; blocked?: boolean }>;
}

export interface DomElement {
  index: number;
  tag: string;
  role: string | null;
  text: string;
  href: string | null;
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmClient {
  complete(messages: LlmMessage[]): Promise<{ content: string }>;
}

/** Browser page surface for the agent (extends PageLike). */
export interface PageActions {
  goto(url: string, opts: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  title(): Promise<string>;
  url(): string;
  screenshot(opts: { path: string; fullPage: boolean }): Promise<unknown>;
  click(index: number): Promise<void>;
  type(index: number, text: string): Promise<void>;
  pressEnter(): Promise<void>;
  scroll(direction: 'up' | 'down'): Promise<void>;
  readDom(): Promise<DomElement[]>;
}
```

- [ ] **Step 2: Write failing dom-serializer tests**

`libs/browser-core/src/lib/agent/dom-serializer.spec.ts`:

```ts
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm exec nx test browser-core -- dom-serializer`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `dom-serializer.ts`**

```ts
import type { AgentDecision, DomElement } from './types';

export function formatDomForPrompt(elements: DomElement[]): string {
  if (elements.length === 0) return '(no interactive elements found)';
  return elements
    .map((el) => {
      const href = el.href ? ` href="${el.href}"` : '';
      const role = el.role ? ` role="${el.role}"` : '';
      return `[${el.index}] <${el.tag}${role}${href}> "${el.text.slice(0, 120)}"`;
    })
    .join('\n');
}

/** Script executed inside the browser via page.evaluate. */
export const EXTRACT_DOM_SCRIPT = `(() => {
  const MAX = 80;
  const seen = new Set();
  const out = [];
  const nodes = document.querySelectorAll(
    'a, button, input, textarea, select, [role="button"], [role="link"]'
  );
  for (const el of nodes) {
    if (out.length >= MAX) break;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    const text = (el.innerText || el.getAttribute('aria-label') || '').trim();
    if (!text && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') continue;
    const key = el.tagName + text;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      index: out.length,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
      text: text.slice(0, 200),
      href: el.tagName === 'A' ? el.href : null,
    });
  }
  return out;
})()`;

export function parseAgentDecision(raw: string): AgentDecision {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fence ? fence[1].trim() : trimmed;
  const parsed = JSON.parse(jsonText) as AgentDecision;
  if (!parsed?.action?.type) throw new Error('LLM response missing action.type');
  return parsed;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec nx test browser-core -- dom-serializer`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libs/browser-core/src/lib/agent/types.ts libs/browser-core/src/lib/agent/dom-serializer.ts libs/browser-core/src/lib/agent/dom-serializer.spec.ts
git commit -m "feat(browser-core): add agent types and DOM serializer"
```

---

## Task 2: LLM client (fetch-based, provider factory)

**Files:**
- Create: `libs/browser-core/src/lib/agent/llm-client.ts`
- Test: `libs/browser-core/src/lib/agent/llm-client.spec.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { createLlmClient } from './llm-client';
import type { LlmMessage } from './types';

describe('createLlmClient', () => {
  const messages: LlmMessage[] = [{ role: 'user', content: 'hi' }];

  it('calls OpenAI chat completions', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"thought":"x","action":{"type":"finish","result":{}}}' } }] }),
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

  it('throws on unsupported provider', () => {
    expect(() =>
      createLlmClient({ provider: 'unknown' as 'openai', model: 'x', apiKey: 'k' }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec nx test browser-core -- llm-client`
Expected: FAIL.

- [ ] **Step 3: Implement `llm-client.ts`**

Implement `createLlmClient(config, fetchImpl = globalThis.fetch)` with:
- **openai:** `POST https://api.openai.com/v1/chat/completions`, body `{ model, messages, response_format: { type: 'json_object' } }`, header `Authorization: Bearer ${apiKey}`.
- **anthropic:** `POST https://api.anthropic.com/v1/messages`, header `x-api-key`, `anthropic-version: 2023-06-01`, map roles (system separate).
- **gemini:** `POST https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`.

Shared system prompt (constant `AGENT_SYSTEM_PROMPT`) instructs: output ONLY JSON matching `{ thought, action: { type, ... }, done?, result? }`, allowed action types, read-only rules when applicable.

On non-OK response, throw `Error` with status text (never include apiKey in message).

- [ ] **Step 4: Run tests — add Anthropic/Gemini smoke tests with same fetch mock pattern**

Run: `pnpm exec nx test browser-core -- llm-client`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/browser-core/src/lib/agent/llm-client.ts libs/browser-core/src/lib/agent/llm-client.spec.ts
git commit -m "feat(browser-core): add fetch-based LLM client factory"
```

---

## Task 3: AgentRunner loop

**Files:**
- Create: `libs/browser-core/src/lib/agent/agent-runner.ts`
- Create: `libs/browser-core/src/lib/agent/redact.ts`
- Test: `libs/browser-core/src/lib/agent/agent-runner.spec.ts`

- [ ] **Step 1: Write failing tests with fake page + fake LLM**

Use a `FakePageActions` class implementing `PageActions` with in-memory DOM array and URL. Script fake `LlmClient` to return sequence:
1. `{ action: { type: 'click', index: 0 } }`
2. `{ action: { type: 'extract', data: { posts: [] } } }`
3. `{ action: { type: 'finish', result: { posts: [{ id: 1 }] } }, done: true }`

Test cases:
- `completes with structured result and stopReason finished`
- `stops at maxSteps with partial result`
- `blocks navigate to disallowed domain when readOnly/allowlist`
- `blocks destructive action type submit when readOnly` (define `submit` as blocked alias or refuse `type` into `[contenteditable]` post composer — v1: refuse action types `submit`, `delete`, `send` if model emits them; document in runner)
- `parse error increments step and eventually stops with error`

- [ ] **Step 2: Run tests — verify fail**

Run: `pnpm exec nx test browser-core -- agent-runner`
Expected: FAIL.

- [ ] **Step 3: Implement `agent-runner.ts`**

```ts
export async function runAgent(
  page: PageActions,
  task: AgentTask,
  llm: LlmClient,
  limits: AgentLimits,
): Promise<AgentResult> {
  const started = Date.now();
  const transcript: AgentResult['transcript'] = [];
  let stepsUsed = 0;
  let collected: unknown = null;
  const llmClient = llm; // task.apiKey only used when creating llm outside

  while (stepsUsed < limits.maxSteps) {
    if (Date.now() - started > limits.timeoutMs) {
      return finish('timeout', stepsUsed, collected, transcript, null);
    }
    stepsUsed++;
    const dom = await page.readDom();
    const observation = formatDomForPrompt(dom);
    const messages = buildMessages(task.prompt, page.url(), observation, limits);
    let decision: AgentDecision;
    try {
      const { content } = await llmClient.complete(messages);
      decision = parseAgentDecision(content);
    } catch (e) {
      return finish('error', stepsUsed, collected, transcript, e);
    }
    const blocked = isBlockedAction(decision.action, limits);
    if (blocked) {
      transcript.push({ step: stepsUsed, thought: decision.thought, action: decision.action, observation, blocked: true });
      continue;
    }
    try {
      await executeAction(page, decision.action, limits);
      if (decision.action.type === 'extract') collected = decision.action.data ?? collected;
      if (decision.action.type === 'finish' || decision.done) {
        const result = decision.action.result ?? decision.action.type === 'finish' ? decision.action.result : collected;
        return finish('finished', stepsUsed, result ?? collected, transcript, null);
      }
    } catch (e) {
      return finish('error', stepsUsed, collected, transcript, e);
    }
    transcript.push({ step: stepsUsed, thought: decision.thought, action: decision.action, observation });
  }
  return finish('max-steps', stepsUsed, collected, transcript, null);
}
```

Implement helpers: `isBlockedAction` (readOnly + domain check on navigate), `executeAction`, `buildMessages`, `finish` (sets status: completed if result non-null else failed).

`redact.ts`: `export function redactAgentConfig<T extends { apiKey?: string }>(o: T): Omit<T, 'apiKey'> & { apiKey?: never }` — strip key for persisted transcripts.

- [ ] **Step 4: Run tests — verify pass**

Run: `pnpm exec nx test browser-core -- agent-runner`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/browser-core/src/lib/agent/agent-runner.ts libs/browser-core/src/lib/agent/redact.ts libs/browser-core/src/lib/agent/agent-runner.spec.ts
git commit -m "feat(browser-core): add AgentRunner observe-decide-act loop"
```

---

## Task 4: Playwright PageActions adapter

**Files:**
- Create: `libs/browser-core/src/lib/playwright-page-actions.ts`
- Modify: `libs/browser-core/src/lib/types.ts` — re-export or extend `PageLike` to include optional agent methods OR document that `PageLike` is deprecated for agent path in favor of `PageActions`

- [ ] **Step 1: Implement `wrapPlaywrightPage(page: unknown): PageActions`**

Use `playwright-core` types. Map:
- `readDom()` → `page.evaluate(EXTRACT_DOM_SCRIPT)` returning `DomElement[]`
- `click(index)` → evaluate click by index into last readDom snapshot (store snapshot on page object in closure)
- `type(index, text)` → focus element by index, `page.keyboard.type(text)`
- `pressEnter()` → `page.keyboard.press('Enter')`
- `scroll` → `page.evaluate((dir) => window.scrollBy(0, dir === 'down' ? 600 : -600), direction)`

Keep a `let snapshot: DomElement[]` updated on each `readDom()`; clicks/types target `snapshot[index]`.

- [ ] **Step 2: Typecheck**

Run: `pnpm exec nx run browser-core:build` (or `pnpm exec tsc -p libs/browser-core/tsconfig.lib.json --noEmit`)
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add libs/browser-core/src/lib/playwright-page-actions.ts
git commit -m "feat(browser-core): add Playwright PageActions adapter"
```

---

## Task 5: Integrate agent step into `runFlow`

**Files:**
- Modify: `libs/browser-core/src/lib/types.ts`
- Modify: `libs/browser-core/src/lib/cloak-browser.service.ts`
- Modify: `libs/browser-core/src/lib/cloak-browser.service.spec.ts`
- Modify: `libs/browser-core/src/index.ts`

- [ ] **Step 1: Extend flow types**

In `types.ts`, add to unions:

```ts
export type ResolvedFlowStep =
  | { type: 'goto'; url: string; waitUntil?: WaitUntil; timeoutMs?: number }
  | { type: 'wait'; ms: number }
  | { type: 'agent'; task: AgentTask; limits: AgentLimits; transcriptPath?: string }
  | { type: 'screenshot'; screenshotPath: string };

export interface AgentFlowStepResult {
  type: 'agent';
  status: 'completed' | 'failed';
  error: string | null;
  stepsUsed: number;
  stopReason: AgentStopReason;
  result: unknown | null;
  transcriptPath?: string | null;
}

export type FlowStepResult =
  | /* existing goto/wait/screenshot */
  | AgentFlowStepResult;
```

Import agent types from `./agent/types` (or re-export from agent module).

- [ ] **Step 2: Write failing test for agent step in runFlow**

In `cloak-browser.service.spec.ts`, add test with fake launcher returning context whose page is `FakePageActions` + inject fake LLM by passing a step that uses a **test-only** code path OR mock `createLlmClient` via dependency injection.

**Simpler approach for testability:** add optional 3rd param to `runFlow`:

```ts
async runFlow(
  launch: LaunchOptions,
  steps: ResolvedFlowStep[],
  deps?: { createLlm?: typeof createLlmClient },
): Promise<FlowStepResult[]>
```

Test passes `deps.createLlm` returning scripted client; one agent step finishes immediately.

- [ ] **Step 3: Implement agent branch in `runFlow`**

```ts
} else if (step.type === 'agent') {
  const pageActions = wrapPlaywrightPage(page);
  const llm = (deps?.createLlm ?? createLlmClient)({
    provider: step.task.provider,
    model: step.task.model,
    apiKey: step.task.apiKey,
  });
  const agentResult = await runAgent(pageActions, step.task, llm, step.limits);
  if (step.transcriptPath) {
    await writeFile(step.transcriptPath, JSON.stringify(redactTranscript(agentResult.transcript), null, 2));
  }
  results.push({
    type: 'agent',
    status: agentResult.status,
    error: agentResult.error,
    stepsUsed: agentResult.stepsUsed,
    stopReason: agentResult.stopReason,
    result: agentResult.result,
    transcriptPath: step.transcriptPath ?? null,
  });
}
```

Import `writeFile` from `fs/promises`, `runAgent`, `createLlmClient`, `wrapPlaywrightPage`.

- [ ] **Step 4: Export from `index.ts`**

```ts
export * from './lib/agent/types';
export { runAgent } from './lib/agent/agent-runner';
export { createLlmClient } from './lib/agent/llm-client';
```

- [ ] **Step 5: Run tests**

Run: `pnpm exec nx test browser-core`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libs/browser-core/src/lib/types.ts libs/browser-core/src/lib/cloak-browser.service.ts libs/browser-core/src/lib/cloak-browser.service.spec.ts libs/browser-core/src/index.ts
git commit -m "feat(browser-core): run agent steps inside runFlow"
```

---

## Task 6: Board types + resolveChains for agent node

**Files:**
- Modify: `apps/automation-api/src/boards/board.types.ts`
- Modify: `apps/automation-api/src/boards/resolve-chains.ts`
- Modify: `apps/automation-api/src/boards/resolve-chains.spec.ts`

- [ ] **Step 1: Add `AgentNodeData` and board node variant**

```ts
export type AgentProvider = 'openai' | 'anthropic' | 'gemini';

export interface AgentNodeData {
  prompt: string;
  provider: AgentProvider;
  model: string;
  apiKey: string;
  maxSteps?: number;
  timeoutMs?: number;
  allowDomains?: string[];
  readOnly?: boolean;
}

// BoardNode union add:
| (NodeBase & { type: 'agent'; data: AgentNodeData })
```

- [ ] **Step 2: Write failing resolve-chains tests**

```ts
it('maps agent node to FlowStep with defaults and allowDomains from goto', () => {
  const g = graph(
    [
      { id: 'p', type: 'profile', position: pos, data: { profileId: 'prof-1' } },
      { id: 'g', type: 'goto', position: pos, data: { url: 'https://www.facebook.com/' } },
      { id: 'a', type: 'agent', position: pos, data: {
        prompt: 'collect interactions',
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: 'sk-x',
      }},
    ],
    [
      { id: 'e1', source: 'p', target: 'g' },
      { id: 'e2', source: 'g', target: 'a' },
    ],
  );
  const jobs = resolveChains(g);
  expect(jobs[0].steps[1]).toMatchObject({
    type: 'agent',
    prompt: 'collect interactions',
    allowDomains: ['facebook.com'],
    readOnly: true,
    maxSteps: 25,
  });
});

it('throws when agent node missing apiKey', () => {
  // graph with empty apiKey → BoardGraphError
});
```

Add helper `deriveAllowDomains(stepsSoFar, gotoUrl)` in `resolve-chains.ts`:
- Parse hostname from each goto URL in the chain walked so far.
- Default `allowDomains` to unique hostnames (strip `www.`).

- [ ] **Step 3: Implement agent branch in resolve loop**

```ts
} else if (target.type === 'agent') {
  const d = target.data;
  if (!d.prompt?.trim()) throw new BoardGraphError(`Agent node ${target.id} has empty prompt`);
  if (!d.model?.trim()) throw new BoardGraphError(`Agent node ${target.id} has empty model`);
  if (!d.apiKey?.trim()) throw new BoardGraphError(`Agent node ${target.id} has empty apiKey`);
  const domains = d.allowDomains?.length ? d.allowDomains : deriveAllowDomainsFromChain(steps, target);
  steps.push({
    type: 'agent',
    prompt: d.prompt,
    provider: d.provider,
    model: d.model,
    apiKey: d.apiKey,
    maxSteps: d.maxSteps ?? 25,
    timeoutMs: d.timeoutMs ?? 300_000,
    allowDomains: domains,
    readOnly: d.readOnly ?? true,
  });
}
```

Update screenshot branch to `else if (target.type === 'screenshot')` only.

- [ ] **Step 4: Run tests**

Run: `pnpm exec nx test automation-api -- resolve-chains`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/automation-api/src/boards/board.types.ts apps/automation-api/src/boards/resolve-chains.ts apps/automation-api/src/boards/resolve-chains.spec.ts
git commit -m "feat(boards): resolve agent nodes to FlowStep with allowDomains"
```

---

## Task 7: Run types + executeFlow agent mapping

**Files:**
- Modify: `apps/automation-api/src/runs/run.types.ts`
- Modify: `apps/automation-api/src/runs/run.service.ts`
- Modify: `apps/automation-api/src/runs/run.service.spec.ts`

- [ ] **Step 1: Extend `FlowStep` and `FlowStepRecord`**

```ts
export type FlowStep =
  | /* existing */
  | {
      type: 'agent';
      prompt: string;
      provider: 'openai' | 'anthropic' | 'gemini';
      model: string;
      apiKey: string;
      maxSteps?: number;
      timeoutMs?: number;
      allowDomains?: string[];
      readOnly?: boolean;
    };

export interface FlowStepRecord {
  type: 'goto' | 'wait' | 'screenshot' | 'agent';
  status: 'completed' | 'failed';
  error: string | null;
  // agent-only (optional on record):
  stepsUsed?: number;
  stopReason?: 'finished' | 'max-steps' | 'timeout' | 'error';
  result?: unknown;
  transcript?: string;
  // existing goto/screenshot fields unchanged
}
```

- [ ] **Step 2: Write failing executeFlow test**

Mock `browser.runFlow` to return one `AgentFlowStepResult`; assert `executeFlow` maps `result`, `stepsUsed`, `transcript` path, and **result.json on disk does not contain `sk-`**.

- [ ] **Step 3: Update `executeFlow` resolution + mapping**

```ts
if (step.type === 'agent') {
  return {
    type: 'agent',
    task: {
      prompt: step.prompt,
      provider: step.provider,
      model: step.model,
      apiKey: step.apiKey,
    },
    limits: {
      maxSteps: step.maxSteps ?? 25,
      timeoutMs: step.timeoutMs ?? 300_000,
      allowDomains: step.allowDomains ?? [],
      readOnly: step.readOnly ?? true,
    },
    transcriptPath: resolve(runDir, `step-${i}-agent-transcript.json`),
  };
}
```

Mapping:

```ts
const stepRecords: FlowStepRecord[] = stepResults.map((r, i) => {
  if (r.type === 'agent') {
    return {
      type: 'agent',
      status: r.status,
      error: r.error,
      stepsUsed: r.stepsUsed,
      stopReason: r.stopReason,
      result: r.result,
      transcript: r.transcriptPath ? `runs/${runId}/step-${i}-agent-transcript.json` : undefined,
    };
  }
  // existing mapping...
});
```

Audit append: use `url: 'agent'` or first goto URL; never pass apiKey.

- [ ] **Step 4: Run tests**

Run: `pnpm exec nx test automation-api -- run.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/automation-api/src/runs/run.types.ts apps/automation-api/src/runs/run.service.ts apps/automation-api/src/runs/run.service.spec.ts
git commit -m "feat(runs): execute and record agent flow steps without leaking apiKey"
```

---

## Task 8: Agent node UI + validation

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Create: `apps/web/src/components/automation/nodes/agent-node.tsx`
- Modify: `apps/web/src/components/automation/flow-canvas.tsx`
- Modify: `apps/web/src/components/automation/graph-validation.ts`
- Modify: `apps/web/src/components/automation/graph-validation.spec.ts`

- [ ] **Step 1: Extend web API types** (mirror backend `AgentNodeData` + `FlowStepRecord` agent fields)

- [ ] **Step 2: Implement `agent-node.tsx`**

Fields:
- `textarea` prompt
- `select` provider: openai | anthropic | gemini
- `input` model (placeholder `gpt-4o-mini`)
- `input type="password"` apiKey
- collapsible advanced: maxSteps (number), timeoutMs (number), readOnly (checkbox, default checked)

Handles: target left, source right. `onChange` patches via `data.onChange`.

- [ ] **Step 3: Wire `flow-canvas.tsx`**

- `nodeTypes.agent = AgentNode`
- `+ Agent` button
- `stripData` for agent: persist only `{ prompt, provider, model, apiKey, maxSteps?, timeoutMs?, readOnly? }` — **never** inject apiKey into run results panel from board state incorrectly
- `injectData` seeds: `provider: 'openai'`, `model: 'gpt-4o-mini'`, `prompt: ''`, `readOnly: true`
- Results panel: for each run, if board returned step details are not available at board-run level, extend display when re-fetching run — **v1 minimum:** show profile status; after run, optional `GET` not in API yet — **instead** extend `BoardRunRecord` usage: board run returns `FlowRunRecord.steps` — update `flow-canvas` run handler to show agent step summary from `result.runs[].steps` if API returns them.

Check `board.service` run response includes full `FlowRunRecord` with steps — if not, extend `BoardRunRecord` / board run endpoint to include step details (verify in `board.service.ts`).

- [ ] **Step 4: graph-validation**

```ts
} else if (node.type === 'agent') {
  const d = node.data as AgentNodeData;
  if (!d.prompt?.trim()) errors.push({ nodeId: node.id, message: 'Agent prompt is empty' });
  if (!d.model?.trim()) errors.push({ nodeId: node.id, message: 'Agent model is empty' });
  if (!d.apiKey?.trim()) errors.push({ nodeId: node.id, message: 'Agent API key is empty' });
}
```

- [ ] **Step 5: Run web tests + build**

Run: `pnpm exec nx test web && pnpm exec nx build web`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/src/components/automation/nodes/agent-node.tsx apps/web/src/components/automation/flow-canvas.tsx apps/web/src/components/automation/graph-validation.ts apps/web/src/components/automation/graph-validation.spec.ts
git commit -m "feat(web): add AI Agent node to flow board"
```

---

## Task 9: Board run returns agent step details in UI

**Files:**
- Modify: `apps/automation-api/src/boards/board.service.ts` (if run record omits steps)
- Modify: `apps/web/src/components/automation/flow-canvas.tsx`

- [ ] **Step 1: Verify `board.service` run returns `FlowRunRecord[]` with `steps`**

Read `board.service.ts` `run()` method. If it only returns summary, ensure full `FlowRunRecord` from `executeFlow` is included in `BoardRunRecord.runs`.

- [ ] **Step 2: Extend results panel**

When `result.runs[].steps` contains `type === 'agent'`, render:

```tsx
{r.steps?.filter(s => s.type === 'agent').map((s, i) => (
  <pre key={i} className="mt-2 max-h-32 overflow-auto text-[10px]">
    {s.status} · {s.stepsUsed} steps · {s.stopReason}
    {s.result ? `\n${JSON.stringify(s.result, null, 2)}` : ''}
  </pre>
))}
```

- [ ] **Step 3: Commit**

```bash
git add apps/automation-api/src/boards/board.service.ts apps/web/src/components/automation/flow-canvas.tsx
git commit -m "feat(web): show agent JSON results in board run panel"
```

---

## Task 10: E2E gate (optional, skipped in CI)

**Files:**
- Create: `apps/automation-api/src/e2e/agent-run.e2e.spec.ts`

- [ ] **Step 1: Write gated e2e**

```ts
const maybe = process.env.RUN_E2E === '1' && process.env.AGENT_API_KEY ? describe : describe.skip;

maybe('agent board run', () => {
  // create profile, board with Profile → Goto example.com → Agent (prompt: extract h1 text)
  // POST run, expect agent step completed with result object
});
```

- [ ] **Step 2: Verify skipped by default**

Run: `pnpm exec nx test automation-api -- agent-run.e2e`
Expected: skipped.

- [ ] **Step 3: Commit**

```bash
git add apps/automation-api/src/e2e/agent-run.e2e.spec.ts
git commit -m "test(boards): add gated agent-run e2e"
```

---

## Task 11: Manual verification

- [ ] **Step 1: Start API + web**

```bash
pnpm exec nx serve automation-api
pnpm exec nx serve web
```

- [ ] **Step 2: Happy path**

1. Profiles: create profile, login session on a test site (or Facebook if available).
2. Automation: board `Profile → Goto https://example.com → Agent` with prompt "extract the main heading text as JSON `{ heading: string }`", valid API key.
3. Run → expect agent step `completed`, JSON in results panel, `artifacts/runs/<id>/step-1-agent-transcript.json` exists without apiKey field.

- [ ] **Step 3: Guardrails**

Empty apiKey → client validation blocks Run. maxSteps=1 with complex prompt → `max-steps` stopReason.

---

## Self-Review Notes

- **Spec coverage:** Agent node on board (T8), in-node apiKey (T8), DOM perception (T1–T3), structured JSON output (T3, T7, T9), seams (T1–T5), guardrails (T3, T6), key redaction (T3 redact, T7, T5 transcript), read-only (T3), parallel/chain integration (T5–T7), testing (all tasks), e2e gate (T10), out-of-scope items omitted.
- **Type consistency:** `AgentTask`/`AgentLimits` in browser-core; `FlowStep` agent variant in API; `ResolvedFlowStep` agent in runFlow; `FlowStepRecord` agent fields aligned.
- **Scope:** Single plan, one vertical slice; no co-pilot, vision, or branching.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-02-ai-agent-browser-node.md`.
