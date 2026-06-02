# CloakBrowser Profile Management & Automation — Design Spec

**Date:** 2026-06-02  
**Status:** Approved (brainstorming)  
**Scope:** MVP — NestJS + Nx + local filesystem profiles + first automation run

## Context

SOCMINT is a greenfield repo (initial commit only). Full microservices layout is deferred. This phase builds a **profile management mechanism** and a **minimal automation run flow** using CloakBrowser from NestJS, structured for later integration into the broader SOCINT platform.

### Compliance boundary (SOCMINT)

- Use CloakBrowser only for **permitted** automation: public pages, evidence capture, internal testing.
- Do **not** design flows for login bypass, anti-bot circumvention on protected private data, or scraping where prohibited.
- Every run logs `profileId`, `runId`, `url`, and timestamp for audit. These also live in each run's `result.json`, but audit entries are additionally appended to a separate **append-only** log (e.g. `artifacts/audit.log`) so the trail survives deletion of an individual run directory.

## Goals

1. Create, list, read, update, delete browser profiles backed by local `userDataDir`.
2. Run a one-shot automation against a user-supplied URL using a profile’s persisted session.
3. Store run artifacts (result JSON, optional screenshot) on disk.
4. Isolate CloakBrowser usage in a shared Nx library for reuse by future services (e.g. `collector-service`).

## Non-goals (MVP)

- Full SOCINT microservices scaffold (`api-gateway`, `auth-service`, …).
- PostgreSQL for profile metadata (JSON on filesystem only).
- Job queue / async workers (synchronous run in API process).
- Multi-step workflow DSL, React Flow UI, or worker pods.
- Puppeteer driver (Playwright API via `cloakbrowser` is primary; Puppeteer may be added later).
- S3 profile sync, Kubernetes deployment, proxy/geoip UI.

## Recommended approach

**Approach 2: `automation-api` (NestJS) + `browser-core` (Nx lib)**

| Layer | Responsibility |
|-------|----------------|
| `apps/automation-api` | HTTP API, profile CRUD, run orchestration, locking, artifacts |
| `libs/browser-core` | CloakBrowser `launchPersistentContext`, navigation, screenshot — no HTTP |

Rejected for MVP:

- **Monolithic app** without `browser-core` — harder to reuse from future collectors.
- **CloakBrowser Manager Docker** — external dependency; does not deliver a custom SOCINT-owned profile mechanism.

## Repository layout (Nx)

```
socmint/
├── apps/
│   └── automation-api/
│       └── src/
│           ├── profiles/
│           ├── runs/
│           └── app.module.ts
├── libs/
│   └── browser-core/
│       └── src/
│           ├── cloak-browser.service.ts
│           ├── profile-path.resolver.ts
│           └── types/
├── data/                    # gitignored — runtime profiles
│   └── profiles/
│       └── {profileId}/
│           ├── profile.json
│           └── user-data/
├── artifacts/               # gitignored — run outputs
│   └── runs/
│       └── {runId}/
├── docs/superpowers/specs/
├── nx.json
├── package.json
└── .env.example
```

### Environment variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `DATA_ROOT` | Root for profile dirs | `./data` |
| `ARTIFACTS_ROOT` | Root for run outputs | `./artifacts` |
| `PROFILE_LOCK_TTL_MS` | Stale lock recovery | `180000` (3 min) |
| `HOST` | API bind address | `127.0.0.1` |
| `CLOAKBROWSER_BINARY_PATH` | Optional pre-provisioned Chromium binary (skips auto-download) | _(unset)_ |

> **Lock TTL** is intentionally close to the max run duration (`timeoutMs`, 60 s) plus headroom, so a crashed run frees its profile in minutes rather than after 30 min.
>
> **Bind address** defaults to loopback. Because the run endpoint fetches arbitrary operator-supplied URLs with **no SSRF filtering** (see Automation run model), the API must **not** be exposed on `0.0.0.0` without an authenticating proxy in front of it. Trusted-operator, localhost-only is the MVP assumption.

## Profile model

### Filesystem layout per profile

```
data/profiles/{profileId}/
├── profile.json      # metadata
└── user-data/        # CloakBrowser launchPersistentContext userDataDir
```

### `profile.json` schema

