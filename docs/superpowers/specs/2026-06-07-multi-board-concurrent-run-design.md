# Multi-Board Concurrent Run — Design

**Date:** 2026-06-07
**Status:** Approved

## Summary

Allow users to run multiple automation boards at the same time from the sidebar:
**Run All** runs every board; **Run Selected** runs only checkbox-selected boards. The
existing per-board **Run** button on the canvas is unchanged.

## Decisions

- **Approach:** Frontend-only — parallel `POST /boards/:id/run` calls via
  `Promise.allSettled`. No new backend endpoint.
- **Selection:** Checkboxes on board rows + Run All + Run Selected (option C).
- **Profile conflicts:** Existing `LockService` returns `Profile already running`; the
  failing board row shows no pass/fail color and the error is surfaced in a banner.
- **Unsaved graph:** If the open board is in the batch, persist it before running.
- **Status UI:** Reuse ephemeral `boardStatuses` (pass/fail row colors). Add a running
  indicator (dot/spinner) while a board is in flight.
- **Out of scope:** Persisted last-run status, profile conflict pre-check, queue/retry.

## User Experience

### Sidebar header

Two buttons above the board list:

- **Run All** — runs every board concurrently.
- **Run Selected** — runs checked boards; disabled when none checked.

Both disabled while any batch run is in progress.

### Board rows

- Checkbox on the left (click does not change board selection).
- Running indicator while that board's run is active.
- Pass/fail row colors unchanged (after run completes).

### Canvas Run button

Unchanged for the open board. Disabled while a batch run includes that board or while
the canvas's own run is active.

### Errors

Partial success is allowed. A banner lists boards that failed with their error message.

## Architecture

```
AutomationPage
  ├ useBoardRunner (orchestrates parallel api.runBoard)
  ├ FlowCanvas ref: persistNow(), applyRunResult()
  └ AutomationSidebar → BoardList (checkboxes + run buttons)
```

**Batch run flow:**

1. Optionally `persistNow()` if open board is in the batch.
2. Mark all target board IDs as running.
3. `Promise.allSettled(ids.map(id => api.runBoard(id)))`.
4. For each fulfilled result: compute `aggregateBoardResult`, update `boardStatuses`.
5. If open board was in batch: `applyRunResult()` on FlowCanvas.
6. Clear running state; show banner for rejections.

## Testing

- `use-board-runner.spec.ts` — parallel runs, partial failure, running state.
- `board-list.spec.tsx` — checkboxes, Run Selected disabled, callbacks.

## Verification

`pnpm exec nx test web -- src/hooks/use-board-runner.spec.ts src/components/automation/board-list.spec.tsx`
