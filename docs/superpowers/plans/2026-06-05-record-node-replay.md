# Record Node Record/Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record node toggles between **Record** (Run board → live capture → Stop) and **Replay** (edit saved steps → Run board → full script playback).

**Architecture:** Add `mode` to `RecordNodeData`. Pure `compileRecordedSteps()` turns `RecordedStep[]` into `FlowStep[]` for replay. `record.toSteps()` branches on mode. Add `scroll` to the flow pipeline. Web UI: toggle + replay step editor.

**Tech Stack:** Nx monorepo. NestJS + Jest (`automation-api`). `libs/browser-core` (runFlow). React + Vitest (`web`).

Spec: `docs/superpowers/specs/2026-06-05-record-node-replay-design.md`.

---

## File Structure

**`apps/automation-api/src/boards/`**
- `recorded-steps-to-flow.ts` (new) — `compileRecordedSteps(steps) → FlowStep[]`
- `recorded-steps-to-flow.spec.ts` (new)
- `board.types.ts` (modify) — `RecordNodeMode`, `RecordNodeData.mode`
- `node-registry.ts` (modify) — `record.toSteps` mode branch

**`apps/automation-api/src/runs/`**
- `run.types.ts` (modify) — `scroll` in `FlowStep` + `FlowStepRecord`
- `run.service.ts` (modify) — resolve scroll steps

**`apps/automation-api/src/boards/`**
- `resolve-chains.spec.ts` (modify) — replay compile tests

**`libs/browser-core/src/lib/`**
- `types.ts` (modify) — `scroll` in `ResolvedFlowStep` / `FlowStepResult`
- `cloak-browser.service.ts` (modify) — handle scroll in `runFlow`
- `cloak-browser.service.spec.ts` (modify) — scroll step test

**`apps/web/src/`**
- `api/client.ts` (modify) — `RecordNodeMode`, `RecordNodeData.mode`
- `components/automation/nodes/record-node.tsx` (modify) — toggle + replay editor
- `components/automation/nodes/registry.ts` (modify) — defaultData, serialize, inject
- `components/automation/flow-canvas.tsx` (modify) — `recording: true` only when `mode==='record'`
- `components/automation/graph-validation.ts` (modify) — replay validation
- `components/automation/graph-validation.spec.ts` (modify)

---

## Task 1: `scroll` flow step in browser-core

**Files:**
- Modify: `libs/browser-core/src/lib/types.ts`
- Modify: `libs/browser-core/src/lib/cloak-browser.service.ts`
- Test: `libs/browser-core/src/lib/cloak-browser.service.spec.ts`

- [ ] **Step 1: Extend types**

In `types.ts`, add to `ResolvedFlowStep`:

```ts
| { type: 'scroll'; direction: 'up' | 'down' }
```

Add to `FlowStepResult`:

```ts
| { type: 'scroll'; status: 'completed' | 'failed'; error: string | null }
```

- [ ] **Step 2: Write failing test**

In `cloak-browser.service.spec.ts`:

```ts
it('scrolls the page during runFlow', async () => {
  const page = new FakePage();
  page.scroll = vi.fn().mockResolvedValue(undefined);
  const { service } = build(page);
  const results = await service.runFlow(launch, [
    { type: 'goto', url: 'https://example.com' },
    { type: 'scroll', direction: 'down' },
  ]);
  expect(page.scroll).toHaveBeenCalledWith('down');
  expect(results[1]).toMatchObject({ type: 'scroll', status: 'completed', error: null });
});
```

Add `scroll` to `FakePage` if missing.

- [ ] **Step 3: Run test — expect FAIL**

Run: `pnpm exec nx test browser-core --testPathPattern=cloak-browser.service.spec`
Expected: FAIL — scroll branch missing

- [ ] **Step 4: Implement in runFlow**

After `click` branch, add:

```ts
} else if (step.type === 'scroll') {
  await page.scroll(step.direction);
  results.push({ type: 'scroll', status: 'completed', error: null });
}
```

Handle failure branch similarly to `click`.

- [ ] **Step 5: Run test — expect PASS**

Run: `pnpm exec nx test browser-core`
Expected: all pass

---

## Task 2: `compileRecordedSteps` pure function