```json
{
  "id": "uuid",
  "label": "string",
  "userDataDir": "relative path under DATA_ROOT",
  "proxy": "string | null",
  "fingerprintSeed": "string | null",
  "launchDefaults": {
    "headless": false,
    "humanize": true,
    "geoip": false
  },
  "status": "idle | running",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

### Profile lifecycle rules

- **Create:** generate UUID, mkdir `user-data/`, write `profile.json`, `status: idle`.
- **Update:** allow `label`, `proxy`, `fingerprintSeed`, `launchDefaults` only when `status !== running`.
- **Delete:** reject with `409` if `status === running` or lock file present; remove directory tree.
- **List:** scan `data/profiles/*/profile.json` (no separate index file required for MVP).

### Concurrency

- At most **one active run per profile**.
- **Authoritative mechanism: a `profile.lock` file created with exclusive semantics** (`open` with `wx` / `O_CREAT|O_EXCL`). Exclusive create is the only race-free primitive here; a successful create == lock held, `EEXIST` == already running → `409`. The lock file holds `{ pid, startedAt }`.
- `status` in `profile.json` is **display-only / derived** from lock presence — it is never the gate (read-modify-write on the JSON is racy).
- **Stale recovery:** on API start *and* on the delete path, clear locks whose `startedAt` is older than `PROFILE_LOCK_TTL_MS`. `DELETE` returns `409` only when a **live** (non-stale) lock exists; a stale lock is cleared then delete proceeds.
- No global concurrency cap in MVP, but each active run is a full persistent Chromium process. Document the per-run memory cost; a process-wide ceiling is a fast-follow if multiple profiles run at once.

## Automation run model

### Run record (`artifacts/runs/{runId}/result.json`)

```json
{
  "id": "uuid",
  "profileId": "uuid",
  "url": "https://example.com",
  "status": "completed | failed",
  "startedAt": "ISO-8601",
  "finishedAt": "ISO-8601",
  "error": "string | null",
  "page": {
    "title": "string",
    "finalUrl": "string"
  },
  "artifacts": {
    "screenshot": "relative/path or null"
  }
}
```

### Default pipeline (`browser-core`)

1. Resolve `userDataDir` from profile.
2. `launchPersistentContext({ userDataDir, ...launchDefaults, ...runOverrides })`.
3. `page.goto(url, { waitUntil, timeout })`.
4. Collect `title`, `finalUrl`.
5. If `screenshot: true`, save full-page PNG under `artifacts/runs/{runId}/`.
6. `context.close()` — persistent state remains in `user-data/`.

### CloakBrowser API choice

- **Primary:** `import { launchPersistentContext } from 'cloakbrowser'` (Playwright-compatible API).
- **Rationale:** Persistent profiles and `userDataDir` are first-class; better documented for session persistence.
- **Puppeteer** (`cloakbrowser/puppeteer`): deferred; document known CDP limitations for future driver work.

Dependencies: `cloakbrowser`, `playwright-core >= 1.53` (the version floor CloakBrowser requires; `puppeteer-core >= 21` is the alternative for the deferred driver).

> **Unverified launch options:** `humanize` and `fingerprintSeed` are documented for `launch()` but **not** explicitly for `launchPersistentContext()`. Before relying on them, the implementer must confirm they take effect on the persistent-context path (and decide how `fingerprintSeed` maps to a launch option — likely `args`). If unsupported, drop them from `launchDefaults` / `profile.json` rather than storing fields that silently no-op.

### Binary provisioning

- The stealth Chromium binary (~200 MB) auto-downloads to `~/.cloakbrowser/` on first launch.
- **`ensureBinary()` runs at app bootstrap** (mandatory, not optional) so run requests never trigger a multi-minute download mid-request.
- If `CLOAKBROWSER_BINARY_PATH` is set, bootstrap uses it and skips the download (preferred for containers/offline/CI).
- Bootstrap fails fast if the binary can neither be located nor downloaded.

## HTTP API (`automation-api`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/profiles` | Create profile |
| `GET` | `/profiles` | List profiles |
| `GET` | `/profiles/:id` | Get profile |
| `PATCH` | `/profiles/:id` | Update metadata |
| `DELETE` | `/profiles/:id` | Delete profile |
| `POST` | `/profiles/:id/runs` | Execute automation |
| `GET` | `/runs/:id` | Get run result + artifact paths |

### `POST /profiles`

**Body:**

```json
{
  "label": "investigator-01",
  "proxy": null,
  "fingerprintSeed": null,
  "launchDefaults": { "headless": false, "humanize": true }
}
```

**Response:** `201` + profile object.

### `POST /profiles/:id/runs`

**Body:**

```json
{
  "url": "https://example.com",
  "options": {
    "screenshot": true,
    "waitUntil": "networkidle",
    "timeoutMs": 60000
  }
}
```

**Response:** `200` with `{ runId, status, ... }` when the run completes (MVP is synchronous; async/queued runs are a future change). The request is held open for the full run (up to `timeoutMs`); because `ensureBinary()` runs at bootstrap there is no download latency on the request path.

> **URL handling (decided):** **no SSRF filtering** — any well-formed URL (including loopback / RFC-1918 / link-local) is permitted. This is safe *only* under the localhost-bind + trusted-operator assumption (see Environment variables). Validation is limited to "is this a well-formed `http(s)` URL." Default `waitUntil`: prefer `load` or `domcontentloaded`; `networkidle` is flaky and discouraged by Playwright.

**Errors:**

| Code | Condition |
|------|-----------|
| `404` | Profile not found |
| `409` | Profile already running (live lock) |
| `400` | Malformed / non-`http(s)` URL |
| `503` | Chromium binary unavailable (download failed / offline and no `CLOAKBROWSER_BINARY_PATH`) |

## Module boundaries

### `browser-core`

- **Exports:** `CloakBrowserModule`, `CloakBrowserService`, path helpers, shared types.
- **Does not:** read/write `profile.json`, HTTP, NestJS controllers.
- **Inputs:** resolved `userDataDir`, launch options, run options, artifact output path.
- **NestJS coupling:** expose a framework-agnostic `CloakBrowserService` (plain class) as the core; the `CloakBrowserModule` Nest wrapper is a thin optional adapter so future non-Nest consumers (Rust/Python workers) can use the service directly.
- **Browser seam for tests:** the actual launch call sits behind an injectable launcher interface so `browser-core` can be unit-tested with a fake (no real Chromium).
- **Path-traversal invariant:** `profile-path.resolver` MUST reject any `userDataDir` containing `..` and assert the resolved absolute path stays within `DATA_ROOT`. (`profileId` is a server-generated UUID, but enforce the invariant regardless.)

### `automation-api`

- **Owns:** profile CRUD, locking, run lifecycle, artifact paths, HTTP validation.
- **Uses:** `browser-core` for browser operations only.

## Error handling

- Navigation timeout → `run.status = failed`, persist error message, always close context in `finally`.
- Uncaught browser errors → same; release lock in `finally`.
- Binary provisioning is handled at bootstrap via `ensureBinary()` (mandatory), so the run path assumes the binary exists. A `503` at run time means the binary genuinely disappeared / download failed — surface the warm-up guidance and `CLOAKBROWSER_BINARY_PATH` option.

## Testing strategy (MVP)

| Level | Target |
|-------|--------|
| Unit | `profile-path.resolver` (incl. `..`/traversal rejection), profile JSON validation, **exclusive lock acquire/release + stale-lock recovery race** |
| Integration | Profile CRUD against temp `DATA_ROOT`; `browser-core` against the **fake launcher** (no real Chromium) |
| E2E (optional) | `POST /profiles` → `POST .../runs` with `https://example.com` — **gated behind a tag/flag** and run only where `CLOAKBROWSER_BINARY_PATH` is pre-provisioned (avoids the 200 MB download flaking CI) |

## Future extensions (explicitly out of scope)

- Nx apps: `api-gateway`, `collector-service`, etc.
- BullMQ for async runs; Rust/Python workers in separate folders under `apps/`.
- PostgreSQL metadata + S3 profile bundles.
- Step-based automation DSL and workflow builder UI.
- Internal auth/RBAC on automation API.

## Success criteria

1. Developer can create a profile via API and see `data/profiles/{id}/user-data/` on disk.
2. Second run with same profile reuses cookies/localStorage (manual verification: e.g. site remembers session if applicable).
3. `POST .../runs` against `https://example.com` returns title + optional screenshot path.
4. Concurrent run on same profile returns `409`.
5. `browser-core` has zero imports from `automation-api`.

## Approval

- **Brainstorming:** User approved Approach 2 and overall design on 2026-06-02.
- **Spec review (2026-06-02):** Resolved blocking decisions —
  - **SSRF:** allow all URLs (no internal-range filtering); mitigated by localhost bind + trusted-operator assumption.
  - **Locking:** exclusive `profile.lock` file is authoritative; `status` is display-only.
  - **Binary:** mandatory `ensureBinary()` at bootstrap (or `CLOAKBROWSER_BINARY_PATH`).
  - Pinned `playwright-core >= 1.53`; flagged `humanize`/`fingerprintSeed` as unverified on the persistent-context path (must confirm during implementation).
- **Next step:** Implementation plan via `writing-plans` skill (no code until plan approved).
