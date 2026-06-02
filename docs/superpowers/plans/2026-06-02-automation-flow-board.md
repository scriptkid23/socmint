# Automation Flow Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Automation tab with a React Flow board where Profile nodes are wired into chains of Goto/Screenshot action nodes, and a Run button executes each profile's chain in parallel.

**Architecture:** Approach A — the backend is the source of truth. A board stores its React Flow graph verbatim as JSON. On run, the backend resolves the graph into one linear step-chain per profile and executes them with `Promise.all` through the existing CloakBrowser stack. `LockService` already serializes runs per profile.

**Tech Stack:** Nx monorepo. Backend: NestJS 11 + class-validator + Swagger, file-based JSON stores, Jest. Browser: `libs/browser-core` (Playwright/CloakBrowser seam). Frontend: React 19 + Vite + Tailwind + `@xyflow/react` (React Flow v12), Vitest + Testing Library.

Spec: `docs/superpowers/specs/2026-06-02-automation-flow-board-design.md`.

---

## File Structure

**`libs/browser-core/src/lib/`**
- `types.ts` (modify) — add `ResolvedFlowStep`, `FlowStepResult`.
- `cloak-browser.service.ts` (modify) — add `runFlow()` (open one context, run steps sequentially).
- `cloak-browser.service.spec.ts` (modify) — tests for `runFlow`.

**`apps/automation-api/src/runs/`**
- `run.types.ts` (modify) — add `FlowStep`, `FlowStepRecord`, `FlowRunRecord`.
- `run.service.ts` (modify) — add `executeFlow()`; keep `execute()` untouched.
- `run.service.spec.ts` (modify) — tests for `executeFlow`.

**`apps/automation-api/src/boards/` (new)**
- `board.types.ts` — `BoardNode`, `BoardEdge`, `BoardGraph`, `BoardRecord`, `BoardRunRecord`.
- `board.errors.ts` — `BoardNotFoundError`, `BoardGraphError`.
- `resolve-chains.ts` — pure `resolveChains(graph) → FlowJob[]`.
- `resolve-chains.spec.ts` — tests.
- `board.store.ts` — JSON persistence under `dataRoot/boards/<id>.json`.
- `board.store.spec.ts` — tests.
- `board.service.ts` — CRUD + run orchestration.
- `board.service.spec.ts` — tests.
- `dto.ts` — `CreateBoardDto`, `UpdateBoardDto` (+ nested graph DTOs).
- `board.response.ts` — Swagger response DTOs.
- `boards.controller.ts` — REST.

**`apps/automation-api/src/app/`**
- `domain-exception.filter.ts` (modify) — map `BoardNotFoundError`→404, `BoardGraphError`→400.
- `app.module.ts` (modify) — register board providers + controller.

**`apps/automation-api/src/e2e/`**
- `board-run.e2e.spec.ts` (new) — full create→graph→run flow against the mock.

**`apps/web/src/`**
- `api/client.ts` (modify) — board graph types + board CRUD + `runBoard`.
- `hooks/use-boards.ts` (new) + `use-boards.spec.tsx` (new).
- `components/automation/graph-validation.ts` (new) + `graph-validation.spec.ts` (new).
- `components/automation/nodes/profile-node.tsx`, `goto-node.tsx`, `screenshot-node.tsx` (new).
- `components/automation/flow-canvas.tsx` (new).
- `components/automation/board-list.tsx` (new).
- `components/automation/automation-page.tsx` (new).
- `components/profiles-page.tsx` (new — extracted from `app.tsx`).
- `components/profile-nav.tsx` (modify) — Automation item + active state.
- `app.tsx` (modify) — hash-based tab shell.

---

## Task 1: browser-core `runFlow` types

**Files:**
- Modify: `libs/browser-core/src/lib/types.ts`

- [ ] **Step 1: Add the flow types**

Append to `libs/browser-core/src/lib/types.ts` (after `RunPageResult`):

```ts
/** A single executable step with all paths already resolved by the caller. */
export type ResolvedFlowStep =
  | { type: 'goto'; url: string; waitUntil?: WaitUntil; timeoutMs?: number }
  | { type: 'screenshot'; screenshotPath: string };

/** Per-step outcome returned by runFlow, in execution order. */
export interface FlowStepResult {
  type: 'goto' | 'screenshot';
  status: 'completed' | 'failed';
  error: string | null;
  /** goto only */
  title?: string;
  /** goto only */
  finalUrl?: string;
  /** screenshot only; absolute path written, or null on failure */
  screenshotPath?: string | null;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx nx run browser-core:build` (or `npx tsc -p libs/browser-core/tsconfig.lib.json --noEmit`)
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add libs/browser-core/src/lib/types.ts
git commit -m "feat(browser-core): add ResolvedFlowStep and FlowStepResult types"
```

---

## Task 2: browser-core `runFlow` method

**Files:**
- Modify: `libs/browser-core/src/lib/cloak-browser.service.ts`
- Test: `libs/browser-core/src/lib/cloak-browser.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add this `describe` block to `libs/browser-core/src/lib/cloak-browser.service.spec.ts` (keep existing tests; reuse imports already present — `CloakBrowserService` and the types):

```ts
import type {
  BrowserContextLike,
  BrowserLauncher,
  FlowStepResult,
  LaunchOptions,
  PageLike,
  ResolvedFlowStep,
} from './types';
import { CloakBrowserService } from './cloak-browser.service';

describe('CloakBrowserService.runFlow', () => {
  function makeFakes(opts?: { failOnGoto?: boolean }) {
    const calls: string[] = [];
    let closed = false;
    const page: PageLike = {
      async goto(url) {
        calls.push(`goto:${url}`);
        if (opts?.failOnGoto) throw new Error('nav boom');
        return undefined;
      },
      async title() {
        return 'Example Domain';
      },
      url() {
        return 'https://example.com/';
      },
      async screenshot({ path }) {
        calls.push(`shot:${path}`);
        return undefined;
      },
    };
    const context: BrowserContextLike = {
      async newPage() {
        return page;
      },
      pages() {
        return [page];
      },
      on() {},
      async close() {
        closed = true;
      },
    };
    const launcher: BrowserLauncher = {
      async ensureBinary() {},
      async launchPersistentContext() {
        return context;
      },
    };
    return { launcher, calls, isClosed: () => closed };
  }

  const launch: LaunchOptions = { userDataDir: '/tmp/x' };

  it('runs steps in order and returns per-step results', async () => {
    const { launcher, calls, isClosed } = makeFakes();
    const svc = new CloakBrowserService(launcher);
    const steps: ResolvedFlowStep[] = [
      { type: 'goto', url: 'https://example.com' },
      { type: 'screenshot', screenshotPath: '/abs/step-1.png' },
    ];

    const results: FlowStepResult[] = await svc.runFlow(launch, steps);

    expect(calls).toEqual(['goto:https://example.com', 'shot:/abs/step-1.png']);
    expect(results[0]).toMatchObject({ type: 'goto', status: 'completed', title: 'Example Domain', finalUrl: 'https://example.com/' });
    expect(results[1]).toMatchObject({ type: 'screenshot', status: 'completed', screenshotPath: '/abs/step-1.png' });
    expect(isClosed()).toBe(true);
  });

  it('stops after a failed step and closes the context', async () => {
    const { launcher, calls, isClosed } = makeFakes({ failOnGoto: true });
    const svc = new CloakBrowserService(launcher);
    const steps: ResolvedFlowStep[] = [
      { type: 'goto', url: 'https://example.com' },
      { type: 'screenshot', screenshotPath: '/abs/step-1.png' },
    ];

    const results = await svc.runFlow(launch, steps);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ type: 'goto', status: 'failed', error: 'nav boom' });
    expect(calls).toEqual(['goto:https://example.com']);
    expect(isClosed()).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx nx test browser-core -- -t "runFlow"`
Expected: FAIL — `svc.runFlow is not a function`.

- [ ] **Step 3: Implement `runFlow`**

In `libs/browser-core/src/lib/cloak-browser.service.ts`, update the type import line to include the new types and add the method inside the class (after `runPage`):

```ts
import type {
  BrowserLauncher,
  FlowStepResult,
  InteractiveSession,
  LaunchOptions,
  ResolvedFlowStep,
  RunPageOptions,
  RunPageResult,
} from './types';
```

```ts
  /**
   * Open one persistent context and execute steps sequentially. Stops at the
   * first failed step. Always closes the context.
   */
  async runFlow(launch: LaunchOptions, steps: ResolvedFlowStep[]): Promise<FlowStepResult[]> {
    const context = await this.launcher.launchPersistentContext(launch);
    const results: FlowStepResult[] = [];
    try {
      const page = await context.newPage();
      for (const step of steps) {
        try {
          if (step.type === 'goto') {
            await page.goto(step.url, {
              waitUntil: step.waitUntil ?? DEFAULT_WAIT_UNTIL,
              timeout: step.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            });
            results.push({
              type: 'goto',
              status: 'completed',
              error: null,
              title: await page.title(),
              finalUrl: page.url(),
            });
          } else {
            await page.screenshot({ path: step.screenshotPath, fullPage: true });
            results.push({
              type: 'screenshot',
              status: 'completed',
              error: null,
              screenshotPath: step.screenshotPath,
            });
          }
        } catch (err) {
          results.push({
            type: step.type,
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
            screenshotPath: step.type === 'screenshot' ? null : undefined,
          });
          break;
        }
      }
      return results;
    } finally {
      await context.close();
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx nx test browser-core`
Expected: PASS (existing + new).