**Files:**
- Create: `apps/automation-api/src/boards/recorded-steps-to-flow.ts`
- Create: `apps/automation-api/src/boards/recorded-steps-to-flow.spec.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { compileRecordedSteps } from './recorded-steps-to-flow';
import { BoardGraphError } from './board.errors';

describe('compileRecordedSteps', () => {
  it('compiles navigate, click, type, scroll', () => {
    expect(
      compileRecordedSteps([
        { type: 'navigate', url: 'https://example.com', at: 't1' },
        { type: 'click', tag: 'button', text: 'Go', href: null, selector: 'button.go', at: 't2' },
        { type: 'type', tag: 'input', text: 'qty', selector: '#qty', value: '10', at: 't3' },
        { type: 'scroll', direction: 'down', at: 't4' },
      ]),
    ).toEqual([
      { type: 'goto', url: 'https://example.com' },
      { type: 'wait', ms: 300 },
      { type: 'click', selector: 'button.go' },
      { type: 'wait', ms: 150 },
      { type: 'fill', selector: '#qty', value: '10' },
      { type: 'wait', ms: 150 },
      { type: 'scroll', direction: 'down' },
    ]);
  });

  it('skips about: navigates', () => {
    expect(
      compileRecordedSteps([{ type: 'navigate', url: 'about:blank', at: 't1' }]),
    ).toEqual([]);
  });

  it('throws when click has empty selector', () => {
    expect(() =>
      compileRecordedSteps([
        { type: 'click', tag: 'a', text: '', href: null, selector: '  ', at: 't1' },
      ]),
    ).toThrow(BoardGraphError);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm exec nx test automation-api --testPathPattern=recorded-steps-to-flow`
Expected: module not found

- [ ] **Step 3: Implement**

```ts
import type { FlowStep } from '../runs/run.types';
import type { RecordedStep } from './board.types';
import { BoardGraphError } from './board.errors';

const NAV_SETTLE_MS = 300;
const ACTION_SETTLE_MS = 150;

export function compileRecordedSteps(steps: RecordedStep[], nodeId = 'record'): FlowStep[] {
  const out: FlowStep[] = [];
  for (const s of steps) {
    if (s.type === 'navigate') {
      const url = s.url?.trim();
      if (!url || url.startsWith('about:')) continue;
      out.push({ type: 'goto', url });
      out.push({ type: 'wait', ms: NAV_SETTLE_MS });
    } else if (s.type === 'click') {
      const selector = s.selector?.trim();
      if (!selector) throw new BoardGraphError(`Recorded click in ${nodeId} has empty selector`);
      out.push({ type: 'click', selector });
      out.push({ type: 'wait', ms: ACTION_SETTLE_MS });
    } else if (s.type === 'type') {
      const selector = s.selector?.trim();
      if (!selector) throw new BoardGraphError(`Recorded type in ${nodeId} has empty selector`);
      out.push({ type: 'fill', selector, value: s.value ?? '' });
      out.push({ type: 'wait', ms: ACTION_SETTLE_MS });
    } else if (s.type === 'scroll') {
      out.push({ type: 'scroll', direction: s.direction });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test — expect PASS**

---

## Task 3: `RecordNodeData.mode` + node-registry branch

**Files:**
- Modify: `apps/automation-api/src/boards/board.types.ts`
- Modify: `apps/automation-api/src/boards/node-registry.ts`
- Modify: `apps/automation-api/src/boards/resolve-chains.spec.ts`

- [ ] **Step 1: Add mode to types**

```ts
export type RecordNodeMode = 'record' | 'replay';

