# Automation Flow Board — Design

**Date:** 2026-06-02
**Status:** Approved (design)

## Summary

Add an **Automation** tab to the web app with a React Flow node-editor "board". On a
board the user drags **Profile nodes** and **action nodes** (Goto, Screenshot) and wires a
profile node into a chain of actions to "bind" a flow to that profile. Pressing **Run**
walks the graph, builds one linear step-chain per profile, and executes every profile's
chain in parallel through the existing browser stack.

Boards are persisted as JSON on the backend (same pattern as profiles/runs). Multiple
named boards are supported.

## Decisions (from brainstorming)

- **Node actions (v1):** Goto + Screenshot only. No click/type/wait/extract/eval yet.
- **Binding model:** A single canvas holds both Profile nodes and action nodes; connecting
  a Profile node to an action chain binds the flow to that profile.
- **Persistence:** Multiple boards, stored as JSON files on the backend.
- **Execution:** Parallel per profile (`LockService` already locks per profile).
- **Architecture:** Approach A — backend is the source of truth. The board stores the
  React Flow graph verbatim; the backend resolves chains from the graph at run time.

## Architecture & Data Flow

```
apps/web (React Flow)                 apps/automation-api (NestJS)              libs/browser-core
┌─────────────────────────┐           ┌──────────────────────────┐            ┌────────────────┐
│ AutomationPage          │  CRUD     │ boards/                  │            │ CloakBrowser   │
│  ├ BoardList (chọn/tạo) │ ───────►  │  BoardsController         │            │  Service       │
│  └ FlowCanvas           │  /boards  │  BoardService             │            │  + runFlow()   │
│     ├ ProfileNode       │           │  BoardStore (JSON file)   │            └────────────────┘
│     ├ GotoNode          │           │                          │                   ▲
│     └ ScreenshotNode    │  Run      │ runs/ (extended)         │                   │
│        Save (autosave)  │ ───────►  │  RunService.executeFlow() │ ──────────────────┘
│        Run ──────────── │ /boards/  │   ↳ resolveChains(graph)  │  parallel per profile
└─────────────────────────┘  :id/run  │   ↳ Promise.all per profile
                                       └──────────────────────────┘
```

**Run flow:**
1. User builds a board (Profile + action nodes, wired). Changes autosave to `PATCH /boards/:id`.
2. **Run** → `POST /boards/:id/run`.
3. Backend `resolveChains(graph)`: for each ProfileNode, follow outgoing edges into a linear
   chain of `{ goto | screenshot }` steps.
4. `Promise.all(chains.map(c => runService.executeFlow(c.profileId, c.steps)))` runs each
   profile independently. `LockService` prevents a profile from running twice concurrently.
5. Returns a `BoardRunRecord` listing each profile's `FlowRunRecord`; the UI shows status.

**Navigation:** Add an "Automation" item to `profile-nav.tsx`. Use lightweight hash-based
tab switching (`#profiles` default, `#automation`) in `app.tsx` — no router library yet.

## Data Model

Board, persisted at `dataRoot/boards/<id>.json` (mirrors `ProfileStore`):

```ts
interface BoardRecord {
  id: string;            // uuid
  name: string;
  graph: BoardGraph;     // React Flow graph stored verbatim
  createdAt: string;
  updatedAt: string;
}

interface BoardGraph {
  nodes: BoardNode[];
  edges: BoardEdge[];    // { id, source, target }
}

type BoardNode =
  | { id: string; type: 'profile';    position: {x:number,y:number}; data: { profileId: string | null } }
  | { id: string; type: 'goto';       position: {x:number,y:number}; data: { url: string; waitUntil?: WaitUntil; timeoutMs?: number } }
  | { id: string; type: 'screenshot'; position: {x:number,y:number}; data: Record<string, never> };
```

`position` is for canvas rendering only; the backend ignores it when executing and uses
only `type`, `data`, and `edges`.

### Graph → steps resolution (`resolveChains`)

