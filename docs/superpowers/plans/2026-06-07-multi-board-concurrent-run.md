# Multi-Board Concurrent Run Implementation Plan

> **Status:** Implemented 2026-06-07

**Goal:** Run multiple boards concurrently from the sidebar (Run All + Run Selected).

**Architecture:** Frontend-only — `useBoardRunner` orchestrates parallel `api.runBoard` calls;
`FlowCanvas` exposes `persistNow` / `applyRunResult` for the open board in a batch.

**Tech Stack:** React, Vitest, existing NestJS board run API

---

Implemented files:

- `apps/web/src/hooks/use-board-runner.ts` — batch orchestration
- `apps/web/src/hooks/use-board-runner.spec.ts` — 5 tests
- `apps/web/src/components/automation/board-list.tsx` — checkboxes + run buttons
- `apps/web/src/components/automation/automation-sidebar.tsx` — error banner
- `apps/web/src/components/automation/automation-page.tsx` — wiring
- `apps/web/src/components/automation/flow-canvas.tsx` — persist/apply ref methods

Verification: `pnpm exec nx test web -- src/hooks/use-board-runner.spec.ts src/components/automation/board-list.spec.tsx`
