# Board Result Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a terminal **Result** node (`pass` / `fail`) to automation boards; runs emit result marker records, Result nodes and sidebar board rows show ephemeral pass/fail color for the current session.

**Architecture:** Result compiles to a no-op marker step `{ type: 'result', nodeId, kind }` through the existing chain registry → `resolveChains` → `runFlow` pipeline. `FlowCanvas` reads returned `FlowStepRecord` items, colors reached Result nodes, and reports aggregated board status upward to `BoardList`. Status is session-only (no board JSON or API persistence).

**Tech Stack:** Nx monorepo. NestJS + Jest (`automation-api`). `libs/browser-core` (runFlow). React + Vitest (`web`).

Spec: `docs/superpowers/specs/2026-06-07-board-result-node-design.md`.

Harness features: `board-result-node-execution`, `board-result-sidebar-status`.

---

## File Structure

**`apps/automation-api/src/boards/`**
- `board.types.ts` (modify) — `ResultKind`, `ResultNodeData`, `{ type: 'result' }` in `BoardNode`
- `node-registry.ts` (modify) — `result.toSteps`, `terminal?: boolean` on `ChainOutput`
- `resolve-chains.ts` (modify) — stop traversal after terminal nodes
- `resolve-chains.spec.ts` (modify) — compile + terminal + if-branch tests

**`apps/automation-api/src/runs/`**
- `run.types.ts` (modify) — `result` in `FlowStep` and `FlowStepRecord`
- `run.service.ts` (modify) — `resolveFlowSteps` + `stepRecords` mapping for `result`
- `run.service.spec.ts` (modify) — result record mapping test

**`libs/browser-core/src/lib/`**
- `types.ts` (modify) — `result` in `ResolvedFlowStep` / `FlowStepResult`
- `cloak-browser.service.ts` (modify) — handle `result` marker in `runFlow` + `failResult`
- `cloak-browser.service.spec.ts` (modify) — result marker tests

**`apps/web/src/`**
- `api/client.ts` (modify) — mirror API types including `result`
- `components/automation/board-result-status.ts` (new) — pure aggregation helpers
- `components/automation/board-result-status.spec.ts` (new)
- `components/automation/nodes/result-node.tsx` (new)
- `components/automation/nodes/registry.ts` (modify) — result descriptor, `NODE_ORDER`, `nodeTypes`
- `components/automation/node-palette.tsx` (modify) — palette entry if not auto-derived
- `components/automation/flow-canvas.tsx` (modify) — runtime state, run handler, `onBoardResult` prop
- `components/automation/automation-page.tsx` (modify) — session `boardStatuses` state
- `components/automation/automation-sidebar.tsx` (modify) — pass `boardStatuses` through
- `components/automation/board-list.tsx` (modify) — pass/fail row styling
- `components/automation/board-list.spec.tsx` (new) — row class tests

---

## Task 1: Shared API types for Result node

**Files:**
- Modify: `apps/automation-api/src/boards/board.types.ts`
- Modify: `apps/automation-api/src/runs/run.types.ts`

- [ ] **Step 1: Add board node types**

In `board.types.ts`, before `BoardNode`:

```ts
export type ResultKind = 'pass' | 'fail';

export interface ResultNodeData {
  kind: ResultKind;
}
```

Add to the `BoardNode` union:

```ts
| (NodeBase & { type: 'result'; data: ResultNodeData })
```

- [ ] **Step 2: Add flow step + record types**

In `run.types.ts`, append to `FlowStep`:

```ts
| { type: 'result'; nodeId: string; kind: ResultKind }
```

Import `ResultKind` from `../boards/board.types` (or duplicate as `'pass' | 'fail'` if import cycles — prefer import).

Extend `FlowStepRecord.type` union with `'result'`.

Add optional fields to `FlowStepRecord`:

```ts
/** result only */
nodeId?: string;
/** result only */
kind?: ResultKind;
```