- [ ] **Step 5: Commit**

```bash
git add libs/browser-core/src/lib/cloak-browser.service.ts libs/browser-core/src/lib/cloak-browser.service.spec.ts
git commit -m "feat(browser-core): add runFlow to execute a step chain in one context"
```

---

## Task 3: runs flow types

**Files:**
- Modify: `apps/automation-api/src/runs/run.types.ts`

- [ ] **Step 1: Add the flow record types**

Append to `apps/automation-api/src/runs/run.types.ts`:

```ts
import type { WaitUntil } from '@socmint/browser-core';

/** A step as authored on a board (paths not yet resolved). */
export type FlowStep =
  | { type: 'goto'; url: string; waitUntil?: WaitUntil; timeoutMs?: number }
  | { type: 'screenshot' };

export interface FlowStepRecord {
  type: 'goto' | 'screenshot';
  status: 'completed' | 'failed';
  error: string | null;
  /** goto only */
  title?: string;
  /** goto only */
  finalUrl?: string;
  /** screenshot only; relative artifact path "runs/<runId>/step-<n>.png" or null */
  screenshot?: string | null;
}

export interface FlowRunRecord {
  id: string;
  profileId: string;
  status: 'completed' | 'failed';
  startedAt: string;
  finishedAt: string;
  error: string | null;
  steps: FlowStepRecord[];
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p apps/automation-api/tsconfig.app.json --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/automation-api/src/runs/run.types.ts
git commit -m "feat(runs): add FlowStep and FlowRunRecord types"
```

---

## Task 4: `RunService.executeFlow`

**Files:**
- Modify: `apps/automation-api/src/runs/run.service.ts`
- Test: `apps/automation-api/src/runs/run.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add this `describe` block to `apps/automation-api/src/runs/run.service.spec.ts` (keep existing tests):

```ts
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { CloakBrowserService } from '@socmint/browser-core';
import { ProfileStore } from '../profiles/profile.store';
import { LockService } from '../profiles/lock.service';
import { ProfileService } from '../profiles/profile.service';
import { AuditLogger } from './audit.logger';
import { RunService } from './run.service';