export interface RecordNodeData {
  mode?: RecordNodeMode; // default 'record' when missing (backward compat)
  steps: RecordedStep[];
}
```

- [ ] **Step 2: Update record.toSteps**

```ts
record: {
  toSteps(node) {
    const mode = node.data.mode ?? 'record';
    if (mode === 'replay') {
      return { steps: compileRecordedSteps(node.data.steps ?? [], node.id) };
    }
    const steps: FlowStep[] = [];
    for (const s of node.data.steps ?? []) {
      if (s.type === 'navigate' && s.url?.trim() && !s.url.startsWith('about:')) {
        steps.push({ type: 'goto', url: s.url.trim() });
        steps.push({ type: 'wait', ms: 800 });
      }
    }
    return { steps, endsWithRecord: true };
  },
},
```

- [ ] **Step 3: Add resolve-chains tests**

```ts
it('replay mode compiles click and fill from record steps', () => {
  const g = graph(
    [
      { id: 'p', type: 'profile', position: pos, data: { profileId: 'prof-1' } },
      {
        id: 'r',
        type: 'record',
        position: pos,
        data: {
          mode: 'replay',
          steps: [
            { type: 'navigate', url: 'https://example.com', at: 't1' },
            { type: 'type', tag: 'input', text: '', selector: '#qty', value: '10', at: 't2' },
          ],
        },
      },
    ],
    [{ id: 'e1', source: 'p', target: 'r' }],
  );
  const job = resolveChains(g)[0];
  expect(job.endsWithRecord).toBeUndefined();
  expect(job.steps).toContainEqual({ type: 'fill', selector: '#qty', value: '10' });
});
```

- [ ] **Step 4: Run automation-api tests**

Run: `pnpm exec nx test automation-api`
Expected: PASS

---

## Task 4: `scroll` in run.service

**Files:**
- Modify: `apps/automation-api/src/runs/run.types.ts`
- Modify: `apps/automation-api/src/runs/run.service.ts`
- Modify: `apps/automation-api/src/runs/run.service.spec.ts`

- [ ] **Step 1: Add scroll to FlowStep and FlowStepRecord**

```ts
| { type: 'scroll'; direction: 'up' | 'down' }
// FlowStepRecord.type union includes 'scroll'
```

- [ ] **Step 2: Map in executeFlow resolved steps**

```ts
if (step.type === 'scroll') {
  return { type: 'scroll', direction: step.direction };
}
```

- [ ] **Step 3: Add run.service.spec case for scroll in flow**

- [ ] **Step 4: Run tests**

Run: `pnpm exec nx test automation-api --testPathPattern=run.service.spec`

---

## Task 5: Web types + registry + flow-canvas

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/components/automation/nodes/registry.ts`
- Modify: `apps/web/src/components/automation/flow-canvas.tsx`

- [ ] **Step 1: Mirror `RecordNodeMode` and `mode` in client.ts**

```ts
export type RecordNodeMode = 'record' | 'replay';

export interface RecordNodeData {
  mode?: RecordNodeMode;
  steps: RecordedStep[];
}
```

- [ ] **Step 2: registry defaultData + serialize**

```ts
record: {
  label: 'Record',
  component: RecordNode,
  defaultData: () => ({ mode: 'record', steps: [] }),
  serialize: (data) => ({
    mode: (data.mode as RecordNodeMode) ?? 'record',
    steps: (data.steps as RecordedStep[]) ?? [],
  }),
  // inject: pass onModeChange, onStepsChange for replay editor
},
```

- [ ] **Step 3: flow-canvas — only arm recording when mode is record**

In `run()` after board run, when setting `recording: true`:

```ts
const mode = (n.data as { mode?: RecordNodeMode }).mode ?? 'record';
if (mode !== 'record') return n;
```

In `chainEndsWithRecord` usage — unchanged.

In `toGraph` / strip for record: persist `mode` + `steps` only (no `recording`).

- [ ] **Step 4: Run web tests**

Run: `pnpm exec nx test web`

---

## Task 6: Record node UI — toggle + replay editor

**Files:**
- Modify: `apps/web/src/components/automation/nodes/record-node.tsx`
- Test: optional manual; add `record-node.spec.tsx` if time permits

- [ ] **Step 1: Add props**

```ts
data: {
  mode: RecordNodeMode;
  steps: RecordedStep[];
  recording: boolean;
  profileId: string | null;
  onModeChange?: (mode: RecordNodeMode) => void;
  onStepsChange?: (steps: RecordedStep[]) => void;
  onStop?: () => void;
  onClear?: () => void;
};
```

- [ ] **Step 2: Segmented toggle Record | Replay**

Two buttons or toggle group calling `onModeChange('record' | 'replay')`.

- [ ] **Step 3: Record mode panel**

- Read-only step list (current behavior).
- Stop when `recording`; Clear when idle.
- Remove standalone Start button (Run board is entry per spec).

