# CloakBrowser UI + Interactive Login — Design Spec

**Date:** 2026-06-02
**Status:** Approved (brainstorming)
**Scope:** Lean MVP — React UI + interactive browser-login profile capture, on top of the existing profile backend. Local single-operator.

## Context

Builds on `2026-06-02-cloakbrowser-profile-automation-design.md`. That spec defined profile CRUD over the filesystem, an exclusive lock-file concurrency gate, a framework-agnostic `browser-core` library, and a synchronous URL-run automation flow.

This spec changes the **primary user flow** to interactive login capture and adds a **React UI**:

- The operator clicks **Create** in the UI → a real (non-headless) Chromium window opens → the operator logs into platforms manually (multiple tabs allowed) → the operator **closes the window** → cookies/localStorage are persisted into the profile's `user-data/` and the profile is marked ready.
- The **URL-run automation** backend (`runs/*`, `RunService`, run endpoints, run audit) from the prior spec is **deferred** (not deleted) to a later phase. It is out of scope for this MVP.

Everything runs on the operator's own machine: UI, NestJS API, and Chromium are co-located, so the browser window appears on the operator's screen. No screen streaming (VNC/noVNC) is involved.

### Compliance boundary (SOCMINT)

- Login is performed by a **human operator** using accounts they are **authorized** to use. The system never automates credential entry and never bypasses authentication or anti-bot protections.
- Use only for permitted purposes: public pages, evidence capture, internal testing, and authorized account sessions.
- Every interactive session is audited: `profileId`, `sessionId`, `openedAt`, `closedAt` appended to an append-only log.

## Goals

1. Create, list, update (label/proxy), and delete browser profiles backed by local `userDataDir`.
2. **Interactive login capture:** open a visible Chromium window bound to a profile, let the operator log in, and persist the session when the window closes.
3. A React UI (Minimalist Monochrome design system) to drive the above.
4. Keep CloakBrowser usage isolated in `libs/browser-core` for reuse.

## Non-goals (this MVP)

- URL-run automation, run records, screenshots-of-arbitrary-pages (deferred — covered by the prior spec/plan).
- Remote/hosted deployment, screen streaming, multi-user auth/RBAC.
- PostgreSQL, job queue/BullMQ, S3 sync, Kubernetes.
- SSE/WebSocket live updates (UI polls; SSE is a future enhancement).
- Pre-defined platform start-URL lists / auto-opened tabs (operator navigates manually).

## Architecture

Nx integrated monorepo (pnpm). Three projects:

| Project | Responsibility |
|---------|----------------|
| `libs/browser-core` | CloakBrowser wrapper behind the `BrowserLauncher` seam; one-shot `runPage` (existing) **plus** `openInteractiveSession` (new). No HTTP, no NestJS in the core class. |
| `apps/automation-api` | Profile CRUD, exclusive locking, **interactive session module** + in-process `SessionRegistry`, audit, loopback bind, bootstrap warm-up. |
| `apps/web` | React 19 + Vite + TypeScript + Tailwind + shadcn/ui. Profile management + interactive-login UI in the Minimalist Monochrome style. |

### Reused from the prior spec (unchanged)

`ProfileStore`, `LockService` (exclusive `profile.lock`, stale-TTL recovery), path resolver + traversal guard, `AppConfig`/`loadConfig`, `AuditLogger`, bootstrap `ensureBinary()` + stale-lock sweep + `HOST=127.0.0.1` bind. Profile `create/list/get/update/delete` lifecycle. Environment variables (`DATA_ROOT`, `ARTIFACTS_ROOT`, `PROFILE_LOCK_TTL_MS`, `HOST`, `CLOAKBROWSER_BINARY_PATH`).

### Repository layout (delta over prior spec)

```
socmint/
├── apps/
│   ├── automation-api/src/
│   │   ├── profiles/            # reused: store, lock, service, dto, controller, types
│   │   ├── sessions/            # NEW
│   │   │   ├── session.registry.ts
│   │   │   ├── sessions.controller.ts
│   │   │   └── session.types.ts
│   │   ├── runs/                # DEFERRED — not built in this MVP
│   │   └── app/                 # config, app.module, main, domain-exception.filter
│   └── web/                     # NEW React app
│       └── src/
│           ├── api/client.ts
│           ├── hooks/use-profiles.ts
│           ├── components/layout/sidebar.tsx       # NEW — nav (shared desktop + drawer)
│           ├── components/layout/app-layout.tsx    # NEW — shell + mobile drawer + Outlet
│           ├── components/profile-list.tsx
│           ├── components/create-profile-dialog.tsx
│           ├── components/ui/   # themed primitives (button, input, badge, dialog)
│           ├── pages/profiles-page.tsx             # NEW — profile mgmt view (was app.tsx body)
│           ├── styles/theme.css # centralized design tokens
│           ├── app.tsx          # router (Routes)
│           └── main.tsx         # BrowserRouter + mount
└── libs/browser-core/src/lib/
    ├── types.ts                 # + on('close') on BrowserContextLike, InteractiveSession
    └── cloak-browser.service.ts # + openInteractiveSession
```