- Each **ProfileNode** is the head of one "job".
- Follow outgoing edges (`source → target`) into a **linear chain** of `goto`/`screenshot` steps.
- v1 constraints (violations → 400 with the offending node id):
  - Each node has **at most one outgoing edge** (linear; no branching, no cycles).
  - ProfileNode `profileId` must be set and reference an existing profile.
  - A `profileId` may appear in **at most one** ProfileNode (duplicate → 400; surfaces the
    `LockService` conflict early and clearly).
- A ProfileNode wired to no step is skipped (warning, not run).

### Run results

```ts
interface BoardRunRecord {
  id: string;            // batch uuid
  boardId: string;
  startedAt: string;
  finishedAt: string;
  runs: FlowRunRecord[]; // one per profile
}

interface FlowRunRecord {          // generalization of the current RunRecord
  id: string;
  profileId: string;
  status: 'completed' | 'failed';
  startedAt: string;
  finishedAt: string;
  error: string | null;
  steps: StepResult[];   // { type, ...input, finalUrl?, title?, screenshot? path }
}
```

`FlowRunRecord` replaces the single-URL `RunRecord` (backward compatible: a one-URL run is a
one-step `goto` chain). Step screenshots are saved at `artifacts/runs/<runId>/step-<n>.png`.
The audit logger is reused.

## Frontend (React Flow)

**Library:** add `@xyflow/react` (React Flow v12 — the renamed package; `reactflow` is the
old name). Import `@xyflow/react/dist/style.css`. Compatible with React 19.

**New files under `apps/web/src`:**
```
api/client.ts          (+ boards CRUD, runBoard)
hooks/use-boards.ts     (list/create/update/delete, debounced autosave)
components/automation/
  ├ automation-page.tsx     // layout: BoardList + FlowCanvas + toolbar
  ├ board-list.tsx          // select / create / rename / delete board
  ├ flow-canvas.tsx         // <ReactFlow> + nodeTypes + palette + Save/Run
  ├ node-palette.tsx        // add-node buttons: Profile / Goto / Screenshot
  └ nodes/
      ├ profile-node.tsx    // profile dropdown (from useProfiles)
      ├ goto-node.tsx       // url input + waitUntil
      └ screenshot-node.tsx // no config
```

**Canvas interactions:**
- Palette (canvas corner) has 3 add-node buttons. Drag handles to create edges.
- **ProfileNode:** dropdown sourced from real profiles (reuse `use-profiles.ts`); **output**
  handle only.
- **GotoNode:** URL input + `waitUntil` select; input & output handles.
- **ScreenshotNode:** icon only; input & output handles.
- Styling follows the existing neo-brutalist system (`border-2 border-foreground`, mono
  uppercase) to match `profile-table.tsx`.

**Save UX:** debounced autosave (~800ms) after node/edge changes → `PATCH /boards/:id`.
"Saved/Saving" badge.

**Run UX:** **Run** button → `POST /boards/:id/run`. Before sending, client-side validation
(≤1 outgoing edge per node, ProfileNode has a profile, no duplicate profiles) highlights bad
nodes. While running: toast + results panel listing each profile (completed/failed, screenshot
links). The backend re-validates (source of truth).

**Navigation:** `profile-nav.tsx` gains an "Automation" item; `app.tsx` switches the panel by
hash (`#profiles` default, `#automation`).

## Backend (NestJS + browser-core)

**New `boards/` module** (alongside `profiles/`, `runs/`):
```
apps/automation-api/src/boards/
  ├ board.types.ts        // BoardRecord, BoardGraph, BoardNode, BoardEdge
  ├ board.store.ts        // read/write JSON dataRoot/boards/<id>.json (ProfileStore pattern)
  ├ board.service.ts      // CRUD + name validation; resolveChains(graph)
  ├ board.response.ts     // Swagger DTO
  ├ dto.ts                // CreateBoardDto, UpdateBoardDto (class-validator)
  ├ boards.controller.ts  // REST
  └ *.spec.ts
```

**REST endpoints:**

