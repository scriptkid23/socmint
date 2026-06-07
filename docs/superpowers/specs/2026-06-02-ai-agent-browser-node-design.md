# AI Agent Browser Node — Design

**Date:** 2026-06-02
**Status:** Approved (design)

## Summary

Add an **AI Agent node** to the existing Automation flow board. The node accepts a
natural-language **prompt** plus an LLM **provider/model/API key**, and at run time an
autonomous agent loop drives the browser (read DOM → ask the LLM for the next action →
act) to accomplish the task — e.g. "find the Facebook user `X` and collect how they
interacted with posts". The agent reuses the profile's already-logged-in CloakBrowser
session and returns **structured JSON** data.

The node plugs into the existing board: it resolves into a single `agent` step inside the
per-profile chain executed by `RunService.executeFlow`, so it inherits board persistence,
per-profile locking, and parallel execution.

## Decisions (from brainstorming)

- **Integration:** A node on the existing flow board (not a separate tab/runtime). Connects
  in a chain like `Profile → Goto → Agent → Screenshot`.
- **Brain config in the node:** provider + model + API key entered directly in the node UI
  (no env config required). Provider is selectable; key is per-node.
- **Perception:** DOM/text serialization (cheaper/faster than vision). Screenshot evidence
  may be added later.
- **Output:** structured JSON (list of items with fields: post link, likes/comments/shares,
  timestamp, etc., shaped by the task).
- **Approach A (chosen):** in-house minimal agent loop in `libs/browser-core`, behind two
  seams (`PageActions`, `LlmClient`), reusing CloakBrowser's persistent context, stealth,
  and the profile's logged-in session.
- **Guardrails (defaults):** max steps (25), timeout (5 min), domain allowlist, and
  **read-only by default** (block post/delete/send).

## Architecture & Data Flow

```
apps/web (React Flow)              apps/automation-api (NestJS)          libs/browser-core
┌───────────────────────┐         ┌───────────────────────────┐       ┌───────────────────┐
│ FlowCanvas            │  PATCH  │ boards/                    │       │ CloakBrowserService│
│  └ AgentNode          │ ──────► │  resolveChains(graph)      │       │  + runFlow()       │
│     prompt/provider/  │  /boards│   ↳ FlowStep 'agent'       │       │                    │
│     model/apiKey      │         │ runs/                      │       │ agent/             │
│  Run ──────────────── │ ──────► │  RunService.executeFlow()  │ ────► │  AgentRunner.run() │
└───────────────────────┘ /run    │   ↳ AgentRunner (loop)     │       │   PageActions seam │
                                   └───────────────────────────┘       │   LlmClient seam   │
                                                                        └───────────────────┘
```

**Run flow:**
1. User adds an Agent node, fills prompt + provider/model/API key, wires it into a profile
   chain. Autosaves via `PATCH /boards/:id`.