## Profile model changes

- `status`: `idle | authenticating` (the `running` value from the prior spec is unused in this MVP).
- Add `lastLoginAt: string | null` — set to the close timestamp each time an interactive session ends successfully. Lets the UI show "session captured".

`profile.json` (updated relevant fields):

```json
{
  "id": "uuid",
  "label": "string",
  "userDataDir": "profiles/{id}/user-data",
  "proxy": "string | null",
  "fingerprintSeed": "string | null",
  "launchDefaults": { "headless": false, "geoip": false },
  "status": "idle | authenticating",
  "lastLoginAt": "ISO-8601 | null",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

> Note: interactive login always launches with `headless: false` regardless of `launchDefaults.headless` (a headless window cannot be logged into). `launchDefaults.headless` is retained for the deferred run-automation phase.

## `browser-core` changes

### Type additions (`types.ts`)

```ts
export interface BrowserContextLike {
  newPage(): Promise<PageLike>;
  on(event: 'close', listener: () => void): void;   // NEW
  close(): Promise<void>;
}

export interface InteractiveSession {
  /** Register a callback fired exactly once when the context closes
   *  (operator closed the window, or close() was called). */
  onClosed(listener: () => void): void;
  /** Force-close the context (also triggers onClosed). */
  close(): Promise<void>;
}
```

### `CloakBrowserService.openInteractiveSession`

```
openInteractiveSession(launch: LaunchOptions): Promise<InteractiveSession>
```

1. `launchPersistentContext({ ...launch, headless: false })`.
2. Ensure a visible window: if the context has no page, call `newPage()`.
3. Wire `context.on('close', …)` to fan out to registered `onClosed` listeners (guard so listeners fire once).
4. Return an `InteractiveSession` whose `close()` calls `context.close()`.

The service still depends only on `BrowserLauncher`, so it is unit-tested with a fake context that can emit a synthetic `close`.

## `automation-api` — interactive session module

### `SessionRegistry` (Approach A: in-process)

In-memory `Map<profileId, { sessionId: string; session: InteractiveSession; startedAt: string }>`.

**`open(profileId): Promise<{ sessionId; status }>`**
1. `profiles.get(profileId)` → `ProfileNotFoundError` (404).
2. `lock.acquire(profileDir, process.pid)` → `ProfileBusyError` (409) if a live session/lock exists.
3. Set profile `status = 'authenticating'`.
4. `browser.openInteractiveSession({ userDataDir, proxy, geoip })` (headless forced false in the service).
5. Generate `sessionId` (UUID), store in the map, register `onClosed → cleanup(profileId)`.
6. Append audit entry `{ profileId, sessionId, event: 'opened', at }`.
7. Return `{ sessionId, status: 'authenticating' }` (HTTP **202**).
8. **Failure rollback:** if step 4 throws after the lock is held, release the lock, set `status = 'idle'`, and rethrow (→ 500, or 503 if a binary-unavailable error).

**`cleanup(profileId)`** (fired when the operator closes the window):
- Release the lock, set `status = 'idle'`, set `lastLoginAt = now`, append audit `{ event: 'closed', at }`, remove from the map. Idempotent.

**`close(profileId): Promise<void>`** — force-close: look up the session, call `session.close()` (triggers `cleanup` via `onClosed`). No-op if no active session. HTTP **204**.

**`onModuleDestroy()`** — on app shutdown, `close()` every active session so state persists cleanly.

### HTTP API (this MVP)

| Method | Path | Description | Codes |
|--------|------|-------------|-------|
| `POST` | `/profiles` | Create profile (status `idle`) | 201 |
| `GET` | `/profiles` | List profiles | 200 |
| `GET` | `/profiles/:id` | Get profile (UI polls this) | 200, 404 |
| `PATCH` | `/profiles/:id` | Update `label`/`proxy` (reject if `authenticating`) | 200, 404, 409 |
| `DELETE` | `/profiles/:id` | Delete (reject if live lock) | 204, 404, 409 |
| `POST` | `/profiles/:id/login-session` | Open interactive login window | 202, 404, 409, 503 |
| `DELETE` | `/profiles/:id/login-session` | Force-close the login window | 204 |

Errors map via the existing `DomainExceptionFilter`: `ProfileNotFoundError`→404, `ProfileRunningError`/`ProfileBusyError`→409. Binary-unavailable→503 (mitigated by bootstrap `ensureBinary()`).

### Concurrency

- At most **one active session per profile** (exclusive lock — unchanged authority).
- Each session is one visible Chromium window on the local machine. No global cap in MVP; documented as a follow-up if window-spam becomes an issue.
- API restart mid-session: the in-process map is lost; the orphaned lock is cleared by the stale-TTL sweep on next boot.

## Data flow — "Create profile → browser appears"

```
UI "Create" (label[, proxy])
  → POST /profiles                         (201, profile idle)
  → POST /profiles/:id/login-session       (202, status authenticating)
      API: lock + openInteractiveSession → Chromium window opens on screen
  operator logs into platforms (multiple tabs) → closes the window
      API: context 'close' → cleanup: release lock, status idle, lastLoginAt=now, audit closed
  UI polls GET /profiles/:id every ~1.5s while any profile is authenticating
      → sees status idle → toast "Session saved ✓", shows lastLoginAt