| Method | Path | Purpose |
|---|---|---|
| GET | `/boards` | list (metadata; graph omitted) |
| POST | `/boards` | create empty board `{ name }` |
| GET | `/boards/:id` | get board + graph |
| PATCH | `/boards/:id` | update `name` and/or `graph` (autosave) |
| DELETE | `/boards/:id` | delete |
| POST | `/boards/:id/run` | run → returns `BoardRunRecord` |

**`resolveChains(graph)`** (in BoardService, pure, easily tested): graph in →
`Array<{ profileId, steps: FlowStep[] }>` out. Applies the constraints above; violations
throw `DomainException`, which the existing exception filter maps to 400.

**`RunService.executeFlow(profileId, steps[])`** (extension):
- Keep `execute()` for the single-URL run (internally calls `executeFlow` with one step); the
  existing API is unchanged.
- Acquire lock on profileDir → open one context → run steps sequentially → release lock →
  write `artifacts/runs/<runId>/result.json` + audit.
- Per-node screenshots saved as `step-<index>.png`.

**`POST /boards/:id/run`** in BoardsController:
- `chains = boardService.resolveChains(graph)`.
- `Promise.all(chains.map(c => runService.executeFlow(c.profileId, c.steps)))` — parallel.
- One profile's failure does **not** fail the batch — `executeFlow` catches its own error and
  returns `status:'failed'` (as `execute()` does today). Wrapped into a `BoardRunRecord`.

**browser-core (`cloak-browser.service.ts`):**
- Add `runFlow(launch, steps[])`: open `launchPersistentContext` **once**, `newPage`, loop the
  steps (`goto` → `page.goto`; `screenshot` → `page.screenshot`), return per-step results,
  `finally` close the context.
- Extend `PageLike`/types as needed. `runPage` is kept (or rewritten on top of `runFlow` with
  one step). Update the `cloakbrowser.mock.ts` test seam accordingly.

**Wiring:** register `BoardStore`, `BoardService`, `BoardsController` in `app.module.ts`
following the existing `useFactory` + `inject` pattern.

## Testing

TDD throughout, matching the repo's existing convention (per-service/store `.spec.ts`; e2e
uses the CloakBrowser mock).

**Unit (Jest, pure, no Chromium):**
- `board.store.spec.ts` — write/read/delete JSON, graph round-trip, missing file → null.
- `board.service.spec.ts` — CRUD + **`resolveChains`** (focus): straight chain for one
  profile; multiple profiles → multiple jobs; branching node (>1 outgoing edge) → error;
  null/missing profile → error; duplicate profile → error; dangling ProfileNode → skipped;
  cycle detection.
- `dto.spec.ts` — validate CreateBoardDto/UpdateBoardDto (mirrors `profiles/dto.spec.ts`).
- `cloak-browser.service.spec.ts` — `runFlow` with a fake launcher: steps run in order,
  context closes even when a mid-chain step throws, screenshot written to the right path.
- `run.service.spec.ts` — `executeFlow` multi-step: lock acquire/release, writes
  `result.json` + audit, a failing step → `status:'failed'`, screenshot `step-<n>.png`.

**E2E (extend `run-flow.e2e.spec.ts` with the CloakBrowser mock):**
- Create board → PATCH graph (profile→goto→screenshot) → `POST /boards/:id/run` →
  `BoardRunRecord` with one completed run and an artifact.
- Multiple profiles → batch runs; one profile failing does not break the others.
- Invalid graph → 400.

**Frontend (Vitest + Testing Library, per `use-profiles.spec.tsx`):**
- `use-boards` — list/create/autosave hit the right endpoints (mock fetch).
- Client-side validation in flow-canvas (pure helper) — detects bad nodes.
- (React Flow rendering in jsdom is limited; prefer testing pure logic split out from the canvas.)

**Manual verify:** run `nx serve automation-api` + `nx serve web`, build a real board with one
logged-in profile, Run, inspect screenshots under `artifacts/`.

## Out of scope (v1)

- Action nodes beyond Goto/Screenshot (click, type, wait, scroll, extract, eval).
- Branching/looping graphs; only linear chains per profile.
- Scheduling/cron, retries, concurrency caps across profiles.
- Sharing the same action chain across multiple profile nodes.
- Persisted board-run history UI (results shown for the current run only).