- [ ] **Step 3: Verify compile surface**

Run: `pnpm exec nx run automation-api:build`
Expected: FAIL — `NODE_CHAIN_REGISTRY` missing `result` entry (mapped type compile error). That is expected; Task 2 fixes it.

---

## Task 2: Chain registry + terminal resolve-chains

**Files:**
- Modify: `apps/automation-api/src/boards/node-registry.ts`
- Modify: `apps/automation-api/src/boards/resolve-chains.ts`
- Test: `apps/automation-api/src/boards/resolve-chains.spec.ts`

- [ ] **Step 1: Extend ChainOutput**

In `node-registry.ts`:

```ts
export interface ChainOutput {
  steps: FlowStep[];
  endsWithRecord?: boolean;
  /** When true, graph traversal must not follow outgoing edges from this node. */
  terminal?: boolean;
}
```

- [ ] **Step 2: Write failing resolve-chains tests**

Add to `resolve-chains.spec.ts`:

```ts
it('compiles a Result node into a result marker step', () => {
  const g = graph(
    [
      { id: 'p', type: 'profile', position: pos, data: { profileId: 'prof-1' } },
      { id: 'g', type: 'goto', position: pos, data: { url: 'https://e' } },
      { id: 'r', type: 'result', position: pos, data: { kind: 'pass' } },
    ],
    [
      { id: 'e1', source: 'p', target: 'g' },
      { id: 'e2', source: 'g', target: 'r' },
    ],
  );
  expect(resolveChains(g)).toEqual([
    {
      profileId: 'prof-1',
      steps: [
        { type: 'goto', url: 'https://e' },
        { type: 'result', nodeId: 'r', kind: 'pass' },
      ],
    },
  ]);
});

it('stops traversal after a Result node even if extra edges exist', () => {
  const g = graph(
    [
      { id: 'p', type: 'profile', position: pos, data: { profileId: 'prof-1' } },
      { id: 'r', type: 'result', position: pos, data: { kind: 'pass' } },
      { id: 'w', type: 'wait', position: pos, data: { ms: 500 } },
    ],
    [
      { id: 'e1', source: 'p', target: 'r' },
      { id: 'e2', source: 'r', target: 'w' },
    ],
  );
  expect(resolveChains(g)).toEqual([
    { profileId: 'prof-1', steps: [{ type: 'result', nodeId: 'r', kind: 'pass' }] },
  ]);
});

it('includes Result markers inside compiled if branch step lists', () => {
  const g = graph(
    [
      { id: 'p', type: 'profile', position: pos, data: { profileId: 'prof-1' } },
      { id: 'i', type: 'if', position: pos, data: { selector: '#x', condition: 'exists' } },
      { id: 'rp', type: 'result', position: pos, data: { kind: 'pass' } },
      { id: 'rf', type: 'result', position: pos, data: { kind: 'fail' } },
    ],
    [
      { id: 'e1', source: 'p', target: 'i' },
      { id: 'e2', source: 'i', target: 'rp', sourceHandle: 'true' },
      { id: 'e3', source: 'i', target: 'rf', sourceHandle: 'false' },
    ],
  );
  const steps = resolveChains(g)[0].steps;
  expect(steps).toEqual([
    {
      type: 'if',
      selector: '#x',
      condition: 'exists',
      thenSteps: [{ type: 'result', nodeId: 'rp', kind: 'pass' }],
      elseSteps: [{ type: 'result', nodeId: 'rf', kind: 'fail' }],
    },
  ]);
});
```

- [ ] **Step 3: Run tests — expect FAIL**

Run: `pnpm exec nx test automation-api --testPathPattern=resolve-chains.spec`
Expected: FAIL — missing `result` registry entry and/or steps after Result

- [ ] **Step 4: Add result registry entry**

In `NODE_CHAIN_REGISTRY`:

```ts
result: {
  toSteps(node) {
    const kind = node.data.kind ?? 'pass';
    if (kind !== 'pass' && kind !== 'fail') {
      throw new BoardGraphError(`Result node ${node.id} has invalid kind ${String(kind)}`);
    }
    return {
      steps: [{ type: 'result', nodeId: node.id, kind }],
      terminal: true,
    };
  },
},
```

- [ ] **Step 5: Stop traversal after terminal nodes**

In `resolve-chains.ts`, update `compileSubchain` after `steps.push(...out.steps)`:

```ts
if (out.terminal) break;
current = linearNext(outgoing, current);
```

In the main profile loop, after `steps.push(...out.steps)`:

```ts
if (out.terminal) break;
current = targetId;
```

- [ ] **Step 6: Run tests — expect PASS**

Run: `pnpm exec nx test automation-api --testPathPattern=resolve-chains.spec`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/automation-api/src/boards/board.types.ts \
  apps/automation-api/src/runs/run.types.ts \
  apps/automation-api/src/boards/node-registry.ts \
  apps/automation-api/src/boards/resolve-chains.ts \
  apps/automation-api/src/boards/resolve-chains.spec.ts
git commit -m "feat(automation-api): compile Result nodes to terminal marker steps"
```

---

## Task 3: browser-core result marker in runFlow

**Files:**
- Modify: `libs/browser-core/src/lib/types.ts`
- Modify: `libs/browser-core/src/lib/cloak-browser.service.ts`
- Test: `libs/browser-core/src/lib/cloak-browser.service.spec.ts`

- [ ] **Step 1: Extend types**

In `types.ts`, add to `ResolvedFlowStep`:

```ts
| { type: 'result'; nodeId: string; kind: 'pass' | 'fail' }
```

Add to `FlowStepResult`:

```ts
| {
    type: 'result';
    status: 'completed' | 'failed';
    error: string | null;
    nodeId: string;
    kind: 'pass' | 'fail';
  }
```

- [ ] **Step 2: Write failing tests**

In `cloak-browser.service.spec.ts`:

```ts
it('emits a result marker without touching the page', async () => {
  const { launcher, calls, isClosed } = makeFakes();
  const svc = new CloakBrowserService(launcher);
  const { results } = await svc.runFlow(launch, [
    { type: 'goto', url: 'https://example.com' },
    { type: 'result', nodeId: 'r1', kind: 'pass' },
  ]);
  expect(calls).toEqual(['goto:https://example.com']);
  expect(results[1]).toMatchObject({
    type: 'result',
    status: 'completed',
    error: null,
    nodeId: 'r1',
    kind: 'pass',
  });
  expect(isClosed()).toBe(true);
});

it('emits only the Result marker from the if branch selected at runtime', async () => {
  const page = {
    async goto() {},
    async title() {
      return 'T';
    },
    url() {
      return 'https://app.example/';
    },
    async evaluate(expr: string) {
      if (expr.includes('document.querySelector')) return true;
      return undefined;
    },
    async screenshot() {},
    on() {},
  } as unknown as PageLike;
  const launcher: BrowserLauncher = {
    async ensureBinary() {},
    async launchPersistentContext() {
      return {
        async newPage() {
          return page;
        },
        async close() {},
        on() {},
      };
    },
  };
  const svc = new CloakBrowserService(launcher);
  const { results } = await svc.runFlow(launch, [
    {
      type: 'if',
      selector: '#ok',
      condition: 'exists',
      thenSteps: [{ type: 'result', nodeId: 'pass-node', kind: 'pass' }],
      elseSteps: [{ type: 'result', nodeId: 'fail-node', kind: 'fail' }],
    },
  ]);
  expect(results.filter((r) => r.type === 'result')).toEqual([
    expect.objectContaining({ nodeId: 'pass-node', kind: 'pass', status: 'completed' }),
  ]);
});
```

- [ ] **Step 3: Run tests — expect FAIL**

Run: `pnpm exec nx test browser-core --testPathPattern=cloak-browser.service.spec`
Expected: FAIL — no `result` branch

- [ ] **Step 4: Implement runFlow handler**

In `executeAll`, before other step types (or after `if`), add:

```ts
if (step.type === 'result') {
  results.push({
    type: 'result',
    status: 'completed',
    error: null,
    nodeId: step.nodeId,
    kind: step.kind,
  });
  continue;
}
```

In the `failResult` helper, add:

```ts
if (step.type === 'result') {
  return {
    type: 'result',
    status: 'failed',
    error: message,
    nodeId: step.nodeId,
    kind: step.kind,
  };
}
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `pnpm exec nx test browser-core`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add libs/browser-core/src/lib/types.ts \
  libs/browser-core/src/lib/cloak-browser.service.ts \
  libs/browser-core/src/lib/cloak-browser.service.spec.ts
