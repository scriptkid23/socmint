# CloakBrowser Profile Management & Automation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a NestJS + Nx service that manages local CloakBrowser profiles (CRUD over filesystem) and runs one-shot, audited browser automations against operator-supplied URLs using each profile's persisted session.

**Architecture:** Two Nx projects. `libs/browser-core` is a **framework-agnostic** TypeScript library that wraps CloakBrowser behind an injectable `BrowserLauncher` seam (so it is unit-testable with a fake and reusable by future non-Nest consumers); a thin optional Nest module adapter is provided. `apps/automation-api` is the NestJS HTTP app that owns profile CRUD, an exclusive-lock-file concurrency gate, run orchestration, artifacts, and an append-only audit log. The API binds to loopback only.

**Tech Stack:** pnpm, Nx (integrated monorepo), NestJS 10, TypeScript, Jest (`@nx/jest`), `cloakbrowser` + `playwright-core >= 1.53`, `class-validator`/`class-transformer`, Node `crypto.randomUUID`, Node `fs/promises`.

**Key decisions carried from the spec (2026-06-02 review):**
- **Locking:** exclusive `profile.lock` file (`open(..., 'wx')`) is authoritative; `status` in `profile.json` is display-only.
- **SSRF:** no URL filtering — any well-formed `http(s)` URL is allowed; safety comes from binding to `127.0.0.1` + trusted operators.
- **Binary:** `ensureBinary()` runs (mandatorily) at bootstrap, or `CLOAKBROWSER_BINARY_PATH` is honored.
- **Unverified options:** `humanize`/`fingerprintSeed` are NOT wired into the persistent-context call in this MVP (documented-for `launch()` only); they pass through generically but are not relied upon.

---

## File Structure

**`libs/browser-core/`** (framework-agnostic core)
- `src/lib/types.ts` — shared interfaces: `LaunchOptions`, `RunPageOptions`, `RunPageResult`, `PageLike`, `BrowserContextLike`, `BrowserLauncher`.
- `src/lib/profile-path.resolver.ts` — pure path helpers + traversal guard (`assertWithin`, `resolveSafe`, `resolveProfileDir`, `resolveUserDataDir`).
- `src/lib/cloak-browser.service.ts` — `CloakBrowserService` (plain class) with `runPage()`; depends only on `BrowserLauncher`.
- `src/lib/cloak-browser.launcher.ts` — `CloakBrowserLauncher` real impl wrapping `cloakbrowser`'s `ensureBinary`/`launchPersistentContext`.
- `src/lib/cloak-browser.module.ts` — thin NestJS module adapter (optional for Nest consumers).
- `src/index.ts` — barrel export.

**`apps/automation-api/`** (HTTP app)
- `src/app/config.ts` — `AppConfig` + `loadConfig(env)` + `APP_CONFIG` token.
- `src/profiles/profile.types.ts` — `ProfileMetadata`, `ProfileStatus`.
- `src/profiles/profile.store.ts` — filesystem read/write/list of `profile.json`.
- `src/profiles/lock.service.ts` — exclusive lock acquire/release/stale-recovery.
- `src/profiles/profile.service.ts` — CRUD + lifecycle rules.
- `src/profiles/dto.ts` — `CreateProfileDto`, `UpdateProfileDto` (class-validator).
- `src/profiles/profiles.controller.ts` — REST endpoints for profiles.
- `src/runs/audit.logger.ts` — append-only audit log writer.
- `src/runs/run.types.ts` — `RunRecord`.
- `src/runs/dto.ts` — `RunRequestDto`.
- `src/runs/run.service.ts` — orchestration (lock → launch → persist → audit → release).
- `src/runs/runs.controller.ts` — `POST /profiles/:id/runs`, `GET /runs/:id`.
- `src/app/app.module.ts` — DI wiring.
- `src/main.ts` — bootstrap: `ensureBinary`, clear stale locks, bind `HOST`.

**Workspace root:** `package.json`, `pnpm-lock.yaml`, `nx.json`, `tsconfig.base.json`, `.env.example`.

---

## Task 1: Workspace scaffold (pnpm + Nx)

**Files:**
- Create: `package.json`, `nx.json`, `tsconfig.base.json`, `.env.example`
- Modify: `.gitignore`

- [ ] **Step 1: Initialize pnpm + install Nx core and plugins**

Run (from repo root `d:\1hoodlabs\socmint`):

```bash
pnpm init
pnpm add -D nx@latest @nx/workspace@latest @nx/nest@latest @nx/js@latest @nx/jest@latest @nx/eslint@latest typescript@~5.5.0 @types/node jest@^29 ts-jest@^29
```

Expected: `package.json` created; `node_modules/` and `pnpm-lock.yaml` populated. (Use the matching `@nx/*` versions pnpm resolves for `nx@latest`; if a generator later complains about version mismatch, run `pnpm exec nx migrate latest` is NOT needed — instead align all `@nx/*` to the same version shown in `pnpm why nx`.)

- [ ] **Step 2: Author `nx.json`**

Create `nx.json`:

```json
{
  "$schema": "./node_modules/nx/schemas/nx-schema.json",
  "namedInputs": {
    "default": ["{projectRoot}/**/*", "sharedGlobals"],
    "production": ["default", "!{projectRoot}/**/?(*.)+(spec|test).[jt]s?(x)?(.snap)"],
    "sharedGlobals": []
  },
  "targetDefaults": {
    "build": { "cache": true },
    "test": { "cache": true },
    "lint": { "cache": true }
  }
}
```

- [ ] **Step 3: Author `tsconfig.base.json`**

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "composite": false,
    "declaration": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "importHelpers": true,
    "module": "commonjs",
    "moduleResolution": "node",
    "target": "es2021",
    "lib": ["es2021"],
    "skipLibCheck": true,
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "baseUrl": ".",
    "paths": {
      "@socmint/browser-core": ["libs/browser-core/src/index.ts"]
    }
  },
  "exclude": ["node_modules", "tmp"]
}
```

- [ ] **Step 4: Create `.env.example` and extend `.gitignore`**

Create `.env.example`:

```dotenv
# Root for profile dirs
DATA_ROOT=./data
# Root for run outputs
ARTIFACTS_ROOT=./artifacts
# Stale lock recovery window (ms) — close to max run duration + headroom
PROFILE_LOCK_TTL_MS=180000
# API bind address — loopback only (no SSRF filtering on run URLs)
HOST=127.0.0.1
PORT=3000
# Optional: pre-provisioned CloakBrowser Chromium binary (skips ~200MB download)
# CLOAKBROWSER_BINARY_PATH=
```

Append to `.gitignore` (only if the lines are not already present):

```gitignore
# Nx / TS build
tmp/
*.tsbuildinfo
```

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml nx.json tsconfig.base.json .env.example .gitignore
git commit -m "chore: scaffold pnpm + Nx workspace"
```

---

## Task 2: Generate the two Nx projects

**Files:**
- Create (via generators): `libs/browser-core/**`, `apps/automation-api/**`

- [ ] **Step 1: Generate the framework-agnostic library**

Run:

```bash
pnpm exec nx g @nx/js:library browser-core --directory=libs/browser-core --importPath=@socmint/browser-core --unitTestRunner=jest --bundler=tsc --no-interactive
```