2. **Run** → `POST /boards/:id/run`.
3. `resolveChains(graph)` emits an `agent` step for the node.
4. `RunService.executeFlow` runs the chain on one CloakBrowser context per profile. For the
   `agent` step it invokes `AgentRunner.run(page, task, llm, limits)` on the **same page**
   (so the agent uses the profile's logged-in session + stealth).
5. The agent loop runs until `finish` or a guardrail stops it; the structured result is
   attached to the step record and persisted under `artifacts/runs/<runId>/result.json`.

## Data Model

### Agent node (stored verbatim in the board graph)

```ts
interface AgentNodeData {
  prompt: string;
  provider: 'openai' | 'anthropic' | 'gemini';
  model: string;          // e.g. 'gpt-4o-mini'
  apiKey: string;
  maxSteps?: number;      // default 25
  timeoutMs?: number;     // default 300000 (5 min)
  allowDomains?: string[];// default: domains seen in the chain's Goto / profile
  readOnly?: boolean;     // default true
}

// board.types.ts: BoardNode union gains
//   (NodeBase & { type: 'agent'; data: AgentNodeData })
```

`position` is canvas-only; the backend uses `type`, `data`, and `edges`.

### Flow step + result

```ts
// runs/run.types.ts: FlowStep union gains
type FlowStep =
  | { type: 'goto'; url: string; waitUntil?: WaitUntil; timeoutMs?: number }
  | { type: 'wait'; ms: number }
  | { type: 'screenshot' }
  | { type: 'agent'; prompt: string; provider: string; model: string; apiKey: string;
      maxSteps?: number; timeoutMs?: number; allowDomains?: string[]; readOnly?: boolean };

// FlowStepRecord gains an agent variant
interface AgentStepRecord {
  type: 'agent';
  status: 'completed' | 'failed';
  error: string | null;
  stepsUsed: number;
  stopReason: 'finished' | 'max-steps' | 'timeout' | 'error';
  result: unknown | null;   // structured JSON the agent produced
  transcript?: string;      // relative path to agent-transcript.json (debug)
}
```

`result.json` continues to be written under `artifacts/runs/<runId>/`. An optional
`agent-transcript.json` (thought/action/observation per step) aids debugging.

## Agent Loop (`libs/browser-core/src/lib/agent/`)

```
agent/
  ├ types.ts            // AgentAction, AgentResult, AgentLimits, PageActions, LlmClient
  ├ dom-serializer.ts   // page DOM → compact indexed element/text list
  ├ llm-client.ts       // provider-agnostic client + factory from {provider,model,apiKey}
  ├ agent-runner.ts     // the observe→decide→act loop
  └ *.spec.ts
```

**Seams (testable with fakes, no network):**

- **`PageActions`** — extends today's `PageLike` with `click(index)`, `type(index, text)`,
  `pressEnter()`, `scroll(direction)`, and `readDom()`. The real Playwright/CloakBrowser
  page already supports these; the seam keeps `AgentRunner` unit-testable.
- **`LlmClient`** — `complete(messages): Promise<{ content: string }>`. A factory builds the
  concrete client from `{ provider, model, apiKey }`. Tests inject a fake returning scripted
  actions.

**Loop (`AgentRunner.run(page, task, llm, limits)`):**
1. **Observe:** `dom-serializer` turns the page into a compact, indexed list of interactive
   elements + visible text, e.g. `[3] <button> "Search"`, `[4] <a href> "Jane Doe"`.
2. **Decide:** build a message with `task + current url + serialized DOM + allowed actions +
   JSON output instruction`; the LLM returns one action JSON
   `{ thought, action: { type, args }, done?, result? }`.
3. **Act:** execute via `PageActions`.
4. Append to history, check guardrails, repeat until `done` (=> `finish`) or a limit hits.

## Action Vocabulary

Read-only by default: `navigate(url)` (allowlist-checked), `click(index)`, `type(index, text)`,
`pressEnter()`, `scroll(direction)`, `extract(data)` (record structured data), `finish(result)`.

When `readOnly = true`, destructive actions (submitting posts, deleting, sending messages)
are **refused** by the runner and reported as a blocked action (the loop continues or stops
per the model's next decision).

## Guardrails & Security

- **Budgets:** stop when exceeding `maxSteps`, `timeoutMs`, or when an action targets a
  domain outside `allowDomains`. On stop, return the partial `result` collected so far with
  the appropriate `stopReason`.
- **API key handling:** stored in the board JSON on local disk (the app binds to loopback
  only). The key is **never logged**, redacted in the audit logger, and **excluded** from
  run records / artifacts / transcripts.
- **Default allowlist:** derived from the chain's Goto URL(s) / intended target (e.g.
  `facebook.com`) so the agent cannot wander off-site by default.

## Frontend (React Flow)

**New file:** `apps/web/src/components/automation/nodes/agent-node.tsx` — fields: prompt
(textarea), provider (select), model (input), API key (password input), and optional
advanced fields (maxSteps, timeoutMs, readOnly). Input + output handles. Styling matches the
existing neo-brutalist nodes.

**Wiring:**
- `flow-canvas.tsx`: register `agent` in `nodeTypes`; add a **+ Agent** palette button;
  `stripData`/`injectData` handle agent fields; seed defaults on add.
- `api/client.ts`: extend `BoardNode` type union + `AgentNodeData`, `FlowStepRecord` agent
  variant.
- `graph-validation.ts`: agent node requires non-empty `prompt`, `model`, and `apiKey`.
- Run results panel: show agent `status`, `stepsUsed`, `stopReason`, and pretty-printed JSON
  `result`.

## Backend (NestJS + browser-core)

- `boards/board.types.ts`: `BoardNode` union gains the `agent` variant + `AgentNodeData`.
- `boards/resolve-chains.ts`: map an `agent` node to an `agent` `FlowStep`; validate
  `prompt`/`model`/`apiKey` present (else `BoardGraphError`).
- `runs/run.types.ts`: `FlowStep` + `FlowStepRecord` gain the agent variants.
- `runs/run.service.ts` (`executeFlow`): for an `agent` step, build the `LlmClient` from the
  node config and call `AgentRunner.run(page, ...)`; map the `AgentResult` into the step
  record; redact the key from any audit entry.
- `libs/browser-core`: new `agent/` folder (above); `PageLike` extended to `PageActions`;
  the real launcher's page implements the new methods.

## Error Handling

- LLM/network errors, unparseable action JSON, or action execution failures are captured per
  step; the runner records them and either retries the observe step (bounded) or stops with
  `stopReason: 'error'`.
- Guardrail stops are **not** errors — they yield `status` based on whether any usable
  `result` was produced (partial result => `completed` with `stopReason`, none => `failed`).
- Backend maps `BoardGraphError` → 400 (existing filter), agent runtime failures → recorded
  in the run record (the board run itself still returns 200 with per-step status).

## Testing Strategy

- **browser-core:** `AgentRunner` with fake `PageActions` + scripted fake `LlmClient` —
  happy path (multi-step → finish with JSON), guardrail stops (max-steps/timeout/off-domain),
  read-only blocking, bad-action-JSON handling. `dom-serializer` unit tests. `llm-client`
  factory mapping (provider → client) with mocked transport.
- **automation-api:** `resolveChains` includes/validates the agent step; `executeFlow`
  handles an `agent` step via a mocked `AgentRunner`; record mapping + key redaction.
- **web:** `agent-node` renders/edits fields; `graph-validation` flags missing
  prompt/model/key; results panel renders agent result.
- **e2e (gated by `RUN_E2E` + a real key):** a real agent run against a simple page; skipped
  in normal CI to avoid network/cost.

## Out of Scope (v1)

- Vision/screenshot-based perception (DOM/text only for now).
- Interactive co-pilot mode (human-in-the-loop mid-run).
- Branching/looping graphs (chains stay linear, per the board's v1 constraints).
- Writing/destructive automations (read-only default; destructive actions deferred).
- Multi-provider key vault / env-based secrets management (key lives in the node for now).