- [ ] **Step 4: Replay mode panel**

Editable rows:
- navigate → `<input value={url} onChange=…>`
- click → selector input
- type → selector + value inputs (user edits 100 → 10 here)
- scroll → `<select>` up/down
- Delete button removes step from array via `onStepsChange`

- [ ] **Step 5: Wire inject in registry**

```ts
inject: (data, ctx) => ({
  mode: (data.mode as RecordNodeMode) ?? 'record',
  steps: (data.steps as RecordedStep[]) ?? [],
  recording: Boolean(data.recording),
  profileId: resolveUpstreamProfile(ctx.id, ctx.getNodes(), ctx.getEdges()),
  onModeChange: (mode) => ctx.patch({ mode }),
  onStepsChange: (steps) => ctx.patch({ steps }),
  onStop: () => { /* existing stop recording via api */ },
  onClear: () => ctx.patch({ steps: [] }),
}),
```

- [ ] **Step 6: Run web build**

Run: `pnpm exec nx build web`
Expected: success

---

## Task 7: Graph validation for replay

**Files:**
- Modify: `apps/web/src/components/automation/graph-validation.ts`
- Modify: `apps/web/src/components/automation/graph-validation.spec.ts`

- [ ] **Step 1: Failing tests**

```ts
it('errors when replay record node has no steps', () => {
  const g = graphWithRecord({ mode: 'replay', steps: [] });
  expect(validateGraph(g).some((e) => e.message.match(/no steps/i))).toBe(true);
});

it('errors when replay step has empty selector', () => {
  const g = graphWithRecord({
    mode: 'replay',
    steps: [{ type: 'click', tag: 'a', text: '', href: null, selector: '', at: 't' }],
  });
  expect(validateGraph(g).some((e) => e.message.match(/selector/i))).toBe(true);
});
```

- [ ] **Step 2: Implement validation**

```ts
} else if (node.type === 'record') {
  const d = node.data as RecordNodeData;
  const mode = d.mode ?? 'record';
  if (mode === 'replay') {
    if (!d.steps?.length) {
      errors.push({ nodeId: node.id, message: 'Replay mode requires at least one recorded step' });
    }
    for (const s of d.steps ?? []) {
      if ((s.type === 'click' || s.type === 'type') && !s.selector?.trim()) {
        errors.push({ nodeId: node.id, message: `Recorded ${s.type} step has empty selector` });
      }
    }
  }
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm exec nx test web --testPathPattern=graph-validation`

---

## Task 8: Manual verification

- [ ] **Step 1: Record flow**

1. `pnpm exec nx serve automation-api` + `pnpm exec nx serve web`
2. Board: Profile → Goto → Record (**Record** mode)
3. Run → interact (click, type, scroll) → Stop
4. Confirm steps appear on node and persist after refresh

- [ ] **Step 2: Replay flow**

1. Toggle **Replay**
2. Edit a type step value (e.g. 100 → 10)
3. Run → confirm browser replays without opening live recorder
4. Check `artifacts/runs/.../result.json` step statuses

- [ ] **Step 3: Full test suite**

Run: `pnpm test && pnpm build`
Expected: PASS

---

## Task 9: Commit

```bash
git add docs/superpowers/specs/2026-06-05-record-node-replay-design.md \
  docs/superpowers/plans/2026-06-05-record-node-replay.md \
  apps/automation-api/src/boards/recorded-steps-to-flow.ts \
  apps/automation-api/src/boards/recorded-steps-to-flow.spec.ts \
  apps/automation-api/src/boards/board.types.ts \
  apps/automation-api/src/boards/node-registry.ts \
  apps/automation-api/src/runs/run.types.ts \
  apps/automation-api/src/runs/run.service.ts \
  libs/browser-core/src/lib/types.ts \
  libs/browser-core/src/lib/cloak-browser.service.ts \
  apps/web/src/api/client.ts \
  apps/web/src/components/automation/nodes/record-node.tsx \
  apps/web/src/components/automation/nodes/registry.ts \
  apps/web/src/components/automation/flow-canvas.tsx \
  apps/web/src/components/automation/graph-validation.ts
git commit -m "feat(record): add replay mode with editable steps and scroll playback"
```
