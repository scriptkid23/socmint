# Board Result Node — Design

**Date:** 2026-06-07
**Status:** Awaiting review

## Summary

Add a simple **Result** node to automation boards. The node is a terminal marker that
lets a board author explicitly say "this path means pass" or "this path means fail".

Example:

```text
Profile -> Goto -> If
                 ├─ true  -> Result(pass)
                 └─ false -> Wait 5s -> Result(fail)
```

When a run reaches `Result(pass)`, the Result node turns green and the board item in
the sidebar (`BoardList`) turns green for the current browser session. When a run
reaches `Result(fail)`, the node turns red and the board item turns red. If a board
does not use a Result node, existing behavior stays unchanged.

The sidebar status is intentionally **ephemeral**: it appears after running a board in
the current page session and disappears on reload. No board JSON schema change is
required for storing last-run status.

## Decisions

- **Node model:** one configurable node type, `result`, with `kind: 'pass' | 'fail'`.
- **Execution model:** Result compiles to a backend/browser marker step. It does not
  touch the page and does not wait.
- **Signal source:** the branch that actually executes determines which Result marker
  is emitted. This matches the existing `If` execution model.
- **Board status UI:** show pass/fail color on each board row in `BoardList`, not on
  the canvas header.
- **Persistence:** board row status is not persisted; reload clears it.
- **Compatibility:** boards without Result nodes continue to run and display exactly
  as they do today.

## User Experience

### Result Node

The toolbar adds a new **Result** button. Creating it places a small node on the
canvas, using the same styling and delete affordance as other nodes.

The node has:

- Header: `RESULT`
- A select/toggle with two values:
  - `PASS`
  - `FAIL`
- A short hint: `Marks this path as board result`

Before a run, the node uses neutral styling. After a run:

- `PASS` node reached: green border/header/accent.
- `FAIL` node reached: red border/header/accent.
- Result node not reached in the latest run: neutral styling.

The Result node is terminal. It has no source handle in the UI, so users cannot wire
steps after it. Reaching the node finalizes the path outcome.

### BoardList Status

`BoardList` receives current-session board statuses from its parent. Each board row
can render one of three states:

- No status: current neutral/selected styling.
- Pass: green visual treatment.
- Fail: red visual treatment.

The status appears on the board row identified by the DOM path the user provided:

```text
BoardList > ul > li > button
```

Recommended styling:

- Pass, selected or unselected: green background with high-contrast text.
- Fail, selected or unselected: red background with high-contrast text.
- If status is present, it takes visual priority over the normal selected row color.

This keeps the status visible even after selecting another board.

## Architecture

```text
apps/web
  FlowCanvas
    adds Result node to registry
    tracks latest result marker records after run
    updates ephemeral board status
  BoardList
    renders board row pass/fail color

apps/automation-api
  board.types / node-registry / resolve-chains
    accepts and compiles result nodes
  run.types / run.service
    returns result step records with nodeId + kind

libs/browser-core
  runFlow()
    handles result marker step by pushing a result record
```

The important boundary is the marker step. The backend already compiles board nodes
into `FlowStep[]`, and browser-core already returns a flat `FlowStepResult[]` in the
order steps executed. A Result node should use the same path:

1. `resolveChains()` sees a `result` board node.
2. `NODE_CHAIN_REGISTRY.result.toSteps()` returns a marker step:
   `{ type: 'result', nodeId, kind }`.
3. `libs/browser-core` receives the resolved step and immediately pushes:
   `{ type: 'result', status: 'completed', error: null, nodeId, kind }`.
4. `RunService.executeFlow()` maps that browser result to API `FlowStepRecord`.
5. `FlowCanvas.run()` reads returned records and derives:
   - node visual state for Result nodes
   - board row status for the active board

Because `If` already executes only the selected branch, Result marker records naturally
represent only the Result nodes that were actually reached.

## Data Model

### Board Node

Extend the board node union in both API and web client types:

```ts
type ResultKind = 'pass' | 'fail';

type ResultNode = {
  id: string;
  type: 'result';
  position: { x: number; y: number };
  data: {
    kind: ResultKind;
  };
};
```