```

A row action **"Log in again"** re-opens a session for an existing profile (same `POST …/login-session`).

## Error handling

- Profile not found → 404 + toast.
- Profile already has an active session → 409 + toast ("Profile is logging in").
- Browser fails to launch → rollback to `idle`, surface 500/503, toast; lock not leaked.
- Binary unavailable → 503 (bootstrap warm-up makes this rare).
- API offline / network error → UI connection-error toast; polling backs off.

## UI design language — Minimalist Monochrome

Pure black/white, serif-as-hero, zero radius, no shadows, line-based structure, dramatic negative space, inversion for emphasis. The editorial design system is **adapted to a functional admin tool**: keep the DNA, omit marketing sections (no hero/pricing/testimonials/blog).

### Centralized tokens

`apps/web/src/styles/theme.css` defines `:root` CSS variables; `tailwind.config` references them. shadcn/ui primitives (Button, Dialog, Input, Table, Badge, Sonner toaster) are **re-themed through these tokens** — no per-component one-off styles.

- Colors: `--background:#FFFFFF`, `--foreground:#000000`, `--muted:#F5F5F5`, `--muted-foreground:#525252`, `--border:#000000`, `--border-light:#E5E5E5`. No other colors.
- Fonts (via `@fontsource`): **Playfair Display** → `font-display`; **Source Serif 4** → `font-serif` (body); **JetBrains Mono** → `font-mono` (labels/metadata/timestamps).
- `--radius: 0` everywhere; **no box-shadow** anywhere; type scale extended through `8xl`/`9xl`.
- Global texture: subtle `repeating-linear-gradient` horizontal lines + SVG noise at opacity ~0.015–0.02.
- Border weights: hairline `1px #E5E5E5`, thin `1px #000`, medium `2px #000`, thick `4px #000`.
- Motion: instant/binary, ≤100ms transitions (color inversion on hover); 300ms only where explicitly editorial.

### Dashboard shell & navigation

The app is a **dashboard with a fixed left sidebar**, using `react-router-dom`:

- **Routing:** `main.tsx` wraps the tree in `<BrowserRouter>`. `app.tsx` declares `<Routes>` with a single layout route (`AppLayout`) whose child `index` renders `ProfilesPage`; a catch-all `*` redirects to `/profiles`. (Only the Profiles route exists in this MVP; the router is in place so future tabs add a route + nav entry without restructuring.)
- **`AppLayout`** (`components/layout/app-layout.tsx`): the shell.
  - *Desktop (`md+`):* CSS grid `[aside w-64, thin 1px black right border | content]`; content renders `<Outlet/>`. `<Toaster/>` mounted once here.
  - *Mobile:* the aside is hidden; a slim top bar shows the **SOCMINT** wordmark + a **hamburger** button (Lucide, `strokeWidth 1.5`, `aria-label`). The hamburger opens a **left off-canvas drawer** built on **Radix Dialog** (focus-trap + Esc for free) that renders the same `<Sidebar/>`.
- **`Sidebar`** (`components/layout/sidebar.tsx`): **SOCMINT** wordmark (Playfair) at top → **thick 4px** rule → nav list of `NavLink`s. One item now: **Profiles**. Items are mono uppercase `tracking-widest`; the **active** link inverts (black bg / white text); hover underlines. Shared verbatim between the desktop aside and the mobile drawer (no markup duplication).
- **`ProfilesPage`** (`pages/profiles-page.tsx`): owns the profile-management view (masthead + `CreateProfileDialog` + `ProfileList` + `useProfiles` polling + the create/login/delete handlers). This is the body that previously lived in `app.tsx`.

### Screens

