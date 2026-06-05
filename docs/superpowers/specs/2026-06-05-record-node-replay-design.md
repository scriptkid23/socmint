# Record Node — Record / Replay Design

**Date:** 2026-06-05  
**Status:** Approved

## Summary

Extend the existing **Record** board node so operators can:

1. **Record mode (default):** Run the board → upstream nodes execute (e.g. Goto) → browser stays open → user interacts → **Stop** saves all interactions into `steps[]` on the board graph (Selenium IDE–style capture).
2. **Replay mode:** Edit saved steps (selectors, input values, URLs) → Run the board → the full script replays automatically via `runFlow` (goto / click / fill / scroll).

A **Record | Replay** toggle on the node switches compile behavior and UI (read-only list vs editable step table).

## Decisions (from brainstorming)

- **Record trigger:** Option **A** — keep board **Run** as the entry point; Record node at chain end uses `endsWithRecord` to attach `InteractionRecorder` after upstream steps complete.
- **Single node with mode toggle** (not separate Record/Replay nodes).
- **Replay uses stored CSS selectors** from capture; `fill`/`click` flow steps already exist in `runFlow`.
- **Scroll replay:** add a `scroll` `FlowStep` (direction only — matches current recorder).
- **No step reorder in v1**; delete row supported in replay editor.
- **`recording` is runtime UI state** — not persisted in board JSON.

## Current state

| Exists | Gap |
|--------|-----|
| `InteractionRecorder` captures navigate, click, type, scroll | Replay ignores click/type/scroll |
| `record.toSteps()` only expands `navigate` → goto | No `mode` branch |
| `fill` / `click` in `runFlow` | No `scroll` flow step |
| Record node UI: Start/Stop, read-only list | No toggle, no inline edit |

## Architecture

```
apps/web                         apps/automation-api                    libs/browser-core
┌─────────────────┐             ┌──────────────────────────┐          ┌────────────────────┐
│ RecordNode      │   PATCH     │ node-registry.record     │          │ InteractionRecorder │
│  mode toggle    │ ──────────► │  .toSteps(node)            │          │  (capture)          │
│  step editor    │             │   ├ record → endsWithRecord│          │ runFlow()           │
│  (replay mode)  │   Run       │   └ replay → compile all   │ ───────► │  goto/click/fill/  │
└─────────────────┘ ──────────► │ recorded-steps-to-flow.ts  │          │  scroll             │
                                 │ resolveChains → executeFlow│          └────────────────────┘
                                 └──────────────────────────┘
```

### Record mode — Run flow

1. `resolveChains` walks profile → … → record.
2. `record.toSteps` (mode=`record`): emit saved `navigate` steps as `goto` + short `wait`; set `endsWithRecord: true`.
3. `RunService.executeFlow` runs gotos, then `runFlow` with `keepOpenForRecording`.
4. `RecordingRegistry.registerFromFlow` attaches live recorder.
5. UI polls `GET /profiles/:id/recording-session`; **Stop** → `DELETE` → steps written to node + board autosave.

### Replay mode — Run flow

1. `record.toSteps` (mode=`replay`): `compileRecordedSteps(steps)` → full `FlowStep[]`; **no** `endsWithRecord`.
2. `executeFlow` → `runFlow` executes goto, click, fill, scroll sequentially; browser closes on completion.
3. Step values/selectors are whatever the user edited in the replay table.

## Data model

### RecordNodeData (board graph)

```ts
export type RecordNodeMode = 'record' | 'replay';

export interface RecordNodeData {
  mode?: RecordNodeMode; // optional for backward-compat; missing → 'record'
  steps: RecordedStep[];
}
```

Empty `value` on a replay `type` step is allowed (clears the field); only an empty `selector` is a validation error.

`RecordedStep` unchanged (`libs/browser-core/src/lib/recorded-step.types.ts`).

### New FlowStep variant

```ts
| { type: 'scroll'; direction: 'up' | 'down' }
```

Mapped to `ResolvedFlowStep` and executed via `PageActions.scroll(direction)` in `runFlow`.

### Compile: `compileRecordedSteps(steps: RecordedStep[]): FlowStep[]`

| RecordedStep | FlowStep(s) |
|--------------|-------------|
| `navigate` | `goto { url }`, `wait { ms: 300 }` |
| `click` | `click { selector }` — error if selector empty |
| `type` | `fill { selector, value }` |
| `scroll` | `scroll { direction }` |

Skip `about:` navigates. After each click/fill/scroll in replay, optional `wait { ms: 150 }` for DOM stability (reuse perf nav-probe pattern).

## UI — Record node

### Toggle

Segmented control: **Record** | **Replay** — updates `data.mode`, autosaves board.

### Record mode

- Help text: Run board → interact → Stop (unchanged).
- Step list read-only.
- Buttons: Stop (when live), Clear (when idle and steps exist).
- Remove standalone Start (Run board is the entry point per decision A).
- `flow-canvas` sets `recording: true` on Run only when `mode === 'record'` and chain ends with record.

### Replay mode

- Editable table per step:
  - navigate: `url` input
  - click: `selector` input (+ read-only `text` hint)
  - type: `selector` + `value` inputs
  - scroll: direction select
- Delete row button per step.
- Run board executes replay; no live recording UI.

### Validation (replay)

- `mode === 'replay'` and `steps.length === 0` → graph error on record node.
- click/type steps with empty selector → graph error.

## Non-goals (v1)

- Drag-and-drop step reorder.
- `text=` selector fallback at replay time.
- Standalone Record without Run board.
- Full-page screenshot after replay script.

## Testing

- `recorded-steps-to-flow.spec.ts` — compile all step types, skip about:blank, errors on empty selector.
- `resolve-chains.spec.ts` — record replay expands click/fill/scroll; record mode keeps endsWithRecord.
- `cloak-browser.service.spec.ts` — scroll step in runFlow.
- `graph-validation.spec.ts` — replay empty steps, invalid selector.
- Web: record-node toggle + edit value propagates via `onChange`.

## Harness

Register feature `record-node-replay` when implementation starts; verification: `pnpm exec nx test browser-core && pnpm exec nx test automation-api && pnpm exec nx test web`.