Result nodes persist only their configured `kind`. Runtime UI state such as "was
reached in the latest run" must not be saved into board JSON.

### Flow Step

Extend the run step union:

```ts
type FlowStep =
  | ExistingFlowStep
  | {
      type: 'result';
      nodeId: string;
      kind: 'pass' | 'fail';
    };
```

### Flow Step Record

Extend browser-core and API run records:

```ts
type FlowStepRecord =
  | ExistingFlowStepRecord
  | {
      type: 'result';
      status: 'completed' | 'failed';
      error: string | null;
      nodeId: string;
      kind: 'pass' | 'fail';
    };
```

The Result marker itself should not fail under normal operation. If an unexpected
runtime error occurs, it follows the existing step failure behavior.

### Ephemeral Board Status

In the web app, keep a session-only map near the board/flow owner:

```ts
type BoardResultStatus = 'pass' | 'fail';
type BoardResultStatusById = Record<string, BoardResultStatus | undefined>;
```

`FlowCanvas` can report the active board status upward after a run. The parent passes
the map into `BoardList`, which applies row styling.

No API field is added to `BoardRecord` for this version.

## Execution Semantics

### Linear Chains

For a linear chain:

```text
Profile -> Goto -> Result(pass)
```

Execution returns a `result` step record after the `goto` step completes. The board row
turns green.

### If Branches

For a conditional chain:

```text
If
├─ true  -> Result(pass)
└─ false -> Result(fail)
```

The existing `if` implementation pushes an `if` result record with the selected branch
and executes only that branch. Therefore only one Result marker is emitted.

### Multiple Profiles

A board can run multiple profile chains in parallel. The board row needs one status.
Use deterministic aggregation:

- If any reached Result marker is `fail`, board status is `fail`.
- Else if at least one reached Result marker is `pass`, board status is `pass`.
- Else leave board status unchanged/empty for this run.

This keeps failure dominant and avoids a board showing green when another profile path
explicitly failed.

### Boards Without Result Nodes

If no Result marker is reached, do not apply pass/fail color. Existing `completed` /
`failed` run behavior remains visible in the current Run results panel.

This is intentional: Result is opt-in and should not reinterpret existing boards.

## Frontend Changes

### Node Registry

Add `result` to the web node registry:

- `DEFAULT`: `{ kind: 'pass' }`
- `serialize`: persist only `{ kind }`
- `inject`: pass `kind`, `onChange`, and latest runtime result state
- `validate`: no required field beyond `kind`

Add `ResultNode` component under:

```text
apps/web/src/components/automation/nodes/result-node.tsx
```

The component should use existing node visual language:

- black header
- mono text
- border styling
- `Handle type="target"` on the left
- no source handle

Because no source handle is present, users cannot wire beyond Result. Backend
resolution should also treat Result as terminal so imported or hand-edited graph data
cannot make `Result(pass) -> Wait -> Result(fail)` meaningful.

### FlowCanvas Runtime State

Add a local runtime map:

```ts
type ResultNodeRuntimeState = 'pass' | 'fail' | undefined;
const [resultNodeStates, setResultNodeStates] = useState<Record<string, ResultNodeRuntimeState>>({});
```

After `api.runBoard(board.id)` resolves:

1. Extract all `FlowStepRecord` items where `type === 'result'`.
2. Build `resultNodeStates` from `record.nodeId -> record.kind`.
3. Aggregate board status:
   - fail if any `kind === 'fail'`
   - else pass if any `kind === 'pass'`
   - else undefined
4. Notify parent with `onBoardResult(board.id, status)`.

When a board is loaded or rerun, reset stale node states before applying new results.

### BoardList

Extend props:

```ts
boardStatuses?: Record<string, 'pass' | 'fail' | undefined>;
```

When rendering a row:

- `fail`: red classes.
- `pass`: green classes.
- no status: existing selected/neutral classes.

The delete and rename icons should remain readable in pass/fail row states.

## Backend Changes

### Shared API Types

Update `apps/automation-api/src/boards/board.types.ts`:

- Add `ResultNodeData`.
- Add `{ type: 'result' }` to `BoardNode`.

Update `apps/automation-api/src/runs/run.types.ts`:

- Add `result` to `FlowStep`.
- Add `result` to `FlowStepRecord['type']` and include `nodeId`, `kind`.

Update `apps/web/src/api/client.ts` to mirror the API types used by the UI.

### Chain Registry

Add to `NODE_CHAIN_REGISTRY`:

```ts
result: {
  toSteps(node) {
    return {
      steps: [{ type: 'result', nodeId: node.id, kind: node.data.kind ?? 'pass' }],
      terminal: true,
    };
  },
}
```

The exact API can either add a `terminal` flag to `ChainOutput`, or `resolveChains`
can special-case `result` after compiling it. The design intent is that traversal
stops after a Result node.

### Resolve Chains

Update `compileSubchain()` and the main profile traversal so that Result is terminal:

- compile the Result node into one marker step
- do not follow outgoing edges after Result

This prevents ambiguous flows such as `Result(pass) -> Wait -> Result(fail)`.

### Browser Core

Extend `libs/browser-core/src/lib/types.ts` with the resolved result step/result types.

Update `CloakBrowserService.runFlow()`:

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

`failResult()` should also support `result`, although it should rarely be used.

### Run Service

Update `RunService.executeFlow()` mapping so `result` step records include `nodeId`
and `kind`. A `result(fail)` marker should not automatically make
`FlowRunRecord.status` equal `'failed'`; it is a user-defined board verdict, not a
browser/runtime error. Runtime status remains:

- `'failed'` only for actual step execution failure
- `'completed'` when the flow executed successfully, even if it reached Result(fail)

This separation avoids confusing "automation failed to run" with "test assertion
failed".

## Validation

Frontend validation should stay minimal:

- `kind` must be `'pass'` or `'fail'`.
- Result may have no outgoing edges.
- If Result is terminal in the UI (no source handle), no extra topology validation is
  needed.

Backend graph resolution should also treat unknown/missing `kind` as invalid or
normalize it to `'pass'`. Prefer validation/normalization in the chain registry:

- missing kind: default to `'pass'` for old/partial saved data
- invalid kind: throw `BoardGraphError`

## Testing

### Unit Tests

Add/extend tests for:

- `resolveChains()` compiles a Result node into `{ type: 'result', nodeId, kind }`.
- `resolveChains()` stops traversal after Result.
- `resolveChains()` includes Result markers inside compiled `if` branch step lists.
- `CloakBrowserService.runFlow()` emits only the Result marker from the branch selected
  at runtime.
- `CloakBrowserService.runFlow()` emits result records without touching the page.
- `RunService.executeFlow()` preserves `result` records in API output.
- `BoardList` applies pass/fail row classes from `boardStatuses`.
- `FlowCanvas` aggregates result records with fail taking priority.

### Manual Verification

1. Create board:
   `Profile -> Goto -> If`.
2. Wire `If true -> Result(pass)`.
3. Wire `If false -> Wait(5000) -> Result(fail)`.
4. Run with a selector that exists.
   - Pass Result node turns green.
   - Board row in sidebar turns green.
5. Change condition/selector so false branch executes.
   - Fail Result node turns red.
   - Board row in sidebar turns red.
6. Reload page.
   - Sidebar pass/fail color disappears.
   - Saved graph still contains Result nodes.
7. Run a board with no Result node.
   - No pass/fail sidebar color is applied.
   - Existing run status UI remains unchanged.

## Non-Goals

- Persisting latest board pass/fail status.
- Adding historical test result timelines.
- Treating `Result(fail)` as runtime `FlowRunRecord.status = 'failed'`.
- Supporting arbitrary assertion logic inside Result. Conditions remain the job of
  existing `If` nodes.
- Styling the top canvas header based on pass/fail.

## Implementation Notes

- Exact green/red Tailwind classes should be chosen during implementation to match the
  existing brutalist black/white board UI.
- If future users want persisted statuses, add a separate `lastResult` field to
  `BoardRecord`; do not overload graph data with runtime state.