- **Masthead** (inside `ProfilesPage`): oversized Playfair `PROFILES` (`tracking-tight`), a **thick 4px** rule beneath, a small bordered square as visual punctuation; mono uppercase `tracking-widest` subtitle.
- **Profile table (editorial):** thin black borders, 0 radius, 0 shadow; column headers in mono uppercase; **rows invert** (black bg / white text) on hover at 100ms; `lastLoginAt`/`id` in JetBrains Mono; status `authenticating` = inverted (black) mono chip, `idle` = outlined chip; row actions: Log in again, Edit label, Delete.
- **Create button:** primary black/white, uppercase `tracking-widest`, hover **invert**, trailing `→`.
- **CreateProfileDialog:** sharp corners, `medium 2px` black border, no shadow; inputs with **2px bottom border** thickening to **4px** on focus, gray-italic placeholder, no colored ring.
- **Authenticating indicator:** instant/binary per the system — a hairline progress bar + blinking mono label `OPENING BROWSER —`, not a gradient spinner.
- **Empty state:** strong negative space + an oversized serif statement (e.g. *"No profiles yet."*).
- **Icons:** Lucide, `strokeWidth={1.5}`, black, 20px.
- **Accessibility:** `focus-visible` outline 3px / offset 3px on buttons; input border thickens on focus; 21:1 contrast; touch targets ≥44px; visible black skip-link.
- **Responsive:** headline scales `9xl→5xl` on mobile, columns stack, borders become full-width rules; monochrome drama preserved.

### UI ↔ API integration

- API client (`fetch` wrapper) calls `/api/*`; **Vite dev proxy** maps `/api → http://127.0.0.1:3000` (avoids CORS in dev).
- `useProfiles(pollMs = 1500)` hook (in `ProfilesPage`): fetch list; poll **only while** at least one profile is `authenticating`; stop when none are. `pollMs` is injectable for deterministic tests.
- Navigation is `react-router-dom` only; no global state-management library (YAGNI). The sidebar performs no API calls.

## Testing strategy (MVP)

| Level | Target |
|-------|--------|
| Unit (`browser-core`) | `openInteractiveSession`: visible-window guard, `onClosed` fires once on synthetic `close`, `close()` closes context — via fake context. |
| Unit (`automation-api`) | `SessionRegistry` with a fake `CloakBrowserService`: `open` acquires lock + sets `authenticating` + audits; simulated close → `cleanup` sets `idle` + `lastLoginAt` + releases lock; double `open` → 409; `open` launch-failure rolls back lock + status; `close()` force-cleans. Reuse prior `ProfileService`/`LockService`/`ProfileStore` tests. |
| Component (`web`) | Vitest + React Testing Library with mocked fetch: `ProfileList` renders rows + status chips; `CreateProfileDialog` submits → calls create then login-session; `useProfiles` polls then stops when idle. |
| Layout/routing (`web`) | `Sidebar` (in `MemoryRouter`) renders the wordmark + Profiles `NavLink` with `aria-current="page"` when active; `AppLayout` renders `<Outlet/>` content and the hamburger opens the drawer nav; unknown path redirects to `/profiles`. |
| Manual smoke | Create → real Chromium opens → log into a site → close window → row shows `idle` + `lastLoginAt`; second `open` while active → 409. |

## Success criteria

1. Operator creates a profile in the UI and a real Chromium window opens for login.
2. After logging in and closing the window, `data/profiles/{id}/user-data/` holds the session and the profile row shows `idle` + a `lastLoginAt`.
3. Re-opening a login session for that profile reuses the persisted cookies (site remembers the prior login).
4. A second login-session request while one is active returns **409**.
5. The UI renders in true Minimalist Monochrome: pure black/white, serif headlines, zero radius, no shadows, all tokens centralized; passes `focus-visible` accessibility checks.
6. `browser-core` has zero imports from `automation-api`; the core service has no NestJS import.
7. The app is a dashboard with a fixed left sidebar (Profiles nav, active-link inversion) on desktop and a hamburger-opened drawer on mobile; `/` and unknown paths resolve to the Profiles view.

## Approval

- **Brainstorming:** User approved local deployment, manual-close capture, profile-only UI scope, React 19 + Vite + Tailwind + shadcn/ui, lean MVP (run-automation deferred), Approach A (in-process session registry), and the Minimalist Monochrome design language adapted to an admin tool — all on 2026-06-02.
- **Dashboard shell (2026-06-02):** User approved a dashboard with a fixed left sidebar + `react-router-dom`, a single **Profiles** nav item now, fixed sidebar on desktop with a hamburger off-canvas drawer on mobile.
- **Next step:** Implementation plan via `writing-plans` skill (no code until plan approved).