describe('RunService.executeFlow', () => {
  let dataRoot: string;
  let artifactsRoot: string;
  let profiles: ProfileService;
  let lock: LockService;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'rs-data-'));
    artifactsRoot = await mkdtemp(join(tmpdir(), 'rs-art-'));
    const store = new ProfileStore(dataRoot);
    lock = new LockService(60000);
    profiles = new ProfileService(store, lock, dataRoot);
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  });

  function service(browser: Pick<CloakBrowserService, 'runFlow'>) {
    return new RunService(
      profiles,
      lock,
      browser as unknown as CloakBrowserService,
      new AuditLogger(artifactsRoot),
      dataRoot,
      artifactsRoot,
    );
  }

  it('runs a multi-step chain, writes result.json, maps screenshot to a relative path', async () => {
    const profile = await profiles.create({ label: 'p1' });
    const browser = {
      runFlow: jest.fn().mockResolvedValue([
        { type: 'goto', status: 'completed', error: null, title: 'T', finalUrl: 'https://e/' },
        { type: 'screenshot', status: 'completed', error: null, screenshotPath: '/ignored.png' },
      ]),
    };
    const svc = service(browser);

    const rec = await svc.executeFlow(profile.id, [
      { type: 'goto', url: 'https://e' },
      { type: 'screenshot' },
    ]);

    expect(rec.status).toBe('completed');
    expect(rec.steps).toHaveLength(2);
    expect(rec.steps[1].screenshot).toBe(`runs/${rec.id}/step-1.png`);
    const saved = JSON.parse(await readFile(resolve(artifactsRoot, 'runs', rec.id, 'result.json'), 'utf8'));
    expect(saved.id).toBe(rec.id);
    // lock released
    expect(await lock.isLocked(resolve(dataRoot, 'profiles', profile.id))).toBe(false);
  });

  it('marks the record failed when a step fails', async () => {
    const profile = await profiles.create({ label: 'p2' });
    const browser = {
      runFlow: jest.fn().mockResolvedValue([
        { type: 'goto', status: 'failed', error: 'nav boom', title: undefined, finalUrl: undefined },
      ]),
    };
    const svc = service(browser);

    const rec = await svc.executeFlow(profile.id, [{ type: 'goto', url: 'https://e' }]);

    expect(rec.status).toBe('failed');
    expect(rec.error).toBe('nav boom');
  });

  it('produces a failed record (and releases the lock) when launch throws', async () => {
    const profile = await profiles.create({ label: 'p3' });
    const browser = { runFlow: jest.fn().mockRejectedValue(new Error('launch boom')) };
    const svc = service(browser);

    const rec = await svc.executeFlow(profile.id, [{ type: 'goto', url: 'https://e' }]);

    expect(rec.status).toBe('failed');
    expect(rec.error).toBe('launch boom');
    expect(rec.steps).toEqual([]);
    expect(await lock.isLocked(resolve(dataRoot, 'profiles', profile.id))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx nx test automation-api -- -t "executeFlow"`
Expected: FAIL — `executeFlow is not a function`.

- [ ] **Step 3: Implement `executeFlow`**

In `apps/automation-api/src/runs/run.service.ts`, extend the imports and add the method. Update the type import to include the new types and `ResolvedFlowStep`:

```ts
import type { LaunchOptions, RunPageOptions, ResolvedFlowStep } from '@socmint/browser-core';
import type { RunRecord, FlowStep, FlowStepRecord, FlowRunRecord } from './run.types';
```

Add this method to the `RunService` class (after `execute`):

```ts
  async executeFlow(profileId: string, steps: FlowStep[]): Promise<FlowRunRecord> {
    const profile = await this.profiles.get(profileId);
    const profileDir = resolveProfileDir(this.dataRoot, profileId);

    await this.lock.acquire(profileDir, process.pid);

    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const runDir = this.runDir(runId);
    await mkdir(runDir, { recursive: true });

    const launch: LaunchOptions = {
      userDataDir: resolveUserDataDir(this.dataRoot, profileId),
      headless: profile.launchDefaults.headless,
      geoip: profile.launchDefaults.geoip,
      proxy: profile.proxy,
    };

    const resolved: ResolvedFlowStep[] = steps.map((step, i) =>
      step.type === 'screenshot'
        ? { type: 'screenshot', screenshotPath: resolve(runDir, `step-${i}.png`) }
        : { type: 'goto', url: step.url, waitUntil: step.waitUntil, timeoutMs: step.timeoutMs },
    );

    let record: FlowRunRecord;
    try {
      const stepResults = await this.browser.runFlow(launch, resolved);
      const stepRecords: FlowStepRecord[] = stepResults.map((r, i) => ({
        type: r.type,
        status: r.status,
        error: r.error,
        title: r.title,
        finalUrl: r.finalUrl,
        screenshot:
          r.type === 'screenshot'
            ? r.status === 'completed'
              ? `runs/${runId}/step-${i}.png`
              : null
            : undefined,
      }));
      const failed = stepResults.find((r) => r.status === 'failed');
      record = {
        id: runId,
        profileId,
        status: failed ? 'failed' : 'completed',
        startedAt,
        finishedAt: new Date().toISOString(),
        error: failed?.error ?? null,
        steps: stepRecords,
      };
    } catch (err) {
      record = {
        id: runId,
        profileId,
        status: 'failed',
        startedAt,
        finishedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
        steps: [],
      };
    } finally {
      await this.lock.release(profileDir);
    }

    await writeFile(resolve(runDir, 'result.json'), JSON.stringify(record, null, 2), 'utf8');
    const firstGoto = steps.find((s): s is Extract<FlowStep, { type: 'goto' }> => s.type === 'goto');
    await this.audit.append({
      profileId,
      runId,
      url: firstGoto?.url ?? 'flow',
      timestamp: startedAt,
    });

    return record;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx nx test automation-api -- -t "executeFlow"`
Expected: PASS. Then `npx nx test automation-api` — all green.

- [ ] **Step 5: Commit**

```bash
git add apps/automation-api/src/runs/run.service.ts apps/automation-api/src/runs/run.service.spec.ts
git commit -m "feat(runs): add executeFlow for multi-step chains"
```

---

## Task 5: board types and errors

**Files:**
- Create: `apps/automation-api/src/boards/board.types.ts`
- Create: `apps/automation-api/src/boards/board.errors.ts`

- [ ] **Step 1: Write `board.types.ts`**

```ts
import type { WaitUntil } from '@socmint/browser-core';
import type { FlowRunRecord } from '../runs/run.types';

export interface ProfileNodeData {
  profileId: string | null;
}
export interface GotoNodeData {
  url: string;
  waitUntil?: WaitUntil;
  timeoutMs?: number;
}
export type ScreenshotNodeData = Record<string, never>;

interface NodeBase {
  id: string;
  position: { x: number; y: number };
}

export type BoardNode =
  | (NodeBase & { type: 'profile'; data: ProfileNodeData })
  | (NodeBase & { type: 'goto'; data: GotoNodeData })
  | (NodeBase & { type: 'screenshot'; data: ScreenshotNodeData });

export interface BoardEdge {
  id: string;
  source: string;
  target: string;
}

export interface BoardGraph {
  nodes: BoardNode[];
  edges: BoardEdge[];
}

export interface BoardRecord {
  id: string;
  name: string;
  graph: BoardGraph;
  createdAt: string;
  updatedAt: string;
}

export interface BoardRunRecord {
  id: string;
  boardId: string;
  startedAt: string;
  finishedAt: string;
  runs: FlowRunRecord[];
}
```

- [ ] **Step 2: Write `board.errors.ts`**

```ts
export class BoardNotFoundError extends Error {
  constructor(id: string) {
    super(`Board not found: ${id}`);
    this.name = 'BoardNotFoundError';
  }
}

export class BoardGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BoardGraphError';
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p apps/automation-api/tsconfig.app.json --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/automation-api/src/boards/board.types.ts apps/automation-api/src/boards/board.errors.ts
git commit -m "feat(boards): add board types and domain errors"
```

---

## Task 6: `resolveChains` pure function

**Files:**
- Create: `apps/automation-api/src/boards/resolve-chains.ts`
- Test: `apps/automation-api/src/boards/resolve-chains.spec.ts`

- [ ] **Step 1: Write the failing tests**

`apps/automation-api/src/boards/resolve-chains.spec.ts`:

```ts
import { resolveChains } from './resolve-chains';
import { BoardGraphError } from './board.errors';
import type { BoardGraph } from './board.types';

const pos = { x: 0, y: 0 };

function graph(nodes: BoardGraph['nodes'], edges: BoardGraph['edges']): BoardGraph {
  return { nodes, edges };
}

describe('resolveChains', () => {
  it('builds a linear chain from a profile node', () => {
    const g = graph(
      [
        { id: 'p', type: 'profile', position: pos, data: { profileId: 'prof-1' } },
        { id: 'g', type: 'goto', position: pos, data: { url: 'https://e' } },
        { id: 's', type: 'screenshot', position: pos, data: {} },
      ],
      [
        { id: 'e1', source: 'p', target: 'g' },
        { id: 'e2', source: 'g', target: 's' },
      ],
    );

    expect(resolveChains(g)).toEqual([
      { profileId: 'prof-1', steps: [{ type: 'goto', url: 'https://e' }, { type: 'screenshot' }] },
    ]);
  });

  it('returns one job per profile node', () => {
    const g = graph(
      [
        { id: 'p1', type: 'profile', position: pos, data: { profileId: 'a' } },
        { id: 'p2', type: 'profile', position: pos, data: { profileId: 'b' } },
        { id: 'g1', type: 'goto', position: pos, data: { url: 'https://a' } },
        { id: 'g2', type: 'goto', position: pos, data: { url: 'https://b' } },
      ],
      [
        { id: 'e1', source: 'p1', target: 'g1' },
        { id: 'e2', source: 'p2', target: 'g2' },
      ],
    );

    const jobs = resolveChains(g);
    expect(jobs).toHaveLength(2);
    expect(jobs.map((j) => j.profileId).sort()).toEqual(['a', 'b']);
  });

  it('skips a profile node wired to nothing', () => {
    const g = graph(
      [{ id: 'p', type: 'profile', position: pos, data: { profileId: 'a' } }],
      [],
    );
    expect(resolveChains(g)).toEqual([]);
  });

  it('throws when a node has more than one outgoing edge', () => {
    const g = graph(
      [
        { id: 'p', type: 'profile', position: pos, data: { profileId: 'a' } },
        { id: 'g1', type: 'goto', position: pos, data: { url: 'https://1' } },
        { id: 'g2', type: 'goto', position: pos, data: { url: 'https://2' } },
      ],
      [
        { id: 'e1', source: 'p', target: 'g1' },
        { id: 'e2', source: 'p', target: 'g2' },
      ],
    );
    expect(() => resolveChains(g)).toThrow(BoardGraphError);
  });

  it('throws when a profile node has no profile selected', () => {
    const g = graph(
      [
        { id: 'p', type: 'profile', position: pos, data: { profileId: null } },
        { id: 'g', type: 'goto', position: pos, data: { url: 'https://e' } },
      ],
      [{ id: 'e1', source: 'p', target: 'g' }],
    );
    expect(() => resolveChains(g)).toThrow(/no profile selected/i);
  });

  it('throws when a goto node has an empty url', () => {
    const g = graph(
      [
        { id: 'p', type: 'profile', position: pos, data: { profileId: 'a' } },
        { id: 'g', type: 'goto', position: pos, data: { url: '' } },
      ],
      [{ id: 'e1', source: 'p', target: 'g' }],
    );
    expect(() => resolveChains(g)).toThrow(/url/i);
  });

  it('throws when the same profile is used by two nodes', () => {
    const g = graph(
      [
        { id: 'p1', type: 'profile', position: pos, data: { profileId: 'dup' } },
        { id: 'p2', type: 'profile', position: pos, data: { profileId: 'dup' } },
        { id: 'g1', type: 'goto', position: pos, data: { url: 'https://1' } },
        { id: 'g2', type: 'goto', position: pos, data: { url: 'https://2' } },
      ],
      [
        { id: 'e1', source: 'p1', target: 'g1' },
        { id: 'e2', source: 'p2', target: 'g2' },
      ],
    );
    expect(() => resolveChains(g)).toThrow(/more than one node/i);
  });

  it('throws on a cycle', () => {
    const g = graph(
      [
        { id: 'p', type: 'profile', position: pos, data: { profileId: 'a' } },
        { id: 'g1', type: 'goto', position: pos, data: { url: 'https://1' } },
        { id: 'g2', type: 'goto', position: pos, data: { url: 'https://2' } },
      ],
      [
        { id: 'e1', source: 'p', target: 'g1' },
        { id: 'e2', source: 'g1', target: 'g2' },
        { id: 'e3', source: 'g2', target: 'g1' },
      ],
    );
    expect(() => resolveChains(g)).toThrow(/cycle/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx nx test automation-api -- -t "resolveChains"`
Expected: FAIL — cannot find module `./resolve-chains`.

- [ ] **Step 3: Implement `resolve-chains.ts`**

```ts
import { BoardGraphError } from './board.errors';
import type { BoardGraph, BoardNode } from './board.types';
import type { FlowStep } from '../runs/run.types';

export interface FlowJob {
  profileId: string;
  steps: FlowStep[];
}

export function resolveChains(graph: BoardGraph): FlowJob[] {
  const byId = new Map<string, BoardNode>(graph.nodes.map((n) => [n.id, n]));

  // Adjacency with the "at most one outgoing edge" rule enforced.
  const next = new Map<string, string>();
  for (const edge of graph.edges) {
    if (next.has(edge.source)) {
      throw new BoardGraphError(`Node ${edge.source} has multiple outgoing connections`);
    }
    next.set(edge.source, edge.target);
  }

  const profileNodes = graph.nodes.filter((n) => n.type === 'profile');

  // Duplicate-profile check across all profile nodes (ignoring null).
  const seen = new Set<string>();
  for (const node of profileNodes) {
    if (node.type !== 'profile') continue;
    const pid = node.data.profileId;
    if (pid === null) continue;
    if (seen.has(pid)) {
      throw new BoardGraphError(`Profile ${pid} is used by more than one node`);
    }
    seen.add(pid);
  }

  const jobs: FlowJob[] = [];
  for (const node of profileNodes) {
    if (node.type !== 'profile') continue;
    if (node.data.profileId === null) {
      throw new BoardGraphError(`Profile node ${node.id} has no profile selected`);
    }

    const steps: FlowStep[] = [];
    const visited = new Set<string>([node.id]);
    let current = node.id;
    for (;;) {
      const targetId = next.get(current);
      if (targetId === undefined) break;
      if (visited.has(targetId)) {
        throw new BoardGraphError(`Graph contains a cycle at node ${targetId}`);
      }
      visited.add(targetId);
      const target = byId.get(targetId);
      if (!target) throw new BoardGraphError(`Edge points to unknown node ${targetId}`);
      if (target.type === 'profile') {
        throw new BoardGraphError(`Profile node ${target.id} cannot appear inside a chain`);
      }
      if (target.type === 'goto') {
        if (!target.data.url || target.data.url.trim() === '') {
          throw new BoardGraphError(`Goto node ${target.id} has an empty url`);
        }
        steps.push({
          type: 'goto',
          url: target.data.url,
          waitUntil: target.data.waitUntil,
          timeoutMs: target.data.timeoutMs,
        });
      } else {
        steps.push({ type: 'screenshot' });
      }
      current = targetId;
    }

    if (steps.length > 0) {
      jobs.push({ profileId: node.data.profileId, steps });
    }
  }

  return jobs;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx nx test automation-api -- -t "resolveChains"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/automation-api/src/boards/resolve-chains.ts apps/automation-api/src/boards/resolve-chains.spec.ts
git commit -m "feat(boards): add resolveChains graph-to-steps resolver"
```

---

## Task 7: `BoardStore`

**Files:**
- Create: `apps/automation-api/src/boards/board.store.ts`
- Test: `apps/automation-api/src/boards/board.store.spec.ts`

- [ ] **Step 1: Write the failing tests**

`apps/automation-api/src/boards/board.store.spec.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BoardStore } from './board.store';
import type { BoardRecord } from './board.types';

function board(id: string, name: string): BoardRecord {
  return {
    id,
    name,
    graph: { nodes: [{ id: 'p', type: 'profile', position: { x: 1, y: 2 }, data: { profileId: 'x' } }], edges: [] },
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
  };
}

describe('BoardStore', () => {
  let dataRoot: string;
  let store: BoardStore;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'bs-'));
    store = new BoardStore(dataRoot);
  });
  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('round-trips a board including its graph', async () => {
    await store.write(board('b1', 'First'));
    const read = await store.read('b1');
    expect(read).toEqual(board('b1', 'First'));
  });

  it('returns null for a missing board', async () => {
    expect(await store.read('nope')).toBeNull();
  });

  it('lists all boards', async () => {
    await store.write(board('b1', 'First'));
    await store.write(board('b2', 'Second'));
    const ids = (await store.list()).map((b) => b.id).sort();
    expect(ids).toEqual(['b1', 'b2']);
  });

  it('removes a board', async () => {
    await store.write(board('b1', 'First'));
    await store.remove('b1');
    expect(await store.read('b1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx nx test automation-api -- -t "BoardStore"`
Expected: FAIL — cannot find module `./board.store`.

- [ ] **Step 3: Implement `board.store.ts`**

```ts
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { BoardRecord } from './board.types';

export class BoardStore {
  constructor(private readonly dataRoot: string) {}

  private boardsDir(): string {
    return resolve(this.dataRoot, 'boards');
  }

  private boardPath(id: string): string {
    if (!id || id.includes('..') || id.includes('/') || id.includes('\\')) {
      throw new Error(`Invalid board id: ${id}`);
    }
    return resolve(this.boardsDir(), `${id}.json`);
  }

  async write(board: BoardRecord): Promise<void> {
    await mkdir(this.boardsDir(), { recursive: true });
    await writeFile(this.boardPath(board.id), JSON.stringify(board, null, 2), 'utf8');
  }

  async read(id: string): Promise<BoardRecord | null> {
    try {
      const raw = await readFile(this.boardPath(id), 'utf8');
      return JSON.parse(raw) as BoardRecord;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async list(): Promise<BoardRecord[]> {
    let entries: string[];
    try {
      entries = await readdir(this.boardsDir());
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const boards: BoardRecord[] = [];
    for (const file of entries) {
      if (!file.endsWith('.json')) continue;
      const board = await this.read(file.slice(0, -'.json'.length));
      if (board) boards.push(board);
    }
    return boards;
  }

  async remove(id: string): Promise<void> {
    await rm(this.boardPath(id), { force: true });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx nx test automation-api -- -t "BoardStore"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/automation-api/src/boards/board.store.ts apps/automation-api/src/boards/board.store.spec.ts
git commit -m "feat(boards): add BoardStore JSON persistence"
```

---

## Task 8: `BoardService`

**Files:**
- Create: `apps/automation-api/src/boards/board.service.ts`
- Test: `apps/automation-api/src/boards/board.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

`apps/automation-api/src/boards/board.service.spec.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunService } from '../runs/run.service';
import { BoardStore } from './board.store';
import { BoardService } from './board.service';
import { BoardNotFoundError } from './board.errors';
import type { BoardGraph } from './board.types';

const pos = { x: 0, y: 0 };

describe('BoardService', () => {
  let dataRoot: string;
  let store: BoardStore;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'bsvc-'));
    store = new BoardStore(dataRoot);
  });
  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  function service(runs?: Partial<RunService>) {
    return new BoardService(store, runs as unknown as RunService);
  }

  it('creates an empty board with a name', async () => {
    const svc = service();
    const board = await svc.create({ name: 'My board' });
    expect(board.name).toBe('My board');
    expect(board.graph).toEqual({ nodes: [], edges: [] });
    expect(await store.read(board.id)).not.toBeNull();
  });

  it('updates name and graph', async () => {
    const svc = service();
    const board = await svc.create({ name: 'A' });
    const graph: BoardGraph = {
      nodes: [{ id: 'p', type: 'profile', position: pos, data: { profileId: 'x' } }],
      edges: [],
    };
    const updated = await svc.update(board.id, { name: 'B', graph });
    expect(updated.name).toBe('B');
    expect(updated.graph).toEqual(graph);
  });

  it('throws BoardNotFoundError for a missing board', async () => {
    const svc = service();
    await expect(svc.get('nope')).rejects.toBeInstanceOf(BoardNotFoundError);
  });

  it('run resolves chains and calls executeFlow once per profile', async () => {
    const executeFlow = jest
      .fn()
      .mockImplementation(async (profileId: string) => ({ id: `run-${profileId}`, profileId, status: 'completed', startedAt: '', finishedAt: '', error: null, steps: [] }));
    const svc = service({ executeFlow });
    const board = await svc.create({ name: 'A' });
    await svc.update(board.id, {
      graph: {
        nodes: [
          { id: 'p', type: 'profile', position: pos, data: { profileId: 'prof-1' } },
          { id: 'g', type: 'goto', position: pos, data: { url: 'https://e' } },
        ],
        edges: [{ id: 'e1', source: 'p', target: 'g' }],
      },
    });

    const result = await svc.run(board.id);

    expect(executeFlow).toHaveBeenCalledTimes(1);
    expect(executeFlow).toHaveBeenCalledWith('prof-1', [{ type: 'goto', url: 'https://e', waitUntil: undefined, timeoutMs: undefined }]);
    expect(result.boardId).toBe(board.id);
    expect(result.runs).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx nx test automation-api -- -t "BoardService"`
Expected: FAIL — cannot find module `./board.service`.

- [ ] **Step 3: Implement `board.service.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { RunService } from '../runs/run.service';
import type { FlowRunRecord } from '../runs/run.types';
import { BoardStore } from './board.store';
import { BoardNotFoundError } from './board.errors';
import { resolveChains } from './resolve-chains';
import type { BoardGraph, BoardRecord, BoardRunRecord } from './board.types';

export interface CreateBoardInput {
  name: string;
}
export interface UpdateBoardInput {
  name?: string;
  graph?: BoardGraph;
}

const EMPTY_GRAPH: BoardGraph = { nodes: [], edges: [] };

export class BoardService {
  constructor(
    private readonly store: BoardStore,
    private readonly runs: RunService,
  ) {}

  async create(input: CreateBoardInput): Promise<BoardRecord> {
    const now = new Date().toISOString();
    const board: BoardRecord = {
      id: randomUUID(),
      name: input.name,
      graph: EMPTY_GRAPH,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.write(board);
    return board;
  }

  async list(): Promise<BoardRecord[]> {
    return this.store.list();
  }

  async get(id: string): Promise<BoardRecord> {
    const board = await this.store.read(id);
    if (!board) throw new BoardNotFoundError(id);
    return board;
  }

  async update(id: string, input: UpdateBoardInput): Promise<BoardRecord> {
    const board = await this.get(id);
    const next: BoardRecord = {
      ...board,
      name: input.name ?? board.name,
      graph: input.graph ?? board.graph,
      updatedAt: new Date().toISOString(),
    };
    await this.store.write(next);
    return next;
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    await this.store.remove(id);
  }

  async run(id: string): Promise<BoardRunRecord> {
    const board = await this.get(id);
    const jobs = resolveChains(board.graph); // throws BoardGraphError on invalid graph
    const startedAt = new Date().toISOString();
    const runs: FlowRunRecord[] = await Promise.all(
      jobs.map((job) => this.runs.executeFlow(job.profileId, job.steps)),
    );
    return {
      id: randomUUID(),
      boardId: board.id,
      startedAt,
      finishedAt: new Date().toISOString(),
      runs,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx nx test automation-api -- -t "BoardService"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/automation-api/src/boards/board.service.ts apps/automation-api/src/boards/board.service.spec.ts
git commit -m "feat(boards): add BoardService CRUD and run orchestration"
```

---

## Task 9: board DTOs and response

**Files:**
- Create: `apps/automation-api/src/boards/dto.ts`
- Create: `apps/automation-api/src/boards/board.response.ts`
- Test: `apps/automation-api/src/boards/dto.spec.ts`

- [ ] **Step 1: Write the failing tests**

`apps/automation-api/src/boards/dto.spec.ts`:

```ts
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateBoardDto, UpdateBoardDto } from './dto';

function errorsFor(cls: any, payload: unknown) {
  return validateSync(plainToInstance(cls, payload), { whitelist: true });
}

describe('board DTOs', () => {
  it('accepts a valid create payload', () => {
    expect(errorsFor(CreateBoardDto, { name: 'Board A' })).toHaveLength(0);
  });

  it('rejects an empty create name', () => {
    expect(errorsFor(CreateBoardDto, { name: '' }).length).toBeGreaterThan(0);
  });

  it('accepts an update with a graph object', () => {
    const payload = { graph: { nodes: [], edges: [] } };
    expect(errorsFor(UpdateBoardDto, payload)).toHaveLength(0);
  });

  it('rejects an update whose graph is not an object', () => {
    expect(errorsFor(UpdateBoardDto, { graph: 'nope' }).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx nx test automation-api -- -t "board DTOs"`
Expected: FAIL — cannot find module `./dto`.

- [ ] **Step 3: Implement `dto.ts`**

The graph is stored verbatim and re-validated structurally by `resolveChains` at run time, so the DTO only checks the envelope (name string, graph is an object). This keeps the wire contract permissive while the run path stays strict.

```ts
import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { BoardGraph } from './board.types';

export class CreateBoardDto {
  @ApiProperty({ example: 'Warm-up board' })
  @IsString()
  @IsNotEmpty()
  name!: string;
}

export class UpdateBoardDto {
  @ApiPropertyOptional({ example: 'Renamed board' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({
    description: 'React Flow graph (nodes + edges), stored verbatim.',
    example: { nodes: [], edges: [] },
  })
  @IsOptional()
  @IsObject()
  graph?: BoardGraph;
}
```

- [ ] **Step 4: Implement `board.response.ts`**

```ts
import { ApiProperty } from '@nestjs/swagger';

export class BoardResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Warm-up board' })
  name!: string;

  @ApiProperty({
    description: 'React Flow graph (nodes + edges).',
    example: { nodes: [], edges: [] },
  })
  graph!: { nodes: unknown[]; edges: unknown[] };

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class BoardRunResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  boardId!: string;

  @ApiProperty({ format: 'date-time' })
  startedAt!: string;

  @ApiProperty({ format: 'date-time' })
  finishedAt!: string;

  @ApiProperty({ isArray: true, description: 'One FlowRunRecord per profile.' })
  runs!: unknown[];
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx nx test automation-api -- -t "board DTOs"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/automation-api/src/boards/dto.ts apps/automation-api/src/boards/board.response.ts apps/automation-api/src/boards/dto.spec.ts
git commit -m "feat(boards): add board DTOs and Swagger response types"
```

---

## Task 10: `BoardsController`, filter, and wiring

**Files:**
- Create: `apps/automation-api/src/boards/boards.controller.ts`
- Modify: `apps/automation-api/src/app/domain-exception.filter.ts`
- Modify: `apps/automation-api/src/app/app.module.ts`

- [ ] **Step 1: Implement `boards.controller.ts`**

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { BoardService } from './board.service';
import { CreateBoardDto, UpdateBoardDto } from './dto';
import { BoardResponseDto, BoardRunResponseDto } from './board.response';

@ApiTags('boards')
@Controller('boards')
export class BoardsController {
  constructor(private readonly boards: BoardService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create an automation board' })
  @ApiCreatedResponse({ type: BoardResponseDto })
  create(@Body() dto: CreateBoardDto) {
    return this.boards.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all boards' })
  @ApiOkResponse({ type: BoardResponseDto, isArray: true })
  list() {
    return this.boards.list();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a board by ID' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: BoardResponseDto })
  @ApiNotFoundResponse({ description: 'Board not found' })
  get(@Param('id') id: string) {
    return this.boards.get(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a board name and/or graph' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: BoardResponseDto })
  @ApiNotFoundResponse({ description: 'Board not found' })
  update(@Param('id') id: string, @Body() dto: UpdateBoardDto) {
    return this.boards.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a board' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Board deleted' })
  @ApiNotFoundResponse({ description: 'Board not found' })
  async remove(@Param('id') id: string) {
    await this.boards.remove(id);
  }

  @Post(':id/run')
  @HttpCode(201)
  @ApiOperation({ summary: 'Run a board: execute each profile chain in parallel' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiCreatedResponse({ type: BoardRunResponseDto })
  @ApiNotFoundResponse({ description: 'Board or profile not found' })
  run(@Param('id') id: string) {
    return this.boards.run(id);
  }
}
```

- [ ] **Step 2: Map the new errors in the exception filter**

Edit `apps/automation-api/src/app/domain-exception.filter.ts` to register the board errors:

```ts
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ProfileBusyError } from '../profiles/lock.service';
import {
  ProfileNotFoundError,
  ProfileRunningError,
} from '../profiles/profile.service';
import { BoardGraphError, BoardNotFoundError } from '../boards/board.errors';

@Catch(
  ProfileNotFoundError,
  ProfileRunningError,
  ProfileBusyError,
  BoardNotFoundError,
  BoardGraphError,
)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(err: Error, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    if (err instanceof ProfileNotFoundError || err instanceof BoardNotFoundError)
      status = HttpStatus.NOT_FOUND;
    else if (err instanceof ProfileRunningError || err instanceof ProfileBusyError)
      status = HttpStatus.CONFLICT;
    else if (err instanceof BoardGraphError) status = HttpStatus.BAD_REQUEST;
    res.status(status).json(new HttpException(err.message, status).getResponse());
  }
}
```

- [ ] **Step 3: Wire providers in `app.module.ts`**

Edit `apps/automation-api/src/app/app.module.ts`: add imports, register `BoardsController`, and add `BoardStore` + `BoardService` providers.

Add imports near the others:

```ts
import { BoardStore } from '../boards/board.store';
import { BoardService } from '../boards/board.service';
import { BoardsController } from '../boards/boards.controller';
```

Add `BoardsController` to the `controllers` array:

```ts
  controllers: [ProfilesController, RunsController, SessionsController, BoardsController],
```

Add these two providers to the `providers` array (after the `RunService` provider):

```ts
    {
      provide: BoardStore,
      useFactory: (cfg: AppConfig) => new BoardStore(cfg.dataRoot),
      inject: [APP_CONFIG],
    },
    {
      provide: BoardService,
      useFactory: (store: BoardStore, runs: RunService) => new BoardService(store, runs),
      inject: [BoardStore, RunService],
    },
```

- [ ] **Step 4: Build and run the full backend suite**

Run: `npx nx test automation-api && npx nx build automation-api`
Expected: PASS / build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/automation-api/src/boards/boards.controller.ts apps/automation-api/src/app/domain-exception.filter.ts apps/automation-api/src/app/app.module.ts
git commit -m "feat(boards): add BoardsController, wire module, map board errors"
```

---

## Task 11: board-run e2e

**Files:**
- Create: `apps/automation-api/src/e2e/board-run.e2e.spec.ts`

- [ ] **Step 1: Write the e2e test**

Mirrors `run-flow.e2e.spec.ts` (gated by `RUN_E2E=1`, uses real Chromium via CloakBrowser; headless profile).

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app/app.module';
import { DomainExceptionFilter } from '../app/domain-exception.filter';

const maybe = process.env.RUN_E2E === '1' ? describe : describe.skip;

maybe('board run (e2e)', () => {
  let app: INestApplication;
  let dataRoot: string;
  let artifactsRoot: string;

  beforeAll(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'socmint-e2e-bdata-'));
    artifactsRoot = await mkdtemp(join(tmpdir(), 'socmint-e2e-bart-'));
    process.env.DATA_ROOT = dataRoot;
    process.env.ARTIFACTS_ROOT = artifactsRoot;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.init();
  }, 120000);

  afterAll(async () => {
    await app?.close();
    await rm(dataRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  });

  it('creates a profile + board, wires a chain, then runs it', async () => {
    const profile = await request(app.getHttpServer())
      .post('/profiles')
      .send({ label: 'e2e-board', launchDefaults: { headless: true } })
      .expect(201);

    const board = await request(app.getHttpServer())
      .post('/boards')
      .send({ name: 'e2e board' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/boards/${board.body.id}`)
      .send({
        graph: {
          nodes: [
            { id: 'p', type: 'profile', position: { x: 0, y: 0 }, data: { profileId: profile.body.id } },
            { id: 'g', type: 'goto', position: { x: 200, y: 0 }, data: { url: 'https://example.com' } },
          ],
          edges: [{ id: 'e1', source: 'p', target: 'g' }],
        },
      })
      .expect(200);

    const run = await request(app.getHttpServer())
      .post(`/boards/${board.body.id}/run`)
      .send()
      .expect(201);

    expect(run.body.runs).toHaveLength(1);
    expect(run.body.runs[0].status).toBe('completed');
  }, 120000);

  it('returns 400 for an invalid graph (branching)', async () => {
    const profile = await request(app.getHttpServer())
      .post('/profiles')
      .send({ label: 'e2e-board-bad', launchDefaults: { headless: true } })
      .expect(201);

    const board = await request(app.getHttpServer())
      .post('/boards')
      .send({ name: 'bad board' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/boards/${board.body.id}`)
      .send({
        graph: {
          nodes: [
            { id: 'p', type: 'profile', position: { x: 0, y: 0 }, data: { profileId: profile.body.id } },
            { id: 'g1', type: 'goto', position: { x: 1, y: 0 }, data: { url: 'https://a' } },
            { id: 'g2', type: 'goto', position: { x: 1, y: 1 }, data: { url: 'https://b' } },
          ],
          edges: [
            { id: 'e1', source: 'p', target: 'g1' },
            { id: 'e2', source: 'p', target: 'g2' },
          ],
        },
      })
      .expect(200);

    await request(app.getHttpServer()).post(`/boards/${board.body.id}/run`).send().expect(400);
  }, 120000);
});
```

- [ ] **Step 2: Verify it is skipped in the normal run**

Run: `npx nx test automation-api`
Expected: PASS; the e2e suite shows as skipped (no `RUN_E2E`).

- [ ] **Step 3: Commit**

```bash
git add apps/automation-api/src/e2e/board-run.e2e.spec.ts
git commit -m "test(boards): add board-run e2e (gated by RUN_E2E)"
```

---

## Task 12: frontend api client — board types and methods

**Files:**
- Modify: `apps/web/src/api/client.ts`

- [ ] **Step 1: Add board graph types and API methods**

Append to `apps/web/src/api/client.ts` (after the existing `Profile` interface / `api` object — add the types near the top and extend the `api` object):

```ts
export type WaitUntil = 'load' | 'domcontentloaded' | 'commit';

export interface ProfileNodeData {
  profileId: string | null;
}
export interface GotoNodeData {
  url: string;
  waitUntil?: WaitUntil;
  timeoutMs?: number;
}
export type BoardNodeData = ProfileNodeData | GotoNodeData | Record<string, never>;

export interface BoardNode {
  id: string;
  type: 'profile' | 'goto' | 'screenshot';
  position: { x: number; y: number };
  data: BoardNodeData;
}
export interface BoardEdge {
  id: string;
  source: string;
  target: string;
}
export interface BoardGraph {
  nodes: BoardNode[];
  edges: BoardEdge[];
}
export interface Board {
  id: string;
  name: string;
  graph: BoardGraph;
  createdAt: string;
  updatedAt: string;
}

export interface FlowStepRecord {
  type: 'goto' | 'screenshot';
  status: 'completed' | 'failed';
  error: string | null;
  title?: string;
  finalUrl?: string;
  screenshot?: string | null;
}
export interface FlowRunRecord {
  id: string;
  profileId: string;
  status: 'completed' | 'failed';
  startedAt: string;
  finishedAt: string;
  error: string | null;
  steps: FlowStepRecord[];
}
export interface BoardRunRecord {
  id: string;
  boardId: string;
  startedAt: string;
  finishedAt: string;
  runs: FlowRunRecord[];
}
```

Add these methods inside the `api` object (before the closing `};`):

```ts
  listBoards: () => req<Board[]>('/boards'),
  getBoard: (id: string) => req<Board>(`/boards/${id}`),
  createBoard: (body: { name: string }) =>
    req<Board>('/boards', { method: 'POST', body: JSON.stringify(body) }),
  updateBoard: (id: string, body: { name?: string; graph?: BoardGraph }) =>
    req<Board>(`/boards/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteBoard: (id: string) => req<void>(`/boards/${id}`, { method: 'DELETE' }),
  runBoard: (id: string) =>
    req<BoardRunRecord>(`/boards/${id}/run`, { method: 'POST' }),
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p apps/web/tsconfig.app.json --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/api/client.ts
git commit -m "feat(web): add board graph types and board API methods"
```

---

## Task 13: graph validation helper

**Files:**
- Create: `apps/web/src/components/automation/graph-validation.ts`
- Test: `apps/web/src/components/automation/graph-validation.spec.ts`

This mirrors the backend's structural rules so the UI can block Run and highlight bad nodes before sending.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/components/automation/graph-validation.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateGraph } from './graph-validation';
import type { BoardGraph } from '../../api/client';

const pos = { x: 0, y: 0 };

describe('validateGraph', () => {
  it('returns no errors for a valid linear chain', () => {
    const g: BoardGraph = {
      nodes: [
        { id: 'p', type: 'profile', position: pos, data: { profileId: 'a' } },
        { id: 'g', type: 'goto', position: pos, data: { url: 'https://e' } },
      ],
      edges: [{ id: 'e1', source: 'p', target: 'g' }],
    };
    expect(validateGraph(g)).toEqual([]);
  });

  it('flags a profile node with no profile', () => {
    const g: BoardGraph = {
      nodes: [{ id: 'p', type: 'profile', position: pos, data: { profileId: null } }],
      edges: [],
    };
    const errs = validateGraph(g);
    expect(errs.some((e) => e.nodeId === 'p')).toBe(true);
  });

  it('flags a node with multiple outgoing edges', () => {
    const g: BoardGraph = {
      nodes: [
        { id: 'p', type: 'profile', position: pos, data: { profileId: 'a' } },
        { id: 'g1', type: 'goto', position: pos, data: { url: 'https://1' } },
        { id: 'g2', type: 'goto', position: pos, data: { url: 'https://2' } },
      ],
      edges: [
        { id: 'e1', source: 'p', target: 'g1' },
        { id: 'e2', source: 'p', target: 'g2' },
      ],
    };
    expect(validateGraph(g).some((e) => e.nodeId === 'p')).toBe(true);
  });

  it('flags an empty goto url and a duplicate profile', () => {
    const g: BoardGraph = {
      nodes: [
        { id: 'p1', type: 'profile', position: pos, data: { profileId: 'dup' } },
        { id: 'p2', type: 'profile', position: pos, data: { profileId: 'dup' } },
        { id: 'g', type: 'goto', position: pos, data: { url: '' } },
      ],
      edges: [
        { id: 'e1', source: 'p1', target: 'g' },
        { id: 'e2', source: 'p2', target: 'g' },
      ],
    };
    const errs = validateGraph(g);
    expect(errs.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx nx test web -- graph-validation`
Expected: FAIL — cannot find module `./graph-validation`.

- [ ] **Step 3: Implement `graph-validation.ts`**

```ts
import type { BoardGraph, GotoNodeData, ProfileNodeData } from '../../api/client';

export interface GraphError {
  nodeId: string;
  message: string;
}

export function validateGraph(graph: BoardGraph): GraphError[] {
  const errors: GraphError[] = [];

  const outgoing = new Map<string, number>();
  for (const edge of graph.edges) {
    outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1);
  }
  for (const [nodeId, count] of outgoing) {
    if (count > 1) {
      errors.push({ nodeId, message: 'Node has more than one outgoing connection' });
    }
  }

  const profileIds = new Map<string, number>();
  for (const node of graph.nodes) {
    if (node.type === 'profile') {
      const pid = (node.data as ProfileNodeData).profileId;
      if (pid === null) {
        errors.push({ nodeId: node.id, message: 'No profile selected' });
      } else {
        profileIds.set(pid, (profileIds.get(pid) ?? 0) + 1);
      }
    } else if (node.type === 'goto') {
      const url = (node.data as GotoNodeData).url;
      if (!url || url.trim() === '') {
        errors.push({ nodeId: node.id, message: 'Goto URL is empty' });
      }
    }
  }
  for (const node of graph.nodes) {
    if (node.type === 'profile') {
      const pid = (node.data as ProfileNodeData).profileId;
      if (pid !== null && (profileIds.get(pid) ?? 0) > 1) {
        errors.push({ nodeId: node.id, message: 'Profile is used by more than one node' });
      }
    }
  }

  return errors;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx nx test web -- graph-validation`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/automation/graph-validation.ts apps/web/src/components/automation/graph-validation.spec.ts
git commit -m "feat(web): add client-side board graph validation"
```

---

## Task 14: install React Flow + node components

**Files:**
- Modify: `package.json` (via pnpm)
- Create: `apps/web/src/components/automation/nodes/profile-node.tsx`
- Create: `apps/web/src/components/automation/nodes/goto-node.tsx`
- Create: `apps/web/src/components/automation/nodes/screenshot-node.tsx`

- [ ] **Step 1: Install React Flow v12**

Run: `pnpm add @xyflow/react`
Expected: `@xyflow/react` appears in `package.json` dependencies.

- [ ] **Step 2: Implement `profile-node.tsx`**

```tsx
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { Profile } from '../../../api/client';

export interface ProfileNodeProps extends NodeProps {
  data: {
    profileId: string | null;
    profiles?: Profile[];
    onChange?: (profileId: string | null) => void;
  };
}

export function ProfileNode({ data }: ProfileNodeProps) {
  const profiles = data.profiles ?? [];
  return (
    <div className="min-w-44 border-2 border-foreground bg-background">
      <div className="border-b-2 border-foreground bg-foreground px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-background">
        Profile
      </div>
      <div className="p-2">
        <select
          className="w-full border-2 border-foreground bg-background px-2 py-1 font-mono text-xs"
          value={data.profileId ?? ''}
          onChange={(e) => data.onChange?.(e.target.value || null)}
        >
          <option value="">— select profile —</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
```

- [ ] **Step 3: Implement `goto-node.tsx`**

```tsx
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { WaitUntil } from '../../../api/client';

export interface GotoNodeProps extends NodeProps {
  data: {
    url: string;
    waitUntil?: WaitUntil;
    onChange?: (patch: { url?: string; waitUntil?: WaitUntil }) => void;
  };
}

export function GotoNode({ data }: GotoNodeProps) {
  return (
    <div className="min-w-52 border-2 border-foreground bg-background">
      <Handle type="target" position={Position.Left} />
      <div className="border-b-2 border-foreground bg-foreground px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-background">
        Goto
      </div>
      <div className="space-y-2 p-2">
        <input
          className="w-full border-2 border-foreground bg-background px-2 py-1 font-mono text-xs"
          placeholder="https://…"
          value={data.url}
          onChange={(e) => data.onChange?.({ url: e.target.value })}
        />
        <select
          className="w-full border-2 border-foreground bg-background px-2 py-1 font-mono text-[10px] uppercase"
          value={data.waitUntil ?? 'load'}
          onChange={(e) => data.onChange?.({ waitUntil: e.target.value as WaitUntil })}
        >
          <option value="load">load</option>
          <option value="domcontentloaded">domcontentloaded</option>
          <option value="commit">commit</option>
        </select>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
```

- [ ] **Step 4: Implement `screenshot-node.tsx`**

```tsx
import { Handle, Position, type NodeProps } from '@xyflow/react';

export function ScreenshotNode(_props: NodeProps) {
  return (
    <div className="min-w-40 border-2 border-foreground bg-background">
      <Handle type="target" position={Position.Left} />
      <div className="border-b-2 border-foreground bg-foreground px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-background">
        Screenshot
      </div>
      <div className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        full page
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc -p apps/web/tsconfig.app.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml apps/web/src/components/automation/nodes
git commit -m "feat(web): add React Flow and board node components"
```

---

## Task 15: flow canvas

**Files:**
- Create: `apps/web/src/components/automation/flow-canvas.tsx`

- [ ] **Step 1: Implement `flow-canvas.tsx`**

The canvas seeds React Flow state from `board.graph`, injects `profiles`/`onChange` into node data, autosaves on change (debounced), validates before Run, and renders a results panel.

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { api, type Board, type BoardGraph, type BoardRunRecord, type Profile, type WaitUntil } from '../../api/client';
import { validateGraph } from './graph-validation';
import { ProfileNode } from './nodes/profile-node';
import { GotoNode } from './nodes/goto-node';
import { ScreenshotNode } from './nodes/screenshot-node';
import { Button } from '../ui/button';

const nodeTypes = { profile: ProfileNode, goto: GotoNode, screenshot: ScreenshotNode };

let counter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now()}-${counter++}`;

function toGraph(nodes: Node[], edges: Edge[]): BoardGraph {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type as BoardGraph['nodes'][number]['type'],
      position: n.position,
      // strip injected callbacks/profiles before persisting
      data: stripData(n.type, n.data),
    })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
  };
}

function stripData(type: string | undefined, data: Record<string, unknown>) {
  if (type === 'profile') return { profileId: (data.profileId as string | null) ?? null };
  if (type === 'goto') return { url: (data.url as string) ?? '', waitUntil: data.waitUntil as WaitUntil | undefined };
  return {};
}

export function FlowCanvas({ board, profiles }: { board: Board; profiles: Profile[] }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BoardRunRecord | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydrated = useRef(false);

  // Update one node's data field (used by node onChange callbacks).
  const patchNodeData = useCallback(
    (id: string, patch: Record<string, unknown>) => {
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
    },
    [setNodes],
  );

  // Seed from board graph once, injecting profiles + onChange callbacks.
  useEffect(() => {
    const seeded: Node[] = board.graph.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: injectData(n.type, n.data as Record<string, unknown>, n.id),
    }));
    setNodes(seeded);
    setEdges(board.graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })));
    hydrated.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.id]);

  function injectData(type: string, data: Record<string, unknown>, id: string) {
    if (type === 'profile') {
      return {
        profileId: (data.profileId as string | null) ?? null,
        profiles,
        onChange: (profileId: string | null) => patchNodeData(id, { profileId }),
      };
    }
    if (type === 'goto') {
      return {
        url: (data.url as string) ?? '',
        waitUntil: data.waitUntil as WaitUntil | undefined,
        onChange: (patch: Record<string, unknown>) => patchNodeData(id, patch),
      };
    }
    return {};
  }

  // Keep profiles fresh inside profile nodes.
  useEffect(() => {
    setNodes((ns) => ns.map((n) => (n.type === 'profile' ? { ...n, data: { ...n.data, profiles } } : n)));
  }, [profiles, setNodes]);

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge({ ...c, id: newId('e') }, eds)),
    [setEdges],
  );

  const addNode = (type: 'profile' | 'goto' | 'screenshot') => {
    const id = newId(type);
    const position = { x: 80 + Math.random() * 240, y: 80 + Math.random() * 240 };
    setNodes((ns) => [...ns, { id, type, position, data: injectData(type, {}, id) }]);
  };

  // Debounced autosave.
  useEffect(() => {
    if (!hydrated.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        await api.updateBoard(board.id, { graph: toGraph(nodes, edges) });
      } finally {
        setSaving(false);
      }
    }, 800);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [nodes, edges, board.id]);

  const validation = useMemo(() => validateGraph(toGraph(nodes, edges)), [nodes, edges]);

  const run = async () => {
    setErrorMsg(null);
    if (validation.length > 0) {
      setErrorMsg(validation.map((e) => e.message).join('; '));
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      // Persist latest graph before running.
      await api.updateBoard(board.id, { graph: toGraph(nodes, edges) });
      setResult(await api.runBoard(board.id));
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Run failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b-2 border-foreground px-4 py-3">
        <Button onClick={() => addNode('profile')} className="gap-1 text-xs">+ Profile</Button>
        <Button onClick={() => addNode('goto')} className="gap-1 text-xs">+ Goto</Button>
        <Button onClick={() => addNode('screenshot')} className="gap-1 text-xs">+ Screenshot</Button>
        <div className="ml-auto flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {saving ? 'Saving…' : 'Saved'}
          </span>
          <Button onClick={run} disabled={running} className="text-xs">
            {running ? 'Running…' : 'Run'}
          </Button>
        </div>
      </div>

      {errorMsg && (
        <p className="shrink-0 border-b-2 border-foreground bg-foreground px-4 py-2 font-mono text-xs uppercase tracking-widest text-background">
          {errorMsg}
        </p>
      )}

      <div className="min-h-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>

      {result && (
        <div className="max-h-48 shrink-0 overflow-auto border-t-2 border-foreground px-4 py-3">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Run results
          </p>
          <ul className="space-y-1">
            {result.runs.map((r) => (
              <li key={r.id} className="font-mono text-xs">
                {r.profileId} — {r.status}
                {r.error ? ` (${r.error})` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p apps/web/tsconfig.app.json --noEmit`
Expected: no errors. (If `Button` does not accept `onClick`/`disabled`, confirm its props in `apps/web/src/components/ui/button.tsx` and adjust — it wraps a native `<button>`.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/automation/flow-canvas.tsx
git commit -m "feat(web): add React Flow board canvas with autosave and run"
```

---

## Task 16: `use-boards` hook

**Files:**
- Create: `apps/web/src/hooks/use-boards.ts`
- Test: `apps/web/src/hooks/use-boards.spec.tsx`

- [ ] **Step 1: Write the failing tests**

`apps/web/src/hooks/use-boards.spec.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useBoards } from './use-boards';

const sample = [{ id: 'b1', name: 'A', graph: { nodes: [], edges: [] }, createdAt: '', updatedAt: '' }];

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/boards' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify(sample), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url === '/api/boards' && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'b2', name: 'New', graph: { nodes: [], edges: [] }, createdAt: '', updatedAt: '' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('null', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('useBoards', () => {
  it('loads boards on mount', async () => {
    const { result } = renderHook(() => useBoards());
    await waitFor(() => expect(result.current.boards).toHaveLength(1));
    expect(result.current.boards[0].id).toBe('b1');
  });

  it('creates a board and refreshes', async () => {
    const { result } = renderHook(() => useBoards());
    await waitFor(() => expect(result.current.boards).toHaveLength(1));
    await act(async () => {
      await result.current.create('New');
    });
    expect(fetch).toHaveBeenCalledWith('/api/boards', expect.objectContaining({ method: 'POST' }));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx nx test web -- use-boards`
Expected: FAIL — cannot find module `./use-boards`.

- [ ] **Step 3: Implement `use-boards.ts`**

```ts
import { useCallback, useEffect, useState } from 'react';
import { api, type Board } from '../api/client';

export function useBoards() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await api.listBoards();
      setBoards(next);
      setError(null);
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load boards');
      return null;
    }
  }, []);

  const create = useCallback(
    async (name: string) => {
      const created = await api.createBoard({ name });
      await refresh();
      return created;
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await api.deleteBoard(id);
      await refresh();
    },
    [refresh],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { boards, error, refresh, create, remove };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx nx test web -- use-boards`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/use-boards.ts apps/web/src/hooks/use-boards.spec.tsx
git commit -m "feat(web): add useBoards hook"
```

---

## Task 17: board list + automation page

**Files:**
- Create: `apps/web/src/components/automation/board-list.tsx`
- Create: `apps/web/src/components/automation/automation-page.tsx`

- [ ] **Step 1: Implement `board-list.tsx`**

```tsx
import type { Board } from '../../api/client';
import { Button } from '../ui/button';

export function BoardList({
  boards,
  selectedId,
  onSelect,
  onCreate,
  onDelete,
}: {
  boards: Board[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r-2 border-foreground">
      <div className="flex items-center justify-between border-b-2 border-foreground px-4 py-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Boards</span>
        <Button onClick={onCreate} className="text-xs">+ New</Button>
      </div>
      <ul className="min-h-0 flex-1 overflow-auto">
        {boards.map((b) => (
          <li key={b.id} className="border-b border-border-light">
            <button
              onClick={() => onSelect(b.id)}
              className={`flex w-full items-center justify-between px-4 py-3 text-left font-mono text-xs ${
                b.id === selectedId ? 'bg-foreground text-background' : ''
              }`}
            >
              <span className="truncate">{b.name}</span>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(b.id);
                }}
                className="ml-2 shrink-0 opacity-60 hover:opacity-100"
              >
                ✕
              </span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
```

- [ ] **Step 2: Implement `automation-page.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { api, type Board } from '../../api/client';
import { useBoards } from '../../hooks/use-boards';
import { useProfiles } from '../../hooks/use-profiles';
import { BoardList } from './board-list';
import { FlowCanvas } from './flow-canvas';

export function AutomationPage() {
  const { boards, create, remove } = useBoards();
  const { profiles } = useProfiles();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [board, setBoard] = useState<Board | null>(null);

  // Default selection to the first board.
  useEffect(() => {
    if (!selectedId && boards.length > 0) setSelectedId(boards[0].id);
  }, [boards, selectedId]);

  // Load the full board (with graph) when selection changes.
  useEffect(() => {
    if (!selectedId) {
      setBoard(null);
      return;
    }
    void api.getBoard(selectedId).then(setBoard);
  }, [selectedId]);

  const handleCreate = async () => {
    const created = await create(`Board ${boards.length + 1}`);
    setSelectedId(created.id);
  };

  const handleDelete = async (id: string) => {
    await remove(id);
    if (id === selectedId) setSelectedId(null);
  };

  return (
    <div className="flex min-h-0 flex-1">
      <BoardList
        boards={boards}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onCreate={handleCreate}
        onDelete={handleDelete}
      />
      <div className="min-h-0 min-w-0 flex-1">
        {board ? (
          <FlowCanvas key={board.id} board={board} profiles={profiles} />
        ) : (
          <div className="flex h-full items-center justify-center font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Select or create a board
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p apps/web/tsconfig.app.json --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/automation/board-list.tsx apps/web/src/components/automation/automation-page.tsx
git commit -m "feat(web): add board list and automation page"
```

---

## Task 18: navigation + app shell

**Files:**
- Create: `apps/web/src/components/profiles-page.tsx`
- Modify: `apps/web/src/components/profile-nav.tsx`
- Modify: `apps/web/src/app.tsx`

- [ ] **Step 1: Extract the current Profiles view into `profiles-page.tsx`**

Move the existing profiles content (header + error + table + handlers) out of `app.tsx`:

```tsx
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../api/client';
import { useProfiles } from '../hooks/use-profiles';
import { ProfileTable } from './profile-table';
import { CreateProfileDialog } from './create-profile-dialog';

export function ProfilesPage() {
  const { profiles, error, refresh } = useProfiles();

  const handleCreate = async (body: { label: string; proxy: string | null }) => {
    try {
      const created = await api.createProfile(body);
      await api.openLoginSession(created.id);
      toast('Browser opening — log in, then close the window to save.');
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create profile');
    }
  };

  const handleLogin = async (id: string) => {
    try {
      await api.openLoginSession(id);
      toast('Browser opening — log in, then close the window to save.');
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to open login session');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteProfile(id);
      toast('Profile deleted.');
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete profile');
    }
  };

  return (
    <>
      <header className="flex shrink-0 items-center justify-between gap-4 border-b-2 border-foreground px-8 py-6 lg:px-10">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Profiles</h1>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            CloakBrowser · session capture · local
          </p>
        </div>
        <CreateProfileDialog
          onCreate={handleCreate}
          triggerLabel="New profile"
          triggerClassName="gap-2"
          triggerIcon={<Plus size={16} strokeWidth={1.5} />}
        />
      </header>

      {error && (
        <p className="mx-8 mt-4 shrink-0 border-2 border-foreground bg-foreground px-4 py-3 font-mono text-xs uppercase tracking-widest text-background lg:mx-10">
          {error}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto px-8 py-6 lg:px-10">
        <ProfileTable profiles={profiles} onLogin={handleLogin} onDelete={handleDelete} />
      </div>
    </>
  );
}
```

- [ ] **Step 2: Update `profile-nav.tsx` to add the Automation tab**

Replace the file with an active-aware nav driven by hash links:

```tsx
export type NavSection = 'profiles' | 'automation';

export function ProfileNav({ count, active }: { count: number; active: NavSection }) {
  const item = (section: NavSection, label: string) => (
    <a
      href={`#${section}`}
      aria-current={active === section ? 'page' : undefined}
      className={`block border-b border-border-light px-5 py-4 font-mono text-xs uppercase tracking-widest ${
        active === section ? 'bg-foreground text-background' : 'text-foreground'
      }`}
    >
      {label}
    </a>
  );

  return (
    <aside
      className="flex h-screen w-56 shrink-0 flex-col border-r-2 border-foreground bg-background"
      aria-label="Sections"
    >
      <div className="border-b-2 border-foreground px-5 py-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Socmint</p>
      </div>

      <nav className="flex-1 py-2">
        {item('profiles', 'Profiles')}
        {item('automation', 'Automation')}
      </nav>

      <div className="border-t-2 border-foreground px-5 py-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {count} profile{count === 1 ? '' : 's'}
        </p>
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: Rewrite `app.tsx` as a hash-routed shell**

```tsx
import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { useProfiles } from './hooks/use-profiles';
import { ProfileNav, type NavSection } from './components/profile-nav';
import { ProfilesPage } from './components/profiles-page';
import { AutomationPage } from './components/automation/automation-page';

function useHashSection(): NavSection {
  const read = (): NavSection => (window.location.hash === '#automation' ? 'automation' : 'profiles');
  const [section, setSection] = useState<NavSection>(read);
  useEffect(() => {
    const onHash = () => setSection(read());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return section;
}

export function App() {
  const section = useHashSection();
  const { profiles } = useProfiles();

  return (
    <div className="flex min-h-screen">
      <ProfileNav count={profiles.length} active={section} />

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {section === 'automation' ? <AutomationPage /> : <ProfilesPage />}
      </main>

      <Toaster
        position="bottom-right"
        toastOptions={{
          unstyled: true,
          classNames: {
            toast:
              'border-2 border-foreground bg-background px-4 py-3 font-mono text-xs uppercase tracking-widest text-foreground',
            error:
              'border-2 border-foreground bg-foreground px-4 py-3 font-mono text-xs uppercase tracking-widest text-background',
          },
        }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run the web suite + typecheck**

Run: `npx nx test web && npx tsc -p apps/web/tsconfig.app.json --noEmit`
Expected: PASS / no errors. (Existing `profile-nav.spec.tsx` may assert the old single-link nav — update it to pass `active="profiles"` and expect both nav items.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/profiles-page.tsx apps/web/src/components/profile-nav.tsx apps/web/src/components/profile-nav.spec.tsx apps/web/src/app.tsx
git commit -m "feat(web): add Automation tab and hash-routed app shell"
```

---

## Task 19: Manual verification

**Files:** none (manual).

- [ ] **Step 1: Start both apps**

Run (two terminals): `npx nx serve automation-api` and `npx nx serve web`.
Expected: API on its configured port; web dev server proxies `/api`.

- [ ] **Step 2: Exercise the feature**

1. Open the web app, create a profile under **Profiles**, and complete login so it is usable.
2. Switch to **Automation**, create a board.
3. Add a Profile node (select the profile), a Goto node (`https://example.com`), a Screenshot node. Wire Profile → Goto → Screenshot.
4. Confirm "Saved" appears after edits stop.
5. Click **Run**. Expect a result row `… — completed`.
6. Confirm `artifacts/runs/<runId>/step-2.png` exists for the screenshot node.

- [ ] **Step 3: Verify invalid-graph handling**

Add a second Goto from the Profile node (two outgoing edges) and click Run. Expect the error banner to block the run (client validation) before any request.

---

## Self-Review Notes

- **Spec coverage:** Navigation (T18), board persistence/CRUD (T7,T8,T10), graph→steps resolution + constraints (T6), multi-step execution (T2,T4), parallel run (T8), node vocabulary Goto/Screenshot (T14), board node + action nodes on one canvas (T14,T15), client+server validation (T6,T13), result reporting (T15), testing per layer (every task) — all mapped.
- **Type consistency:** `FlowStep` (runs) → `resolveChains` output → `executeFlow` input match. `ResolvedFlowStep`/`FlowStepResult` (browser-core) consumed only by `executeFlow`. `BoardGraph`/`BoardNode` defined identically on backend (T5) and frontend (T12).
- **Out of scope (unchanged from spec):** extra action nodes, branching/looping, scheduling, retries, shared chains, persisted run history UI.