Expected: creates `libs/browser-core/` with `project.json`, `jest.config.ts`, `tsconfig*.json`, `src/index.ts`, and a sample `src/lib/browser-core.ts` + spec. Updates `tsconfig.base.json` paths (already present from Task 1 — leave the generator's entry, it should match).

- [ ] **Step 2: Generate the NestJS application**

Run:

```bash
pnpm exec nx g @nx/nest:application automation-api --directory=apps/automation-api --unitTestRunner=jest --e2eTestRunner=none --no-interactive
```

Expected: creates `apps/automation-api/` with `project.json`, `src/main.ts`, `src/app/app.module.ts`, `src/app/app.controller.ts`, `src/app/app.service.ts`, jest + tsconfig files.

- [ ] **Step 3: Install runtime dependencies**

Run:

```bash
pnpm add cloakbrowser playwright-core@^1.53.0 class-validator class-transformer
```

Expected: dependencies added to `package.json`. (`cloakbrowser` install may print that the stealth Chromium downloads on first launch — that is expected; warmup is handled at bootstrap in Task 14.)

- [ ] **Step 4: Remove generated sample files we will replace**

Delete the generator's placeholder library file and its spec, and the app's sample controller/service:

```bash
git rm -f libs/browser-core/src/lib/browser-core.ts libs/browser-core/src/lib/browser-core.spec.ts
git rm -f apps/automation-api/src/app/app.controller.ts apps/automation-api/src/app/app.controller.spec.ts apps/automation-api/src/app/app.service.ts apps/automation-api/src/app/app.service.spec.ts
```

(If a filename differs in your Nx version, delete the equivalent sample file. Leave `app.module.ts` and `main.ts` — they are rewritten in later tasks.)

- [ ] **Step 5: Make `libs/browser-core/src/index.ts` an empty barrel and verify both projects build/test**

Replace `libs/browser-core/src/index.ts` with:

```ts
// Barrel — populated by later tasks.
export {};
```

Run:

```bash
pnpm exec nx test browser-core
pnpm exec nx build browser-core
```

Expected: test run reports "No tests found" or passes with 0 tests (no failures); build succeeds.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: generate browser-core lib and automation-api app"
```

---

## Task 3: Shared types in `browser-core`

**Files:**
- Create: `libs/browser-core/src/lib/types.ts`
- Modify: `libs/browser-core/src/index.ts`

- [ ] **Step 1: Write the types**

Create `libs/browser-core/src/lib/types.ts`:

```ts
/** Options passed through to CloakBrowser's launchPersistentContext. */
export interface LaunchOptions {
  /** Absolute, already-resolved userDataDir. */
  userDataDir: string;
  headless?: boolean;
  proxy?: string | null;
  geoip?: boolean;
  /** Generic pass-through for future/unverified options (e.g. humanize). */
  [key: string]: unknown;
}

export type WaitUntil = 'load' | 'domcontentloaded' | 'commit';

export interface RunPageOptions {
  url: string;
  waitUntil?: WaitUntil;
  timeoutMs?: number;
  screenshot?: boolean;
  /** Absolute path to write the PNG when screenshot is true. */
  screenshotPath?: string;
}

export interface RunPageResult {
  title: string;
  finalUrl: string;
  screenshotPath: string | null;
}

/** Minimal Playwright-page surface we depend on (the test seam). */
export interface PageLike {
  goto(url: string, opts: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  title(): Promise<string>;
  url(): string;
  screenshot(opts: { path: string; fullPage: boolean }): Promise<unknown>;
}

export interface BrowserContextLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}

/** Injectable seam so the service can be unit-tested without real Chromium. */
export interface BrowserLauncher {
  ensureBinary(): Promise<void>;
  launchPersistentContext(opts: LaunchOptions): Promise<BrowserContextLike>;
}
```

- [ ] **Step 2: Export from the barrel**

Replace `libs/browser-core/src/index.ts`:

```ts
export * from './lib/types';
```

- [ ] **Step 3: Verify it compiles**

Run:

```bash
pnpm exec nx build browser-core
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add libs/browser-core/src/lib/types.ts libs/browser-core/src/index.ts
git commit -m "feat(browser-core): shared automation types"
```

---

## Task 4: Path resolver + traversal guard (TDD)

**Files:**
- Create: `libs/browser-core/src/lib/profile-path.resolver.ts`
- Test: `libs/browser-core/src/lib/profile-path.resolver.spec.ts`
- Modify: `libs/browser-core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/browser-core/src/lib/profile-path.resolver.spec.ts`:

```ts
import { resolve } from 'node:path';
import {
  assertWithin,
  resolveProfileDir,
  resolveUserDataDir,
} from './profile-path.resolver';

const ROOT = resolve('/tmp/socmint-data');

describe('profile-path.resolver', () => {
  it('resolves the profile dir under DATA_ROOT', () => {
    expect(resolveProfileDir(ROOT, 'abc-123')).toBe(
      resolve(ROOT, 'profiles', 'abc-123'),
    );
  });

  it('resolves the user-data dir under the profile dir', () => {
    expect(resolveUserDataDir(ROOT, 'abc-123')).toBe(
      resolve(ROOT, 'profiles', 'abc-123', 'user-data'),
    );
  });

  it('rejects a profileId containing traversal or separators', () => {
    expect(() => resolveProfileDir(ROOT, '../../etc')).toThrow(/invalid profile id/i);
    expect(() => resolveProfileDir(ROOT, 'a/b')).toThrow(/invalid profile id/i);
    expect(() => resolveProfileDir(ROOT, 'a\\b')).toThrow(/invalid profile id/i);
  });

  it('assertWithin throws when target escapes root', () => {
    expect(() => assertWithin(ROOT, resolve(ROOT, '..', 'evil'))).toThrow(/escapes/i);
  });

  it('assertWithin passes for the root itself and children', () => {
    expect(() => assertWithin(ROOT, ROOT)).not.toThrow();
    expect(() => assertWithin(ROOT, resolve(ROOT, 'child'))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec nx test browser-core --testPathPattern=profile-path
```

Expected: FAIL — cannot find module `./profile-path.resolver`.

- [ ] **Step 3: Write the implementation**

Create `libs/browser-core/src/lib/profile-path.resolver.ts`:

```ts
import { resolve, sep } from 'node:path';

/** Throw unless `target` is `root` or a descendant of `root`. */
export function assertWithin(root: string, target: string): void {
  const r = resolve(root);
  const t = resolve(target);
  if (t !== r && !t.startsWith(r + sep)) {
    throw new Error(`Path escapes root: ${t} not within ${r}`);
  }
}

function assertSafeId(profileId: string): void {
  if (
    !profileId ||
    profileId.includes('..') ||
    profileId.includes('/') ||
    profileId.includes('\\')
  ) {
    throw new Error(`Invalid profile id: ${profileId}`);
  }
}

export function resolveProfileDir(dataRoot: string, profileId: string): string {
  assertSafeId(profileId);
  const dir = resolve(dataRoot, 'profiles', profileId);
  assertWithin(resolve(dataRoot), dir);
  return dir;
}

export function resolveUserDataDir(dataRoot: string, profileId: string): string {
  const dir = resolve(resolveProfileDir(dataRoot, profileId), 'user-data');
  assertWithin(resolve(dataRoot), dir);
  return dir;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm exec nx test browser-core --testPathPattern=profile-path
```

Expected: PASS — all 5 tests green.

- [ ] **Step 5: Export and commit**

Add to `libs/browser-core/src/index.ts`:

```ts
export * from './lib/profile-path.resolver';
```

```bash
git add libs/browser-core/src/lib/profile-path.resolver.ts libs/browser-core/src/lib/profile-path.resolver.spec.ts libs/browser-core/src/index.ts
git commit -m "feat(browser-core): path resolver with traversal guard"
```

---

## Task 5: `CloakBrowserService.runPage` (TDD with a fake launcher)

**Files:**
- Create: `libs/browser-core/src/lib/cloak-browser.service.ts`
- Test: `libs/browser-core/src/lib/cloak-browser.service.spec.ts`
- Modify: `libs/browser-core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/browser-core/src/lib/cloak-browser.service.spec.ts`:

```ts
import { CloakBrowserService } from './cloak-browser.service';
import type {
  BrowserContextLike,
  BrowserLauncher,
  LaunchOptions,
  PageLike,
} from './types';

class FakePage implements PageLike {
  public gotoArgs: unknown[] | null = null;
  public screenshotArgs: { path: string; fullPage: boolean } | null = null;
  constructor(private readonly titleValue = 'Example', private readonly finalUrl = 'https://example.com/final') {}
  async goto(url: string, opts: { waitUntil?: string; timeout?: number }) {
    this.gotoArgs = [url, opts];
    return null;
  }
  async title() { return this.titleValue; }
  url() { return this.finalUrl; }
  async screenshot(opts: { path: string; fullPage: boolean }) {
    this.screenshotArgs = opts;
    return null;
  }
}

class FakeContext implements BrowserContextLike {
  public closed = false;
  constructor(public readonly page: FakePage) {}
  async newPage() { return this.page; }
  async close() { this.closed = true; }
}

class FakeLauncher implements BrowserLauncher {
  public lastLaunch: LaunchOptions | null = null;
  constructor(public readonly context: FakeContext) {}
  async ensureBinary() { /* noop */ }
  async launchPersistentContext(opts: LaunchOptions) {
    this.lastLaunch = opts;
    return this.context;
  }
}

describe('CloakBrowserService.runPage', () => {
  function build(page = new FakePage()) {
    const context = new FakeContext(page);
    const launcher = new FakeLauncher(context);
    return { service: new CloakBrowserService(launcher), launcher, context, page };
  }

  it('navigates and returns title + finalUrl', async () => {
    const { service, page } = build();
    const result = await service.runPage(
      { userDataDir: '/data/u' },
      { url: 'https://example.com' },
    );
    expect(result).toEqual({ title: 'Example', finalUrl: 'https://example.com/final', screenshotPath: null });
    expect(page.gotoArgs).toEqual(['https://example.com', { waitUntil: 'load', timeout: 60000 }]);
  });

  it('captures a full-page screenshot when requested', async () => {
    const { service, page } = build();
    const result = await service.runPage(
      { userDataDir: '/data/u' },
      { url: 'https://example.com', screenshot: true, screenshotPath: '/artifacts/r/shot.png' },
    );
    expect(page.screenshotArgs).toEqual({ path: '/artifacts/r/shot.png', fullPage: true });
    expect(result.screenshotPath).toBe('/artifacts/r/shot.png');
  });

  it('always closes the context, even when goto throws', async () => {
    const page = new FakePage();
    page.goto = async () => { throw new Error('nav timeout'); };
    const { service, context } = build(page);
    await expect(
      service.runPage({ userDataDir: '/data/u' }, { url: 'https://example.com' }),
    ).rejects.toThrow('nav timeout');
    expect(context.closed).toBe(true);
  });

  it('honors custom waitUntil and timeout', async () => {
    const { service, page } = build();
    await service.runPage(
      { userDataDir: '/data/u' },
      { url: 'https://example.com', waitUntil: 'domcontentloaded', timeoutMs: 15000 },
    );
    expect(page.gotoArgs).toEqual(['https://example.com', { waitUntil: 'domcontentloaded', timeout: 15000 }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec nx test browser-core --testPathPattern=cloak-browser.service
```

Expected: FAIL — cannot find module `./cloak-browser.service`.

- [ ] **Step 3: Write the implementation**

Create `libs/browser-core/src/lib/cloak-browser.service.ts`:

```ts
import type {
  BrowserLauncher,
  LaunchOptions,
  RunPageOptions,
  RunPageResult,
} from './types';

const DEFAULT_WAIT_UNTIL = 'load';
const DEFAULT_TIMEOUT_MS = 60000;

/**
 * Framework-agnostic browser runner. Depends only on a BrowserLauncher seam,
 * so it is unit-testable with a fake and reusable outside NestJS.
 */
export class CloakBrowserService {
  constructor(private readonly launcher: BrowserLauncher) {}

  async runPage(launch: LaunchOptions, run: RunPageOptions): Promise<RunPageResult> {
    const context = await this.launcher.launchPersistentContext(launch);
    try {
      const page = await context.newPage();
      await page.goto(run.url, {
        waitUntil: run.waitUntil ?? DEFAULT_WAIT_UNTIL,
        timeout: run.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
      const title = await page.title();
      const finalUrl = page.url();

      let screenshotPath: string | null = null;
      if (run.screenshot && run.screenshotPath) {
        await page.screenshot({ path: run.screenshotPath, fullPage: true });
        screenshotPath = run.screenshotPath;
      }

      return { title, finalUrl, screenshotPath };
    } finally {
      await context.close();
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm exec nx test browser-core --testPathPattern=cloak-browser.service
```

Expected: PASS — all 4 tests green.

- [ ] **Step 5: Export and commit**

Add to `libs/browser-core/src/index.ts`:

```ts
export * from './lib/cloak-browser.service';
```

```bash
git add libs/browser-core/src/lib/cloak-browser.service.ts libs/browser-core/src/lib/cloak-browser.service.spec.ts libs/browser-core/src/index.ts
git commit -m "feat(browser-core): CloakBrowserService.runPage with always-close semantics"
```

---

## Task 6: Real `CloakBrowserLauncher` (thin adapter, no unit test of the binary)

**Files:**
- Create: `libs/browser-core/src/lib/cloak-browser.launcher.ts`
- Modify: `libs/browser-core/src/index.ts`

> This adapter is a thin pass-through to the `cloakbrowser` package and is exercised by the gated E2E (Task 16), not by unit tests — launching real Chromium in a unit test is out of scope. Keep it free of logic so there is nothing to unit-test.

- [ ] **Step 1: Write the adapter**

Create `libs/browser-core/src/lib/cloak-browser.launcher.ts`:

```ts
// CloakBrowser exposes a Playwright-compatible API.
import { ensureBinary, launchPersistentContext } from 'cloakbrowser';
import type { BrowserContextLike, BrowserLauncher, LaunchOptions } from './types';

/**
 * Real launcher. Wires LaunchOptions to CloakBrowser's launchPersistentContext.
 * Only verified options are forwarded explicitly (userDataDir, headless, proxy,
 * geoip). `humanize`/`fingerprintSeed` are NOT forwarded in this MVP — they are
 * documented for launch() only and unverified for the persistent-context path.
 */
export class CloakBrowserLauncher implements BrowserLauncher {
  async ensureBinary(): Promise<void> {
    await ensureBinary();
  }

  async launchPersistentContext(opts: LaunchOptions): Promise<BrowserContextLike> {
    const launchArgs: Record<string, unknown> = { userDataDir: opts.userDataDir };
    if (typeof opts.headless === 'boolean') launchArgs.headless = opts.headless;
    if (opts.proxy) launchArgs.proxy = opts.proxy;
    if (opts.geoip) launchArgs.geoip = opts.geoip;

    const context = await launchPersistentContext(launchArgs);
    return context as unknown as BrowserContextLike;
  }
}
```

- [ ] **Step 2: Add an ambient module declaration if types are missing**

If `pnpm exec nx build browser-core` fails with "Could not find a declaration file for module 'cloakbrowser'", create `libs/browser-core/src/cloakbrowser.d.ts`:

```ts
declare module 'cloakbrowser' {
  export function ensureBinary(): Promise<void>;
  export function launchPersistentContext(opts: Record<string, unknown>): Promise<unknown>;
}
```

- [ ] **Step 3: Verify it builds**

Run:

```bash
pnpm exec nx build browser-core
```

Expected: build succeeds.

- [ ] **Step 4: Export and commit**

Add to `libs/browser-core/src/index.ts`:

```ts
export * from './lib/cloak-browser.launcher';
```

```bash
git add libs/browser-core/src/lib/cloak-browser.launcher.ts libs/browser-core/src/index.ts libs/browser-core/src/cloakbrowser.d.ts
git commit -m "feat(browser-core): real CloakBrowserLauncher adapter"
```

---

## Task 7: Optional Nest module adapter for `browser-core`

**Files:**
- Create: `libs/browser-core/src/lib/cloak-browser.module.ts`
- Modify: `libs/browser-core/src/index.ts`

- [ ] **Step 1: Install Nest common in the lib's reach (already present via the app's deps)**

Run (no-op if already installed by the app generator):

```bash
pnpm add @nestjs/common @nestjs/core reflect-metadata rxjs
```

Expected: dependencies present in root `package.json`.

- [ ] **Step 2: Write the module**

Create `libs/browser-core/src/lib/cloak-browser.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { CloakBrowserLauncher } from './cloak-browser.launcher';
import { CloakBrowserService } from './cloak-browser.service';
import type { BrowserLauncher } from './types';

export const BROWSER_LAUNCHER = Symbol('BROWSER_LAUNCHER');

/**
 * Thin Nest adapter. Provides CloakBrowserService backed by the real launcher.
 * Non-Nest consumers can ignore this and `new CloakBrowserService(launcher)`
 * directly.
 */
@Module({
  providers: [
    { provide: BROWSER_LAUNCHER, useClass: CloakBrowserLauncher },
    {
      provide: CloakBrowserService,
      useFactory: (launcher: BrowserLauncher) => new CloakBrowserService(launcher),
      inject: [BROWSER_LAUNCHER],
    },
  ],
  exports: [CloakBrowserService, BROWSER_LAUNCHER],
})
export class CloakBrowserModule {}
```

- [ ] **Step 3: Verify it builds**

Run:

```bash
pnpm exec nx build browser-core
```

Expected: build succeeds.

- [ ] **Step 4: Export and commit**

Add to `libs/browser-core/src/index.ts`:

```ts
export * from './lib/cloak-browser.module';
```

```bash
git add libs/browser-core/src/lib/cloak-browser.module.ts libs/browser-core/src/index.ts
git commit -m "feat(browser-core): optional NestJS module adapter"
```

---

## Task 8: App config loader (TDD)

**Files:**
- Create: `apps/automation-api/src/app/config.ts`
- Test: `apps/automation-api/src/app/config.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/automation-api/src/app/config.spec.ts`:

```ts
import { resolve } from 'node:path';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('applies defaults when env is empty', () => {
    const cfg = loadConfig({});
    expect(cfg.dataRoot).toBe(resolve('./data'));
    expect(cfg.artifactsRoot).toBe(resolve('./artifacts'));
    expect(cfg.profileLockTtlMs).toBe(180000);
    expect(cfg.host).toBe('127.0.0.1');
    expect(cfg.port).toBe(3000);
    expect(cfg.binaryPath).toBeNull();
  });

  it('reads overrides from env and resolves roots to absolute paths', () => {
    const cfg = loadConfig({
      DATA_ROOT: './x',
      ARTIFACTS_ROOT: './y',
      PROFILE_LOCK_TTL_MS: '5000',
      HOST: '0.0.0.0',
      PORT: '8080',
      CLOAKBROWSER_BINARY_PATH: '/opt/chromium',
    });
    expect(cfg.dataRoot).toBe(resolve('./x'));
    expect(cfg.artifactsRoot).toBe(resolve('./y'));
    expect(cfg.profileLockTtlMs).toBe(5000);
    expect(cfg.host).toBe('0.0.0.0');
    expect(cfg.port).toBe(8080);
    expect(cfg.binaryPath).toBe('/opt/chromium');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec nx test automation-api --testPathPattern=config
```

Expected: FAIL — cannot find module `./config`.

- [ ] **Step 3: Write the implementation**

Create `apps/automation-api/src/app/config.ts`:

```ts
import { resolve } from 'node:path';

export interface AppConfig {
  dataRoot: string;
  artifactsRoot: string;
  profileLockTtlMs: number;
  host: string;
  port: number;
  binaryPath: string | null;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    dataRoot: resolve(env.DATA_ROOT ?? './data'),
    artifactsRoot: resolve(env.ARTIFACTS_ROOT ?? './artifacts'),
    profileLockTtlMs: Number(env.PROFILE_LOCK_TTL_MS ?? 180000),
    host: env.HOST ?? '127.0.0.1',
    port: Number(env.PORT ?? 3000),
    binaryPath: env.CLOAKBROWSER_BINARY_PATH ?? null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm exec nx test automation-api --testPathPattern=config
```

Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/automation-api/src/app/config.ts apps/automation-api/src/app/config.spec.ts
git commit -m "feat(api): app config loader"
```

---

## Task 9: Profile types + filesystem store (TDD)

**Files:**
- Create: `apps/automation-api/src/profiles/profile.types.ts`
- Create: `apps/automation-api/src/profiles/profile.store.ts`
- Test: `apps/automation-api/src/profiles/profile.store.spec.ts`

- [ ] **Step 1: Write the types**

Create `apps/automation-api/src/profiles/profile.types.ts`:

```ts
export type ProfileStatus = 'idle' | 'running';

export interface LaunchDefaults {
  headless: boolean;
  geoip: boolean;
}

export interface ProfileMetadata {
  id: string;
  label: string;
  /** Relative path under DATA_ROOT, e.g. "profiles/<id>/user-data". */
  userDataDir: string;
  proxy: string | null;
  fingerprintSeed: string | null;
  launchDefaults: LaunchDefaults;
  /** Display-only; the lock file is authoritative for concurrency. */
  status: ProfileStatus;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/automation-api/src/profiles/profile.store.spec.ts`:

```ts
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ProfileStore } from './profile.store';
import type { ProfileMetadata } from './profile.types';

function sampleProfile(id: string): ProfileMetadata {
  return {
    id,
    label: 'investigator-01',
    userDataDir: `profiles/${id}/user-data`,
    proxy: null,
    fingerprintSeed: null,
    launchDefaults: { headless: false, geoip: false },
    status: 'idle',
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
  };
}

describe('ProfileStore', () => {
  let dataRoot: string;
  let store: ProfileStore;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'socmint-store-'));
    store = new ProfileStore(dataRoot);
  });
  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('write then read round-trips the metadata and creates user-data dir', async () => {
    const p = sampleProfile('id-1');
    await store.write(p);
    const onDisk = JSON.parse(
      await readFile(resolve(dataRoot, 'profiles', 'id-1', 'profile.json'), 'utf8'),
    );
    expect(onDisk).toEqual(p);
    expect(await store.read('id-1')).toEqual(p);
  });

  it('read returns null for a missing profile', async () => {
    expect(await store.read('nope')).toBeNull();
  });

  it('list returns all written profiles', async () => {
    await store.write(sampleProfile('id-1'));
    await store.write(sampleProfile('id-2'));
    const ids = (await store.list()).map((p) => p.id).sort();
    expect(ids).toEqual(['id-1', 'id-2']);
  });

  it('remove deletes the whole profile tree', async () => {
    await store.write(sampleProfile('id-1'));
    await store.remove('id-1');
    expect(await store.read('id-1')).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
pnpm exec nx test automation-api --testPathPattern=profile.store
```

Expected: FAIL — cannot find module `./profile.store`.

- [ ] **Step 4: Write the implementation**

Create `apps/automation-api/src/profiles/profile.store.ts`:

```ts
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { resolveProfileDir, resolveUserDataDir } from '@socmint/browser-core';
import type { ProfileMetadata } from './profile.types';

export class ProfileStore {
  constructor(private readonly dataRoot: string) {}

  private metaPath(id: string): string {
    return resolve(resolveProfileDir(this.dataRoot, id), 'profile.json');
  }

  async write(profile: ProfileMetadata): Promise<void> {
    // Ensure profile dir + user-data dir exist before writing metadata.
    await mkdir(resolveUserDataDir(this.dataRoot, profile.id), { recursive: true });
    await writeFile(this.metaPath(profile.id), JSON.stringify(profile, null, 2), 'utf8');
  }

  async read(id: string): Promise<ProfileMetadata | null> {
    try {
      const raw = await readFile(this.metaPath(id), 'utf8');
      return JSON.parse(raw) as ProfileMetadata;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async list(): Promise<ProfileMetadata[]> {
    const profilesRoot = resolve(this.dataRoot, 'profiles');
    let entries: string[];
    try {
      entries = await readdir(profilesRoot);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const profiles: ProfileMetadata[] = [];
    for (const id of entries) {
      const profile = await this.read(id);
      if (profile) profiles.push(profile);
    }
    return profiles;
  }

  async remove(id: string): Promise<void> {
    await rm(resolveProfileDir(this.dataRoot, id), { recursive: true, force: true });
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
pnpm exec nx test automation-api --testPathPattern=profile.store
```

Expected: PASS — all 4 tests green.

- [ ] **Step 6: Commit**

```bash
git add apps/automation-api/src/profiles/profile.types.ts apps/automation-api/src/profiles/profile.store.ts apps/automation-api/src/profiles/profile.store.spec.ts
git commit -m "feat(api): profile metadata types and filesystem store"
```

---

## Task 10: Exclusive lock service + stale recovery (TDD)

**Files:**
- Create: `apps/automation-api/src/profiles/lock.service.ts`
- Test: `apps/automation-api/src/profiles/lock.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/automation-api/src/profiles/lock.service.spec.ts`:

```ts
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LockService, ProfileBusyError } from './lock.service';

describe('LockService', () => {
  let dataRoot: string;
  let profileDir: string;
  let lock: LockService;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'socmint-lock-'));
    profileDir = resolve(dataRoot, 'profiles', 'id-1');
    await mkdir(profileDir, { recursive: true });
    lock = new LockService(180000);
  });
  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('acquire creates a lock file holding pid + startedAt', async () => {
    await lock.acquire(profileDir, 1234);
    const raw = JSON.parse(await readFile(resolve(profileDir, 'profile.lock'), 'utf8'));
    expect(raw.pid).toBe(1234);
    expect(typeof raw.startedAt).toBe('string');
  });

  it('second acquire on a live lock throws ProfileBusyError', async () => {
    await lock.acquire(profileDir, 1234);
    await expect(lock.acquire(profileDir, 5678)).rejects.toBeInstanceOf(ProfileBusyError);
  });

  it('release removes the lock and is idempotent', async () => {
    await lock.acquire(profileDir, 1234);
    await lock.release(profileDir);
    await expect(lock.release(profileDir)).resolves.toBeUndefined();
    await expect(lock.acquire(profileDir, 9999)).resolves.toBeUndefined();
  });

  it('acquire overrides a stale lock (older than TTL)', async () => {
    await writeFile(
      resolve(profileDir, 'profile.lock'),
      JSON.stringify({ pid: 1, startedAt: '2000-01-01T00:00:00.000Z' }),
    );
    await expect(lock.acquire(profileDir, 4321)).resolves.toBeUndefined();
  });

  it('isLocked is false when stale, true when live', async () => {
    await writeFile(
      resolve(profileDir, 'profile.lock'),
      JSON.stringify({ pid: 1, startedAt: '2000-01-01T00:00:00.000Z' }),
    );
    expect(await lock.isLocked(profileDir)).toBe(false);
    await lock.acquire(profileDir, 1234);
    expect(await lock.isLocked(profileDir)).toBe(true);
  });

  it('clearStaleUnder removes only stale locks across all profiles', async () => {
    const otherDir = resolve(dataRoot, 'profiles', 'id-2');
    await mkdir(otherDir, { recursive: true });
    await lock.acquire(profileDir, 1234); // live
    await writeFile(
      resolve(otherDir, 'profile.lock'),
      JSON.stringify({ pid: 1, startedAt: '2000-01-01T00:00:00.000Z' }),
    ); // stale
    await lock.clearStaleUnder(resolve(dataRoot, 'profiles'));
    expect(await lock.isLocked(profileDir)).toBe(true);
    expect(await lock.isLocked(otherDir)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec nx test automation-api --testPathPattern=lock.service
```

Expected: FAIL — cannot find module `./lock.service`.

- [ ] **Step 3: Write the implementation**

Create `apps/automation-api/src/profiles/lock.service.ts`:

```ts
import { open, readFile, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

export class ProfileBusyError extends Error {
  constructor() {
    super('Profile already running');
    this.name = 'ProfileBusyError';
  }
}

interface LockFile {
  pid: number;
  startedAt: string;
}

export class LockService {
  constructor(private readonly ttlMs: number) {}

  private lockPath(profileDir: string): string {
    return resolve(profileDir, 'profile.lock');
  }

  private async readLock(path: string): Promise<LockFile | null> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as LockFile;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      return null; // corrupt lock → treat as absent (will be overwritten)
    }
  }

  private isStale(lock: LockFile): boolean {
    const started = Date.parse(lock.startedAt);
    if (Number.isNaN(started)) return true;
    return Date.now() - started > this.ttlMs;
  }

  /** Acquire the exclusive lock. Throws ProfileBusyError if a live lock exists. */
  async acquire(profileDir: string, pid: number): Promise<void> {
    const path = this.lockPath(profileDir);
    const existing = await this.readLock(path);
    if (existing && this.isStale(existing)) {
      await rm(path, { force: true });
    }
    try {
      const handle = await open(path, 'wx'); // O_CREAT | O_EXCL
      await handle.writeFile(JSON.stringify({ pid, startedAt: new Date().toISOString() }));
      await handle.close();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new ProfileBusyError();
      throw err;
    }
  }

  async release(profileDir: string): Promise<void> {
    await rm(this.lockPath(profileDir), { force: true });
  }

  /** True only when a non-stale lock file is present. */
  async isLocked(profileDir: string): Promise<boolean> {
    const lock = await this.readLock(this.lockPath(profileDir));
    return lock !== null && !this.isStale(lock);
  }

  /** Sweep all profile dirs under `profilesRoot`, removing stale locks. */
  async clearStaleUnder(profilesRoot: string): Promise<void> {
    let ids: string[];
    try {
      ids = await readdir(profilesRoot);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    for (const id of ids) {
      const path = this.lockPath(resolve(profilesRoot, id));
      const lock = await this.readLock(path);
      if (lock && this.isStale(lock)) {
        await rm(path, { force: true });
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm exec nx test automation-api --testPathPattern=lock.service
```

Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/automation-api/src/profiles/lock.service.ts apps/automation-api/src/profiles/lock.service.spec.ts
git commit -m "feat(api): exclusive lock service with stale recovery"
```

---

## Task 11: Profile DTOs (validation)

**Files:**
- Create: `apps/automation-api/src/profiles/dto.ts`
- Test: `apps/automation-api/src/profiles/dto.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/automation-api/src/profiles/dto.spec.ts`:

```ts
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateProfileDto, UpdateProfileDto } from './dto';

function errorsFor<T extends object>(cls: new () => T, payload: unknown) {
  return validateSync(plainToInstance(cls, payload), { whitelist: true });
}

describe('CreateProfileDto', () => {
  it('accepts a minimal valid payload', () => {
    expect(errorsFor(CreateProfileDto, { label: 'inv-01' })).toHaveLength(0);
  });

  it('rejects a missing/empty label', () => {
    expect(errorsFor(CreateProfileDto, {}).length).toBeGreaterThan(0);
    expect(errorsFor(CreateProfileDto, { label: '' }).length).toBeGreaterThan(0);
  });

  it('accepts optional proxy, fingerprintSeed and launchDefaults', () => {
    const errs = errorsFor(CreateProfileDto, {
      label: 'inv-01',
      proxy: 'http://1.2.3.4:8080',
      fingerprintSeed: 'seed',
      launchDefaults: { headless: true, geoip: false },
    });
    expect(errs).toHaveLength(0);
  });
});

describe('UpdateProfileDto', () => {
  it('accepts an empty patch', () => {
    expect(errorsFor(UpdateProfileDto, {})).toHaveLength(0);
  });

  it('rejects a non-boolean headless inside launchDefaults', () => {
    const errs = errorsFor(UpdateProfileDto, { launchDefaults: { headless: 'yes' } });
    expect(errs.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec nx test automation-api --testPathPattern=profiles/dto
```

Expected: FAIL — cannot find module `./dto`.

- [ ] **Step 3: Write the implementation**

Create `apps/automation-api/src/profiles/dto.ts`:

```ts
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class LaunchDefaultsDto {
  @IsOptional()
  @IsBoolean()
  headless?: boolean;

  @IsOptional()
  @IsBoolean()
  geoip?: boolean;
}

export class CreateProfileDto {
  @IsString()
  @IsNotEmpty()
  label!: string;

  @IsOptional()
  @IsString()
  proxy?: string | null;

  @IsOptional()
  @IsString()
  fingerprintSeed?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => LaunchDefaultsDto)
  launchDefaults?: LaunchDefaultsDto;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  label?: string;

  @IsOptional()
  @IsString()
  proxy?: string | null;

  @IsOptional()
  @IsString()
  fingerprintSeed?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => LaunchDefaultsDto)
  launchDefaults?: LaunchDefaultsDto;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm exec nx test automation-api --testPathPattern=profiles/dto
```

Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/automation-api/src/profiles/dto.ts apps/automation-api/src/profiles/dto.spec.ts
git commit -m "feat(api): profile create/update DTOs with validation"
```

---

## Task 12: ProfileService — CRUD + lifecycle rules (TDD)

**Files:**
- Create: `apps/automation-api/src/profiles/profile.service.ts`
- Test: `apps/automation-api/src/profiles/profile.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/automation-api/src/profiles/profile.service.spec.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ProfileStore } from './profile.store';
import { LockService } from './lock.service';
import {
  ProfileNotFoundError,
  ProfileRunningError,
  ProfileService,
} from './profile.service';

describe('ProfileService', () => {
  let dataRoot: string;
  let service: ProfileService;
  let store: ProfileStore;
  let lock: LockService;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'socmint-svc-'));
    store = new ProfileStore(dataRoot);
    lock = new LockService(180000);
    service = new ProfileService(store, lock, dataRoot);
  });
  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('create assigns a UUID, sets idle status, and persists', async () => {
    const p = await service.create({ label: 'inv-01' });
    expect(p.id).toMatch(/[0-9a-f-]{36}/);
    expect(p.status).toBe('idle');
    expect(p.userDataDir).toBe(`profiles/${p.id}/user-data`);
    expect(p.launchDefaults).toEqual({ headless: false, geoip: false });
    expect(await store.read(p.id)).toEqual(p);
  });

  it('get throws ProfileNotFoundError for unknown id', async () => {
    await expect(service.get('nope')).rejects.toBeInstanceOf(ProfileNotFoundError);
  });

  it('update changes allowed fields and bumps updatedAt', async () => {
    const p = await service.create({ label: 'inv-01' });
    const updated = await service.update(p.id, { label: 'renamed', proxy: 'http://p:1' });
    expect(updated.label).toBe('renamed');
    expect(updated.proxy).toBe('http://p:1');
    expect(updated.updatedAt >= p.updatedAt).toBe(true);
  });

  it('update rejects while a live lock is held', async () => {
    const p = await service.create({ label: 'inv-01' });
    await lock.acquire(resolve(dataRoot, 'profiles', p.id), 123);
    await expect(service.update(p.id, { label: 'x' })).rejects.toBeInstanceOf(ProfileRunningError);
  });

  it('remove deletes an idle profile', async () => {
    const p = await service.create({ label: 'inv-01' });
    await service.remove(p.id);
    await expect(service.get(p.id)).rejects.toBeInstanceOf(ProfileNotFoundError);
  });

  it('remove rejects while a live lock is held', async () => {
    const p = await service.create({ label: 'inv-01' });
    await lock.acquire(resolve(dataRoot, 'profiles', p.id), 123);
    await expect(service.remove(p.id)).rejects.toBeInstanceOf(ProfileRunningError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec nx test automation-api --testPathPattern=profile.service
```

Expected: FAIL — cannot find module `./profile.service`.

- [ ] **Step 3: Write the implementation**

Create `apps/automation-api/src/profiles/profile.service.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { resolveProfileDir } from '@socmint/browser-core';
import type { CreateProfileDto, UpdateProfileDto } from './dto';
import { LockService } from './lock.service';
import { ProfileStore } from './profile.store';
import type { ProfileMetadata } from './profile.types';

export class ProfileNotFoundError extends Error {
  constructor(id: string) {
    super(`Profile not found: ${id}`);
    this.name = 'ProfileNotFoundError';
  }
}

export class ProfileRunningError extends Error {
  constructor(id: string) {
    super(`Profile is running: ${id}`);
    this.name = 'ProfileRunningError';
  }
}

export class ProfileService {
  constructor(
    private readonly store: ProfileStore,
    private readonly lock: LockService,
    private readonly dataRoot: string,
  ) {}

  private profileDir(id: string): string {
    return resolveProfileDir(this.dataRoot, id);
  }

  async create(dto: CreateProfileDto): Promise<ProfileMetadata> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const profile: ProfileMetadata = {
      id,
      label: dto.label,
      userDataDir: `profiles/${id}/user-data`,
      proxy: dto.proxy ?? null,
      fingerprintSeed: dto.fingerprintSeed ?? null,
      launchDefaults: {
        headless: dto.launchDefaults?.headless ?? false,
        geoip: dto.launchDefaults?.geoip ?? false,
      },
      status: 'idle',
      createdAt: now,
      updatedAt: now,
    };
    await this.store.write(profile);
    return profile;
  }

  async list(): Promise<ProfileMetadata[]> {
    return this.store.list();
  }

  async get(id: string): Promise<ProfileMetadata> {
    const profile = await this.store.read(id);
    if (!profile) throw new ProfileNotFoundError(id);
    return profile;
  }

  async update(id: string, dto: UpdateProfileDto): Promise<ProfileMetadata> {
    const profile = await this.get(id);
    if (await this.lock.isLocked(this.profileDir(id))) {
      throw new ProfileRunningError(id);
    }
    const next: ProfileMetadata = {
      ...profile,
      label: dto.label ?? profile.label,
      proxy: dto.proxy ?? profile.proxy,
      fingerprintSeed: dto.fingerprintSeed ?? profile.fingerprintSeed,
      launchDefaults: {
        headless: dto.launchDefaults?.headless ?? profile.launchDefaults.headless,
        geoip: dto.launchDefaults?.geoip ?? profile.launchDefaults.geoip,
      },
      updatedAt: new Date().toISOString(),
    };
    await this.store.write(next);
    return next;
  }

  /** Persist a status change (display-only; lock is authoritative). */
  async setStatus(id: string, status: ProfileMetadata['status']): Promise<void> {
    const profile = await this.get(id);
    await this.store.write({ ...profile, status, updatedAt: new Date().toISOString() });
  }

  async remove(id: string): Promise<void> {
    await this.get(id); // 404 if missing
    if (await this.lock.isLocked(this.profileDir(id))) {
      throw new ProfileRunningError(id);
    }
    await this.store.remove(id);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm exec nx test automation-api --testPathPattern=profile.service
```

Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/automation-api/src/profiles/profile.service.ts apps/automation-api/src/profiles/profile.service.spec.ts
git commit -m "feat(api): ProfileService CRUD with lifecycle rules"
```

---

## Task 13: Audit logger (TDD)

**Files:**
- Create: `apps/automation-api/src/runs/audit.logger.ts`
- Test: `apps/automation-api/src/runs/audit.logger.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/automation-api/src/runs/audit.logger.spec.ts`:

```ts
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AuditLogger } from './audit.logger';

describe('AuditLogger', () => {
  let artifactsRoot: string;
  let logger: AuditLogger;

  beforeEach(async () => {
    artifactsRoot = await mkdtemp(join(tmpdir(), 'socmint-audit-'));
    logger = new AuditLogger(artifactsRoot);
  });
  afterEach(async () => {
    await rm(artifactsRoot, { recursive: true, force: true });
  });

  it('appends one JSON line per entry', async () => {
    await logger.append({ profileId: 'p1', runId: 'r1', url: 'https://a', timestamp: '2026-06-02T00:00:00.000Z' });
    await logger.append({ profileId: 'p1', runId: 'r2', url: 'https://b', timestamp: '2026-06-02T00:00:01.000Z' });
    const raw = await readFile(resolve(artifactsRoot, 'audit.log'), 'utf8');
    const lines = raw.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).runId).toBe('r1');
    expect(JSON.parse(lines[1]).runId).toBe('r2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec nx test automation-api --testPathPattern=audit.logger
```

Expected: FAIL — cannot find module `./audit.logger`.

- [ ] **Step 3: Write the implementation**

Create `apps/automation-api/src/runs/audit.logger.ts`:

```ts
import { appendFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface AuditEntry {
  profileId: string;
  runId: string;
  url: string;
  timestamp: string;
}

/** Append-only audit trail; survives deletion of individual run dirs. */
export class AuditLogger {
  constructor(private readonly artifactsRoot: string) {}

  private logPath(): string {
    return resolve(this.artifactsRoot, 'audit.log');
  }

  async append(entry: AuditEntry): Promise<void> {
    await mkdir(this.artifactsRoot, { recursive: true });
    await appendFile(this.logPath(), JSON.stringify(entry) + '\n', 'utf8');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm exec nx test automation-api --testPathPattern=audit.logger
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/automation-api/src/runs/audit.logger.ts apps/automation-api/src/runs/audit.logger.spec.ts
git commit -m "feat(api): append-only audit logger"
```

---

## Task 14: Run types, DTO, and RunService orchestration (TDD)

**Files:**
- Create: `apps/automation-api/src/runs/run.types.ts`
- Create: `apps/automation-api/src/runs/dto.ts`
- Create: `apps/automation-api/src/runs/run.service.ts`
- Test: `apps/automation-api/src/runs/run.service.spec.ts`

- [ ] **Step 1: Write run types**

Create `apps/automation-api/src/runs/run.types.ts`:

```ts
export type RunStatus = 'completed' | 'failed';

export interface RunRecord {
  id: string;
  profileId: string;
  url: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string;
  error: string | null;
  page: { title: string; finalUrl: string } | null;
  artifacts: { screenshot: string | null };
}
```

- [ ] **Step 2: Write the run DTO**

Create `apps/automation-api/src/runs/dto.ts`:

```ts
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsUrl,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class RunOptionsDto {
  @IsOptional()
  @IsBoolean()
  screenshot?: boolean;

  @IsOptional()
  @IsIn(['load', 'domcontentloaded', 'commit'])
  waitUntil?: 'load' | 'domcontentloaded' | 'commit';

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(120000)
  timeoutMs?: number;
}

export class RunRequestDto {
  // No SSRF filtering by design — any well-formed http(s) URL is allowed.
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  url!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => RunOptionsDto)
  options?: RunOptionsDto;
}
```

- [ ] **Step 3: Write the failing test**

Create `apps/automation-api/src/runs/run.service.spec.ts`:

```ts
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CloakBrowserService } from '@socmint/browser-core';
import type { BrowserContextLike, BrowserLauncher, LaunchOptions, PageLike } from '@socmint/browser-core';
import { ProfileStore } from '../profiles/profile.store';
import { LockService, ProfileBusyError } from '../profiles/lock.service';
import { ProfileService } from '../profiles/profile.service';
import { AuditLogger } from './audit.logger';
import { RunService } from './run.service';
import type { RunRecord } from './run.types';

class FakePage implements PageLike {
  constructor(private readonly opts: { fail?: boolean } = {}) {}
  async goto() { if (this.opts.fail) throw new Error('nav timeout'); return null; }
  async title() { return 'Example Domain'; }
  url() { return 'https://example.com/'; }
  async screenshot() { return null; }
}
class FakeContext implements BrowserContextLike {
  constructor(private readonly fail: boolean) {}
  async newPage() { return new FakePage({ fail: this.fail }); }
  async close() { /* noop */ }
}
class FakeLauncher implements BrowserLauncher {
  constructor(private readonly fail = false) {}
  async ensureBinary() { /* noop */ }
  async launchPersistentContext(_opts: LaunchOptions) { return new FakeContext(this.fail); }
}

async function harness(fail = false) {
  const dataRoot = await mkdtemp(join(tmpdir(), 'socmint-run-data-'));
  const artifactsRoot = await mkdtemp(join(tmpdir(), 'socmint-run-art-'));
  const store = new ProfileStore(dataRoot);
  const lock = new LockService(180000);
  const profiles = new ProfileService(store, lock, dataRoot);
  const browser = new CloakBrowserService(new FakeLauncher(fail));
  const audit = new AuditLogger(artifactsRoot);
  const runs = new RunService(profiles, lock, browser, audit, dataRoot, artifactsRoot);
  return { dataRoot, artifactsRoot, store, lock, profiles, runs };
}

describe('RunService.execute', () => {
  it('completes a run, writes result.json, and releases the lock', async () => {
    const { runs, profiles, lock, dataRoot, artifactsRoot } = await harness();
    const p = await profiles.create({ label: 'inv-01' });
    const rec = await runs.execute(p.id, { url: 'https://example.com' });

    expect(rec.status).toBe('completed');
    expect(rec.page).toEqual({ title: 'Example Domain', finalUrl: 'https://example.com/' });

    const onDisk: RunRecord = JSON.parse(
      await readFile(resolve(artifactsRoot, 'runs', rec.id, 'result.json'), 'utf8'),
    );
    expect(onDisk.id).toBe(rec.id);
    expect(await lock.isLocked(resolve(dataRoot, 'profiles', p.id))).toBe(false);
  });

  it('records a failed run when navigation throws, and still releases the lock', async () => {
    const { runs, profiles, lock, dataRoot } = await harness(true);
    const p = await profiles.create({ label: 'inv-01' });
    const rec = await runs.execute(p.id, { url: 'https://example.com' });

    expect(rec.status).toBe('failed');
    expect(rec.error).toContain('nav timeout');
    expect(await lock.isLocked(resolve(dataRoot, 'profiles', p.id))).toBe(false);
  });

  it('throws ProfileBusyError when the profile is already locked', async () => {
    const { runs, profiles, lock, dataRoot } = await harness();
    const p = await profiles.create({ label: 'inv-01' });
    await lock.acquire(resolve(dataRoot, 'profiles', p.id), 999);
    await expect(runs.execute(p.id, { url: 'https://example.com' })).rejects.toBeInstanceOf(ProfileBusyError);
  });

  it('appends an audit entry for each run', async () => {
    const { runs, profiles, artifactsRoot } = await harness();
    const p = await profiles.create({ label: 'inv-01' });
    const rec = await runs.execute(p.id, { url: 'https://example.com' });
    const log = await readFile(resolve(artifactsRoot, 'audit.log'), 'utf8');
    expect(log).toContain(rec.id);
    expect(log).toContain(p.id);
  });

  it('getRun reads back a persisted record', async () => {
    const { runs, profiles } = await harness();
    const p = await profiles.create({ label: 'inv-01' });
    const rec = await runs.execute(p.id, { url: 'https://example.com' });
    expect((await runs.getRun(rec.id))?.id).toBe(rec.id);
    expect(await runs.getRun('missing')).toBeNull();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run:

```bash
pnpm exec nx test automation-api --testPathPattern=run.service
```

Expected: FAIL — cannot find module `./run.service`.

- [ ] **Step 5: Write the implementation**

Create `apps/automation-api/src/runs/run.service.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  CloakBrowserService,
  resolveProfileDir,
  resolveUserDataDir,
} from '@socmint/browser-core';
import type { LaunchOptions, RunPageOptions } from '@socmint/browser-core';
import { LockService } from '../profiles/lock.service';
import { ProfileService } from '../profiles/profile.service';
import { AuditLogger } from './audit.logger';
import type { RunRecord } from './run.types';

export interface RunRequest {
  url: string;
  options?: {
    screenshot?: boolean;
    waitUntil?: 'load' | 'domcontentloaded' | 'commit';
    timeoutMs?: number;
  };
}

export class RunService {
  constructor(
    private readonly profiles: ProfileService,
    private readonly lock: LockService,
    private readonly browser: CloakBrowserService,
    private readonly audit: AuditLogger,
    private readonly dataRoot: string,
    private readonly artifactsRoot: string,
  ) {}

  private runDir(runId: string): string {
    return resolve(this.artifactsRoot, 'runs', runId);
  }

  async execute(profileId: string, req: RunRequest): Promise<RunRecord> {
    const profile = await this.profiles.get(profileId); // throws ProfileNotFoundError → 404
    const profileDir = resolveProfileDir(this.dataRoot, profileId);

    await this.lock.acquire(profileDir, process.pid); // throws ProfileBusyError → 409

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
    const runOpts: RunPageOptions = {
      url: req.url,
      waitUntil: req.options?.waitUntil,
      timeoutMs: req.options?.timeoutMs,
      screenshot: req.options?.screenshot,
      screenshotPath: req.options?.screenshot ? resolve(runDir, 'screenshot.png') : undefined,
    };

    let record: RunRecord;
    try {
      await this.profiles.setStatus(profileId, 'running');
      const page = await this.browser.runPage(launch, runOpts);
      record = {
        id: runId,
        profileId,
        url: req.url,
        status: 'completed',
        startedAt,
        finishedAt: new Date().toISOString(),
        error: null,
        page: { title: page.title, finalUrl: page.finalUrl },
        artifacts: {
          screenshot: page.screenshotPath ? `runs/${runId}/screenshot.png` : null,
        },
      };
    } catch (err) {
      record = {
        id: runId,
        profileId,
        url: req.url,
        status: 'failed',
        startedAt,
        finishedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
        page: null,
        artifacts: { screenshot: null },
      };
    } finally {
      await this.lock.release(profileDir);
      await this.profiles.setStatus(profileId, 'idle');
    }

    await writeFile(resolve(runDir, 'result.json'), JSON.stringify(record, null, 2), 'utf8');
    await this.audit.append({
      profileId,
      runId,
      url: req.url,
      timestamp: startedAt,
    });

    return record;
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    try {
      const raw = await readFile(resolve(this.runDir(runId), 'result.json'), 'utf8');
      return JSON.parse(raw) as RunRecord;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run:

```bash
pnpm exec nx test automation-api --testPathPattern=run.service
```

Expected: PASS — all 5 tests green.

> **If this fails because `cloakbrowser` errors on import** (the barrel re-exports the real launcher, which `import`s `cloakbrowser`; a fake is injected so the package is never *used*, only loaded): mock it for the app's Jest run. Add to `apps/automation-api/jest.config.ts` inside the config object:
>
> ```ts
> moduleNameMapper: {
>   '^cloakbrowser$': '<rootDir>/src/test/cloakbrowser.mock.ts',
> },
> ```
>
> and create `apps/automation-api/src/test/cloakbrowser.mock.ts`:
>
> ```ts
> export const ensureBinary = async () => undefined;
> export const launchPersistentContext = async () => { throw new Error('mocked: not used in unit tests'); };
> ```
>
> Commit these two changes with the task.

- [ ] **Step 7: Commit**

```bash
git add apps/automation-api/src/runs/run.types.ts apps/automation-api/src/runs/dto.ts apps/automation-api/src/runs/run.service.ts apps/automation-api/src/runs/run.service.spec.ts
git commit -m "feat(api): RunService orchestration (lock, launch, persist, audit)"
```

---

## Task 15: Controllers + DI wiring + bootstrap

**Files:**
- Create: `apps/automation-api/src/profiles/profiles.controller.ts`
- Create: `apps/automation-api/src/runs/runs.controller.ts`
- Modify: `apps/automation-api/src/app/app.module.ts`
- Modify: `apps/automation-api/src/main.ts`

- [ ] **Step 1: Write the profiles controller**

Create `apps/automation-api/src/profiles/profiles.controller.ts`:

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
import { CreateProfileDto, UpdateProfileDto } from './dto';
import { ProfileService } from './profile.service';

@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profiles: ProfileService) {}

  @Post()
  @HttpCode(201)
  create(@Body() dto: CreateProfileDto) {
    return this.profiles.create(dto);
  }

  @Get()
  list() {
    return this.profiles.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.profiles.get(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProfileDto) {
    return this.profiles.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.profiles.remove(id);
  }
}
```

- [ ] **Step 2: Write the runs controller**

Create `apps/automation-api/src/runs/runs.controller.ts`:

```ts
import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { RunRequestDto } from './dto';
import { RunService } from './run.service';

@Controller()
export class RunsController {
  constructor(private readonly runs: RunService) {}

  @Post('profiles/:id/runs')
  execute(@Param('id') id: string, @Body() dto: RunRequestDto) {
    return this.runs.execute(id, { url: dto.url, options: dto.options });
  }

  @Get('runs/:id')
  async getRun(@Param('id') id: string) {
    const record = await this.runs.getRun(id);
    if (!record) throw new NotFoundException(`Run not found: ${id}`);
    return record;
  }
}
```

- [ ] **Step 3: Write the exception filter mapping domain errors to HTTP codes**

Create `apps/automation-api/src/app/domain-exception.filter.ts`:

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

@Catch(ProfileNotFoundError, ProfileRunningError, ProfileBusyError)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(err: Error, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    if (err instanceof ProfileNotFoundError) status = HttpStatus.NOT_FOUND; // 404
    else if (err instanceof ProfileRunningError || err instanceof ProfileBusyError)
      status = HttpStatus.CONFLICT; // 409
    res.status(status).json(new HttpException(err.message, status).getResponse());
  }
}
```

- [ ] **Step 4: Wire the module**

Replace `apps/automation-api/src/app/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import {
  CloakBrowserLauncher,
  CloakBrowserService,
} from '@socmint/browser-core';
import { ProfilesController } from '../profiles/profiles.controller';
import { ProfileStore } from '../profiles/profile.store';
import { LockService } from '../profiles/lock.service';
import { ProfileService } from '../profiles/profile.service';
import { AuditLogger } from '../runs/audit.logger';
import { RunService } from '../runs/run.service';
import { RunsController } from '../runs/runs.controller';
import { APP_CONFIG, AppConfig, loadConfig } from './config';

@Module({
  controllers: [ProfilesController, RunsController],
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    {
      provide: ProfileStore,
      useFactory: (cfg: AppConfig) => new ProfileStore(cfg.dataRoot),
      inject: [APP_CONFIG],
    },
    {
      provide: LockService,
      useFactory: (cfg: AppConfig) => new LockService(cfg.profileLockTtlMs),
      inject: [APP_CONFIG],
    },
    {
      provide: ProfileService,
      useFactory: (store: ProfileStore, lock: LockService, cfg: AppConfig) =>
        new ProfileService(store, lock, cfg.dataRoot),
      inject: [ProfileStore, LockService, APP_CONFIG],
    },
    {
      provide: AuditLogger,
      useFactory: (cfg: AppConfig) => new AuditLogger(cfg.artifactsRoot),
      inject: [APP_CONFIG],
    },
    {
      provide: CloakBrowserService,
      useFactory: () => new CloakBrowserService(new CloakBrowserLauncher()),
    },
    {
      provide: RunService,
      useFactory: (
        profiles: ProfileService,
        lock: LockService,
        browser: CloakBrowserService,
        audit: AuditLogger,
        cfg: AppConfig,
      ) => new RunService(profiles, lock, browser, audit, cfg.dataRoot, cfg.artifactsRoot),
      inject: [ProfileService, LockService, CloakBrowserService, AuditLogger, APP_CONFIG],
    },
  ],
})
export class AppModule {}
```

- [ ] **Step 5: Wire bootstrap (ensureBinary + stale-lock sweep + loopback bind + global validation)**

Replace `apps/automation-api/src/main.ts`:

```ts
import 'reflect-metadata';
import { resolve } from 'node:path';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CloakBrowserLauncher } from '@socmint/browser-core';
import { AppModule } from './app/app.module';
import { loadConfig } from './app/config';
import { DomainExceptionFilter } from './app/domain-exception.filter';
import { LockService } from './profiles/lock.service';

async function bootstrap() {
  const cfg = loadConfig();

  // Mandatory binary warm-up so run requests never trigger a multi-minute download.
  await new CloakBrowserLauncher().ensureBinary();

  // Clear stale locks left by a crashed run before serving traffic.
  await new LockService(cfg.profileLockTtlMs).clearStaleUnder(
    resolve(cfg.dataRoot, 'profiles'),
  );

  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new DomainExceptionFilter());

  await app.listen(cfg.port, cfg.host); // loopback by default
  Logger.log(`automation-api listening on http://${cfg.host}:${cfg.port}`, 'Bootstrap');
}

bootstrap();
```

- [ ] **Step 6: Verify the whole project builds and all unit tests pass**

Run:

```bash
pnpm exec nx test automation-api
pnpm exec nx test browser-core
pnpm exec nx build automation-api
```

Expected: all tests PASS; build succeeds. (`nx build automation-api` compiles `main.ts` which imports `cloakbrowser`; if the build fails only on missing `cloakbrowser` types, confirm the `cloakbrowser.d.ts` from Task 6 Step 2 exists.)

- [ ] **Step 7: Commit**

```bash
git add apps/automation-api/src/profiles/profiles.controller.ts apps/automation-api/src/runs/runs.controller.ts apps/automation-api/src/app/domain-exception.filter.ts apps/automation-api/src/app/app.module.ts apps/automation-api/src/main.ts
git commit -m "feat(api): controllers, DI wiring, and hardened bootstrap"
```

---

## Task 16: Gated E2E smoke test (optional)

**Files:**
- Create: `apps/automation-api/src/e2e/run-flow.e2e.spec.ts`

> This test launches **real Chromium** and hits `https://example.com`. It is gated behind `RUN_E2E=1` and expects the binary to be pre-provisioned (`CLOAKBROWSER_BINARY_PATH`) or already cached, so it never flakes CI by triggering a 200MB download.

- [ ] **Step 1: Write the gated E2E**

Create `apps/automation-api/src/e2e/run-flow.e2e.spec.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app/app.module';

const maybe = process.env.RUN_E2E === '1' ? describe : describe.skip;

maybe('run flow (e2e)', () => {
  let app: INestApplication;
  let dataRoot: string;
  let artifactsRoot: string;

  beforeAll(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'socmint-e2e-data-'));
    artifactsRoot = await mkdtemp(join(tmpdir(), 'socmint-e2e-art-'));
    process.env.DATA_ROOT = dataRoot;
    process.env.ARTIFACTS_ROOT = artifactsRoot;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  }, 120000);

  afterAll(async () => {
    await app?.close();
    await rm(dataRoot, { recursive: true, force: true });
    await rm(artifactsRoot, { recursive: true, force: true });
  });

  it('creates a profile then runs against example.com', async () => {
    const created = await request(app.getHttpServer())
      .post('/profiles')
      .send({ label: 'e2e-01', launchDefaults: { headless: true } })
      .expect(201);

    const run = await request(app.getHttpServer())
      .post(`/profiles/${created.body.id}/runs`)
      .send({ url: 'https://example.com', options: { screenshot: false } })
      .expect(201);

    expect(run.body.status).toBe('completed');
    expect(run.body.page.title).toMatch(/example/i);
  }, 120000);
});
```

- [ ] **Step 2: Install supertest dev dependency**

Run:

```bash
pnpm add -D supertest @types/supertest
```

Expected: dev dependencies added.

- [ ] **Step 3: Verify the gated test is skipped by default**

Run:

```bash
pnpm exec nx test automation-api --testPathPattern=run-flow.e2e
```

Expected: the suite reports as **skipped** (0 run) because `RUN_E2E` is not set. (To actually run it on a machine with the binary: set `RUN_E2E=1` and optionally `CLOAKBROWSER_BINARY_PATH`, then re-run.)

- [ ] **Step 4: Commit**

```bash
git add apps/automation-api/src/e2e/run-flow.e2e.spec.ts package.json pnpm-lock.yaml
git commit -m "test(api): gated e2e smoke test for the run flow"
```

---

## Task 17: Final verification

- [ ] **Step 1: Run the entire test + build matrix**

Run:

```bash
pnpm exec nx run-many -t test build
```

Expected: every project's tests PASS and builds succeed.

- [ ] **Step 2: Manual smoke against the running server (success criteria 1, 3, 4)**

Run the server, then exercise it (PowerShell):

```powershell
# Terminal A
pnpm exec nx serve automation-api
```

```powershell
# Terminal B — create a profile (criterion 1: data/profiles/<id>/user-data/ appears)
$p = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3000/profiles -ContentType application/json -Body '{"label":"investigator-01","launchDefaults":{"headless":true}}'
Get-ChildItem "data/profiles/$($p.id)/user-data"

# criterion 3: run returns a title (+ optional screenshot path)
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3000/profiles/$($p.id)/runs" -ContentType application/json -Body '{"url":"https://example.com","options":{"screenshot":true}}'

# criterion 4: a concurrent run returns 409 — fire two without awaiting the first
$body = '{"url":"https://example.com"}'
$j = Start-Job { param($id,$b) Invoke-WebRequest -Method Post -Uri "http://127.0.0.1:3000/profiles/$id/runs" -ContentType application/json -Body $b -SkipHttpErrorCheck } -ArgumentList $p.id,$body
Invoke-WebRequest -Method Post -Uri "http://127.0.0.1:3000/profiles/$($p.id)/runs" -ContentType application/json -Body $body -SkipHttpErrorCheck | Select-Object StatusCode
Receive-Job $j -Wait | Select-Object StatusCode
```

Expected: profile dir exists; first run returns `status: completed` + title; one of the two concurrent runs returns HTTP **409**.

- [ ] **Step 3: Final commit (if any docs/notes changed)**

```bash
git add -A
git commit -m "chore: final verification notes" --allow-empty
```

---

## Spec → Task coverage map

| Spec requirement | Task(s) |
|---|---|
| Nx layout (`apps/automation-api`, `libs/browser-core`) | 1, 2 |
| Env vars (`DATA_ROOT`, `ARTIFACTS_ROOT`, `PROFILE_LOCK_TTL_MS`, `HOST`, `CLOAKBROWSER_BINARY_PATH`) | 1, 8 |
| `profile.json` schema + lifecycle (create/update/delete/list) | 9, 12 |
| Concurrency via **exclusive lock file**, stale recovery | 10, 12, 15 |
| `browser-core` launch/navigate/screenshot, always-close | 5, 6 |
| `playwright-core >= 1.53`, primary `launchPersistentContext` | 2, 6 |
| `humanize`/`fingerprintSeed` not relied upon (verified-only opts) | 6 |
| HTTP API (all 7 endpoints) | 15 |
| Run record (`result.json`) | 14 |
| SSRF = allow all `http(s)`; loopback bind | 14, 15 |
| Binary `ensureBinary()` at bootstrap | 15 |
| Append-only audit log | 13, 14 |
| Path-traversal guard | 4, 9 |
| Module boundary (no `automation-api` import in `browser-core`) | 3–7 (lib has zero app imports) |
| Error mapping (404/409/400) | 11, 14, 15 |
| Testing: unit (resolver, lock race, validation), integration (CRUD, fake launcher), gated E2E | 4, 5, 8–14, 16 |
| Success criteria 1–5 | 16, 17 |