git commit -m "feat(browser-core): handle result marker steps in runFlow"
```

---

## Task 4: RunService mapping for result records

**Files:**
- Modify: `apps/automation-api/src/runs/run.service.ts`
- Test: `apps/automation-api/src/runs/run.service.spec.ts`

- [ ] **Step 1: Write failing test**

In `run.service.spec.ts`, add a test that mocks `browser.runFlow` returning a result step result and asserts `executeFlow` preserves `nodeId` + `kind` in `steps`. Follow the existing mock pattern in that file (inject fake browser service).

Minimal assertion shape:

```ts
expect(record.steps.find((s) => s.type === 'result')).toMatchObject({
  type: 'result',
  status: 'completed',
  nodeId: 'r1',
  kind: 'fail',
});
expect(record.status).toBe('completed'); // result(fail) must NOT fail the run
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm exec nx test automation-api --testPathPattern=run.service.spec`
Expected: FAIL

- [ ] **Step 3: Implement resolveFlowSteps branch**

In `resolveFlowSteps`, before the default goto push:

```ts
} else if (step.type === 'result') {
  out.push({ type: 'result', nodeId: step.nodeId, kind: step.kind });
```

- [ ] **Step 4: Implement stepRecords mapping**

In the `stepResults.map` callback, before the generic return:

```ts
if (r.type === 'result') {
  return {
    type: 'result',
    status: r.status,
    error: r.error,
    nodeId: r.nodeId,
    kind: r.kind,
  };
}
```

Confirm `record.status` still uses only `stepResults.find((r) => r.status === 'failed')` — a completed `result(fail)` marker must not flip run status to `'failed'`.

- [ ] **Step 5: Run test — expect PASS**

Run: `pnpm exec nx test automation-api --testPathPattern=run.service.spec`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/automation-api/src/runs/run.service.ts \
  apps/automation-api/src/runs/run.service.spec.ts
git commit -m "feat(automation-api): map result marker records through RunService"
```

---

## Task 5: Pure aggregation helpers (web)

**Files:**
- Create: `apps/web/src/components/automation/board-result-status.ts`
- Create: `apps/web/src/components/automation/board-result-status.spec.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import {
  aggregateBoardResult,
  resultNodeStatesFromRecords,
} from './board-result-status';

describe('board-result-status', () => {
  it('maps result records to node states', () => {
    expect(
      resultNodeStatesFromRecords([
        { type: 'result', nodeId: 'a', kind: 'pass' },
        { type: 'goto', status: 'completed' },
      ]),
    ).toEqual({ a: 'pass' });
  });

  it('aggregates fail over pass', () => {
    expect(
      aggregateBoardResult([
        { type: 'result', kind: 'pass' },
        { type: 'result', kind: 'fail' },
      ]),
    ).toBe('fail');
  });

  it('returns pass when only pass markers exist', () => {
    expect(aggregateBoardResult([{ type: 'result', kind: 'pass' }])).toBe('pass');
  });

  it('returns undefined when no result markers', () => {
    expect(aggregateBoardResult([{ type: 'goto' }])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm exec nx test web --testPathPattern=board-result-status.spec`
Expected: FAIL — module missing

- [ ] **Step 3: Implement helpers**

```ts
export type BoardResultStatus = 'pass' | 'fail';
export type ResultKind = 'pass' | 'fail';

type ResultLike = { type: string; nodeId?: string; kind?: ResultKind };

export function resultNodeStatesFromRecords(
  records: ResultLike[],
): Record<string, ResultKind> {
  const out: Record<string, ResultKind> = {};
  for (const r of records) {
    if (r.type === 'result' && r.nodeId && r.kind) out[r.nodeId] = r.kind;
  }
  return out;
}

export function aggregateBoardResult(records: ResultLike[]): BoardResultStatus | undefined {
  let sawPass = false;
  for (const r of records) {
    if (r.type !== 'result' || !r.kind) continue;
    if (r.kind === 'fail') return 'fail';
    sawPass = true;
  }
  return sawPass ? 'pass' : undefined;
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `pnpm exec nx test web --testPathPattern=board-result-status.spec`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/automation/board-result-status.ts \
  apps/web/src/components/automation/board-result-status.spec.ts
git commit -m "feat(web): add board result aggregation helpers"
```

---

## Task 6: Web API types + ResultNode UI

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Create: `apps/web/src/components/automation/nodes/result-node.tsx`
- Modify: `apps/web/src/components/automation/nodes/registry.ts`

- [ ] **Step 1: Sync client types**

In `client.ts`, add:

```ts
export type ResultKind = 'pass' | 'fail';

export interface ResultNodeData {
  kind: ResultKind;
}
```

Add `'result'` to `BoardNode.type` union and `ResultNodeData` to `BoardNodeData`.

Extend `FlowStepRecord.type` with `'result'` and add optional `nodeId?: string; kind?: ResultKind;`.

(While editing, align `FlowStepRecord.type` with `run.types.ts` for other step types already supported by the API — do not remove existing fields.)

- [ ] **Step 2: Create ResultNode component**

Create `result-node.tsx`:

```tsx
import { Handle, Position, type NodeProps } from '@xyflow/react';

type ResultNodeData = {
  kind: 'pass' | 'fail';
  runtimeKind?: 'pass' | 'fail';
  onChange?: (patch: { kind: 'pass' | 'fail' }) => void;
};

const accent = (runtime?: 'pass' | 'fail') =>
  runtime === 'pass'
    ? 'border-green-600'
    : runtime === 'fail'
      ? 'border-red-600'
      : 'border-foreground';

const headerAccent = (runtime?: 'pass' | 'fail') =>
  runtime === 'pass'
    ? 'bg-green-600'
    : runtime === 'fail'
      ? 'bg-red-600'
      : 'bg-foreground';

export function ResultNode({ data }: NodeProps) {
  const d = data as ResultNodeData;
  const kind = d.kind ?? 'pass';
  return (
    <div className={`min-w-44 border-2 bg-background ${accent(d.runtimeKind)}`}>
      <Handle type="target" position={Position.Left} />
      <div
        className={`border-b-2 border-foreground px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-background ${headerAccent(d.runtimeKind)}`}
      >
        Result
      </div>
      <div className="space-y-2 px-3 py-2 font-mono text-[10px]">
        <select
          className="w-full border border-foreground bg-background px-1 py-0.5 uppercase"
          value={kind}
          onChange={(e) => d.onChange?.({ kind: e.target.value as 'pass' | 'fail' })}
        >
          <option value="pass">Pass</option>
          <option value="fail">Fail</option>
        </select>
        <p className="text-muted-foreground">Marks this path as board result</p>
      </div>
    </div>
  );
}
```

No source `Handle` — terminal in the UI.

- [ ] **Step 3: Register result node**

In `registry.ts`:

```ts
import { ResultNode } from './result-node';

// In NODE_DESCRIPTORS:
result: {
  label: 'Result',
  component: ResultNode,
  defaultData: () => ({ kind: 'pass' }),
  serialize: (d) => ({ kind: (d.kind as ResultKind) ?? 'pass' }),
  inject: (d, ctx) => ({
    kind: (d.kind as ResultKind) ?? 'pass',
    runtimeKind: d.runtimeKind as ResultKind | undefined,
    onChange: (patch: { kind: ResultKind }) => ctx.patch(patch),
  }),
  validate: () => [],
},
```

Add `'result'` to `NODE_ORDER` (after `'if'` or near terminal nodes).

Import `ResultKind` from `../../../api/client` or define locally consistent with client.

- [ ] **Step 4: Verify web build**

Run: `pnpm exec nx run web:build`
Expected: PASS (types + registry compile)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/client.ts \
  apps/web/src/components/automation/nodes/result-node.tsx \
  apps/web/src/components/automation/nodes/registry.ts
git commit -m "feat(web): add Result node component and registry entry"
```

---

## Task 7: FlowCanvas runtime state + run aggregation

**Files:**
- Modify: `apps/web/src/components/automation/flow-canvas.tsx`

- [ ] **Step 1: Extend props**

Change `FlowCanvas` props to:

```ts
{
  board: Board;
  profiles: Profile[];
  onBoardResult?: (boardId: string, status: 'pass' | 'fail' | undefined) => void;
}
```

- [ ] **Step 2: Add runtime state**

Near other `useState` calls:

```ts
const [resultNodeStates, setResultNodeStates] = useState<Record<string, 'pass' | 'fail'>>({});
```

When loading a board (`useEffect` on `board.id`), reset:

```ts
setResultNodeStates({});
```

- [ ] **Step 3: Inject runtimeKind into result nodes**

Where `injectNodeData` builds node data (existing map over nodes), merge `runtimeKind: resultNodeStates[n.id]` when `n.type === 'result'`.

- [ ] **Step 4: Update run handler**

Import helpers from `./board-result-status`.

At start of `run()`:

```ts
setResultNodeStates({});
```

After `setResult(await api.runBoard(board.id))`:

```ts
const allRecords = (/* board run */).runs.flatMap((r) => r.steps);
const nodeStates = resultNodeStatesFromRecords(allRecords);
setResultNodeStates(nodeStates);
const status = aggregateBoardResult(allRecords);
onBoardResult?.(board.id, status);
```

Use the actual `BoardRunRecord` variable already stored in `result` state — e.g. `boardRun.runs.flatMap((r) => r.steps)`.

- [ ] **Step 5: Manual smoke**

Run web dev server, add Result node to a board, confirm it renders and kind toggles persist on save.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/automation/flow-canvas.tsx
git commit -m "feat(web): derive Result node runtime state after board run"
```

---

## Task 8: BoardList sidebar pass/fail styling

**Files:**
- Modify: `apps/web/src/components/automation/automation-page.tsx`
- Modify: `apps/web/src/components/automation/automation-sidebar.tsx`
- Modify: `apps/web/src/components/automation/board-list.tsx`
- Create: `apps/web/src/components/automation/board-list.spec.tsx`

- [ ] **Step 1: Write failing BoardList test**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { BoardList } from './board-list';

const boards = [{ id: 'b1', name: 'Alpha', graph: { nodes: [], edges: [] }, createdAt: '', updatedAt: '' }];

describe('BoardList', () => {
  it('applies pass row styling from boardStatuses', () => {
    render(
      <BoardList
        boards={boards}
        selectedId={null}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        boardStatuses={{ b1: 'pass' }}
        embedded
      />,
    );
    const row = screen.getByRole('button', { name: /alpha/i });
    expect(row.className).toMatch(/green/i);
  });

  it('applies fail row styling from boardStatuses', () => {
    render(
      <BoardList
        boards={boards}
        selectedId="b1"
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        boardStatuses={{ b1: 'fail' }}
        embedded
      />,
    );
    const row = screen.getByRole('button', { name: /alpha/i });
    expect(row.className).toMatch(/red/i);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm exec nx test web --testPathPattern=board-list.spec`
Expected: FAIL — prop missing

- [ ] **Step 3: Implement BoardList prop**

Add optional prop:

```ts
boardStatuses?: Record<string, 'pass' | 'fail' | undefined>;
```

Row class helper:

```ts
function rowClasses(boardId: string, selectedId: string | null, boardStatuses?: Record<string, 'pass' | 'fail' | undefined>) {
  const status = boardStatuses?.[boardId];
  if (status === 'pass') return 'bg-green-600 text-white';
  if (status === 'fail') return 'bg-red-600 text-white';
  return boardId === selectedId ? 'bg-foreground text-background' : '';
}
```

Apply to the row `<button>` `className`. Status takes priority over selected styling (per spec).

- [ ] **Step 4: Wire AutomationPage session state**

In `automation-page.tsx`:

```ts
const [boardStatuses, setBoardStatuses] = useState<Record<string, 'pass' | 'fail' | undefined>>({});

const handleBoardResult = (boardId: string, status: 'pass' | 'fail' | undefined) => {
  setBoardStatuses((prev) => ({ ...prev, [boardId]: status }));
};
```

Pass to `AutomationSidebar` → `BoardList`, and to `FlowCanvas`:

```tsx
<FlowCanvas
  key={board.id}
  ref={canvasRef}
  board={board}
  profiles={profiles}
  onBoardResult={handleBoardResult}
/>
```

Thread `boardStatuses` through `AutomationSidebar` props.

- [ ] **Step 5: Run tests — expect PASS**

Run: `pnpm exec nx test web --testPathPattern=board-list.spec`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/automation/board-list.tsx \
  apps/web/src/components/automation/board-list.spec.tsx \
  apps/web/src/components/automation/automation-sidebar.tsx \
  apps/web/src/components/automation/automation-page.tsx
git commit -m "feat(web): show ephemeral pass/fail status on board sidebar rows"
```

---

## Task 9: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run backend unit tests**

Run: `pnpm exec nx test automation-api && pnpm exec nx test browser-core`
Expected: all pass

- [ ] **Step 2: Run frontend unit tests**

Run: `pnpm exec nx test web`
Expected: all pass

- [ ] **Step 3: Run full build**

Run: `pnpm build`
Expected: pass with no type errors

- [ ] **Step 4: Manual verification (spec checklist)**

1. Board: `Profile -> Goto -> If`; true → `Result(pass)`; false → `Wait(5000) -> Result(fail)`.
2. Run with condition true → pass node green, sidebar row green.
3. Run with condition false → fail node red, sidebar row red.
4. Reload page → sidebar colors gone; graph still has Result nodes.
5. Board without Result → no sidebar pass/fail color; existing run panel unchanged.

Record evidence (test output + brief manual log) for harness `board-result-node-execution` and `board-result-sidebar-status`.

---

## Spec Coverage Checklist

| Spec requirement | Task |
|------------------|------|
| Result node type with `kind: pass \| fail` | Task 1, 6 |
| Marker step, no page interaction | Task 3 |
| If branch emits one Result | Task 2, 3 |
| Terminal traversal (UI + backend) | Task 2, 6 |
| Ephemeral board row status | Task 7, 8 |
| Multi-profile fail-over-pass aggregation | Task 5, 7 |
| `result(fail)` ≠ run `failed` | Task 4 |
| Boards without Result unchanged | Task 7 (undefined status) |
| Non-goals (no persistence, no header styling) | Not implemented |

---

## Harness Handoff

After Task 9 evidence:

1. `harness_set_feature_passing` for `board-result-node-execution` with test output.
2. `harness_set_feature_passing` for `board-result-sidebar-status` with test + manual log.
3. `harness_handoff` — leave no feature `active`.
