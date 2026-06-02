# CloakBrowser UI + Interactive Login — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local React UI that, on "Create profile", opens a real Chromium window for manual login and persists the captured session into a filesystem-backed CloakBrowser profile.

**Architecture:** Nx (pnpm) monorepo. `libs/browser-core` wraps CloakBrowser behind a `BrowserLauncher` seam and exposes `openInteractiveSession` (visible window + close detection). `apps/automation-api` (NestJS) owns profile CRUD, an exclusive lock-file gate, and an in-process `SessionRegistry` that opens/closes interactive sessions and persists state. `apps/web` (React 19 + Vite + Tailwind + shadcn-style Radix primitives) drives it in a Minimalist Monochrome design, polling the API while a profile is authenticating.

**Tech Stack:** pnpm, Nx, NestJS 10, TypeScript, Jest (API/lib), Vitest + React Testing Library (web), `cloakbrowser` + `playwright-core >= 1.53`, `class-validator`/`class-transformer`, React 19, Vite, `react-router-dom`, Tailwind CSS 3.4, Radix UI, `@fontsource`, `lucide-react`, `sonner`.

**Decisions carried from the spec (2026-06-02):** local single-operator; manual window-close ends a session; exclusive `profile.lock` authoritative; SSRF not in scope (no run endpoint); `ensureBinary()` at bootstrap; `status ∈ idle | authenticating`; `lastLoginAt` added; run-automation deferred; UI is Minimalist Monochrome adapted to an admin tool with centralized tokens.

---

## File Structure

**`libs/browser-core/src/`**
- `lib/types.ts` — `LaunchOptions`, `PageLike`, `BrowserContextLike` (+ `on('close')`), `BrowserLauncher`, `InteractiveSession`.
- `lib/profile-path.resolver.ts` — `assertWithin`, `resolveProfileDir`, `resolveUserDataDir`.
- `lib/cloak-browser.service.ts` — `CloakBrowserService.openInteractiveSession`.
- `lib/cloak-browser.launcher.ts` — real `CloakBrowserLauncher`.
- `lib/cloak-browser.module.ts` — optional Nest adapter.
- `index.ts` — barrel.

**`apps/automation-api/src/`**
- `app/config.ts` — `AppConfig`, `loadConfig`, `APP_CONFIG`.
- `app/domain-exception.filter.ts` — domain errors → HTTP codes.
- `app/app.module.ts`, `main.ts` — DI + bootstrap.
- `profiles/` — `profile.types.ts`, `profile.store.ts`, `lock.service.ts`, `dto.ts`, `profile.service.ts`, `profiles.controller.ts`.
- `audit/audit.logger.ts` — append-only JSONL.
- `sessions/` — `session.registry.ts`, `sessions.controller.ts`.

**`apps/web/src/`**
- `styles/theme.css` — design tokens (CSS variables) + global texture.
- `api/client.ts` — typed fetch client + `Profile` type.
- `hooks/use-profiles.ts` — list + conditional polling.
- `components/ui/` — `button.tsx`, `input.tsx`, `dialog.tsx`, `badge.tsx`.
- `components/layout/sidebar.tsx` — nav (shared by desktop aside + mobile drawer).
- `components/layout/app-layout.tsx` — dashboard shell, mobile drawer, `<Outlet/>`, `<Toaster/>`.
- `components/profile-list.tsx`, `components/create-profile-dialog.tsx`.
- `pages/profiles-page.tsx` — profile-management view (masthead + list + dialog + handlers).
- `app.tsx` — `<Routes>` (router). `main.tsx` — `<BrowserRouter>` + mount.

---

## Task 1: Workspace scaffold (pnpm + Nx)

**Files:** Create `package.json`, `nx.json`, `tsconfig.base.json`, `.env.example`; Modify `.gitignore`.

- [ ] **Step 1: Init pnpm + install Nx + plugins**

```bash
pnpm init
pnpm add -D nx@latest @nx/workspace@latest @nx/nest@latest @nx/js@latest @nx/react@latest @nx/vite@latest @nx/jest@latest @nx/eslint@latest typescript@~5.5.0 @types/node jest@^29 ts-jest@^29
```

Expected: `package.json`, `pnpm-lock.yaml`, `node_modules/` created.

- [ ] **Step 2: Create `nx.json`**

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

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "composite": false,
    "declaration": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "importHelpers": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "target": "es2021",
    "lib": ["es2021", "dom"],
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

`.env.example`:

```dotenv
DATA_ROOT=./data
ARTIFACTS_ROOT=./artifacts
PROFILE_LOCK_TTL_MS=180000
HOST=127.0.0.1
PORT=3000
# CLOAKBROWSER_BINARY_PATH=
```

Append to `.gitignore` (skip lines already present):

```gitignore
tmp/
*.tsbuildinfo
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: scaffold pnpm + Nx workspace"
```

---

## Task 2: Generate projects + install runtime deps

**Files:** Create `libs/browser-core/**`, `apps/automation-api/**`.

- [ ] **Step 1: Generate the library and the API app**

```bash
pnpm exec nx g @nx/js:library browser-core --directory=libs/browser-core --importPath=@socmint/browser-core --unitTestRunner=jest --bundler=tsc --no-interactive
pnpm exec nx g @nx/nest:application automation-api --directory=apps/automation-api --unitTestRunner=jest --e2eTestRunner=none --no-interactive
```

Expected: both project trees created; `tsconfig.base.json` path for `@socmint/browser-core` present.

- [ ] **Step 2: Install runtime deps**

```bash
pnpm add cloakbrowser playwright-core@^1.53.0 class-validator class-transformer
pnpm add @nestjs/common @nestjs/core reflect-metadata rxjs
```

- [ ] **Step 3: Remove generator sample files**

```bash
git rm -f libs/browser-core/src/lib/browser-core.ts libs/browser-core/src/lib/browser-core.spec.ts
git rm -f apps/automation-api/src/app/app.controller.ts apps/automation-api/src/app/app.controller.spec.ts apps/automation-api/src/app/app.service.ts apps/automation-api/src/app/app.service.spec.ts
```

(Delete the equivalents if your Nx version named them differently. Keep `app.module.ts` and `main.ts`.)

- [ ] **Step 4: Empty barrel + verify**

`libs/browser-core/src/index.ts`:

```ts
export {};
```

```bash
pnpm exec nx build browser-core
```

Expected: build succeeds (0 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: generate browser-core lib and automation-api app"
```

---

## Task 3: `browser-core` types (with close-event + interactive session)

**Files:** Create `libs/browser-core/src/lib/types.ts`; Modify `libs/browser-core/src/index.ts`.

- [ ] **Step 1: Write the types**

`libs/browser-core/src/lib/types.ts`:

```ts
export interface LaunchOptions {
  /** Absolute, already-resolved userDataDir. */
  userDataDir: string;
  headless?: boolean;
  proxy?: string | null;
  geoip?: boolean;
  [key: string]: unknown;
}

export interface PageLike {
  url(): string;
}

export interface BrowserContextLike {
  newPage(): Promise<PageLike>;
  pages(): PageLike[];
  on(event: 'close', listener: () => void): void;
  close(): Promise<void>;
}

export interface BrowserLauncher {
  ensureBinary(): Promise<void>;
  launchPersistentContext(opts: LaunchOptions): Promise<BrowserContextLike>;
}

/** Handle to a live, operator-driven browser window. */
export interface InteractiveSession {
  /** Fires exactly once when the context closes (window closed or close() called). */
  onClosed(listener: () => void): void;
  /** Force-close the context (also triggers onClosed). */
  close(): Promise<void>;
}
```

- [ ] **Step 2: Export from barrel**

`libs/browser-core/src/index.ts`:

```ts
export * from './lib/types';
```

- [ ] **Step 3: Verify + commit**

```bash
pnpm exec nx build browser-core
git add -A && git commit -m "feat(browser-core): types for interactive sessions"
```

Expected: build succeeds.

---

## Task 4: Path resolver + traversal guard (TDD)

**Files:** Create `libs/browser-core/src/lib/profile-path.resolver.ts` + `.spec.ts`; Modify barrel.

- [ ] **Step 1: Write the failing test**

`libs/browser-core/src/lib/profile-path.resolver.spec.ts`:

```ts
import { resolve } from 'node:path';
import { assertWithin, resolveProfileDir, resolveUserDataDir } from './profile-path.resolver';

const ROOT = resolve('/tmp/socmint-data');

describe('profile-path.resolver', () => {
  it('resolves the profile dir under DATA_ROOT', () => {
    expect(resolveProfileDir(ROOT, 'abc-123')).toBe(resolve(ROOT, 'profiles', 'abc-123'));
  });
  it('resolves the user-data dir', () => {
    expect(resolveUserDataDir(ROOT, 'abc-123')).toBe(resolve(ROOT, 'profiles', 'abc-123', 'user-data'));
  });
  it('rejects traversal / separators in the id', () => {
    expect(() => resolveProfileDir(ROOT, '../../etc')).toThrow(/invalid profile id/i);
    expect(() => resolveProfileDir(ROOT, 'a/b')).toThrow(/invalid profile id/i);
    expect(() => resolveProfileDir(ROOT, 'a\\b')).toThrow(/invalid profile id/i);
  });
  it('assertWithin throws when escaping root, passes for root + children', () => {
    expect(() => assertWithin(ROOT, resolve(ROOT, '..', 'evil'))).toThrow(/escapes/i);
    expect(() => assertWithin(ROOT, ROOT)).not.toThrow();
    expect(() => assertWithin(ROOT, resolve(ROOT, 'child'))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm exec nx test browser-core --testPathPattern=profile-path
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`libs/browser-core/src/lib/profile-path.resolver.ts`:

```ts
import { resolve, sep } from 'node:path';

export function assertWithin(root: string, target: string): void {
  const r = resolve(root);
  const t = resolve(target);
  if (t !== r && !t.startsWith(r + sep)) {
    throw new Error(`Path escapes root: ${t} not within ${r}`);
  }
}

function assertSafeId(profileId: string): void {
  if (!profileId || profileId.includes('..') || profileId.includes('/') || profileId.includes('\\')) {
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

- [ ] **Step 4: Run — expect PASS**

```bash
pnpm exec nx test browser-core --testPathPattern=profile-path
```

Expected: PASS.

- [ ] **Step 5: Export + commit**

Add to barrel: `export * from './lib/profile-path.resolver';`

```bash
git add -A && git commit -m "feat(browser-core): path resolver with traversal guard"
```

---

## Task 5: `CloakBrowserService.openInteractiveSession` (TDD, fake context)

**Files:** Create `libs/browser-core/src/lib/cloak-browser.service.ts` + `.spec.ts`; Modify barrel.

- [ ] **Step 1: Write the failing test**

`libs/browser-core/src/lib/cloak-browser.service.spec.ts`:

```ts
import { CloakBrowserService } from './cloak-browser.service';
import type { BrowserContextLike, BrowserLauncher, LaunchOptions, PageLike } from './types';

class FakePage implements PageLike { url() { return 'about:blank'; } }

class FakeContext implements BrowserContextLike {
  public closed = false;
  public newPageCalls = 0;
  private closeListeners: Array<() => void> = [];
  constructor(private startPages: PageLike[] = []) {}
  pages() { return this.startPages; }
  async newPage() { this.newPageCalls++; const p = new FakePage(); this.startPages = [...this.startPages, p]; return p; }
  on(_event: 'close', listener: () => void) { this.closeListeners.push(listener); }
  async close() { this.closed = true; this.emitClose(); }
  /** test helper: simulate the operator closing the window */
  emitClose() { this.closeListeners.forEach((l) => l()); }
}

class FakeLauncher implements BrowserLauncher {
  public lastLaunch: LaunchOptions | null = null;
  constructor(public readonly context: FakeContext) {}
  async ensureBinary() {}
  async launchPersistentContext(opts: LaunchOptions) { this.lastLaunch = opts; return this.context; }
}

describe('CloakBrowserService.openInteractiveSession', () => {
  it('forces headless:false and opens a window when none exists', async () => {
    const context = new FakeContext([]); // no initial page
    const launcher = new FakeLauncher(context);
    const service = new CloakBrowserService(launcher);
    await service.openInteractiveSession({ userDataDir: '/d/u', headless: true });
    expect(launcher.lastLaunch?.headless).toBe(false);
    expect(context.newPageCalls).toBe(1);
  });

  it('does not open an extra page when one already exists', async () => {
    const context = new FakeContext([new FakePage()]);
    const service = new CloakBrowserService(new FakeLauncher(context));
    await service.openInteractiveSession({ userDataDir: '/d/u' });
    expect(context.newPageCalls).toBe(0);
  });

  it('fires onClosed exactly once when the window closes', async () => {
    const context = new FakeContext([new FakePage()]);
    const service = new CloakBrowserService(new FakeLauncher(context));
    const session = await service.openInteractiveSession({ userDataDir: '/d/u' });
    let calls = 0;
    session.onClosed(() => { calls++; });
    context.emitClose();
    context.emitClose(); // second close must not re-fire
    expect(calls).toBe(1);
  });

  it('close() closes the underlying context', async () => {
    const context = new FakeContext([new FakePage()]);
    const service = new CloakBrowserService(new FakeLauncher(context));
    const session = await service.openInteractiveSession({ userDataDir: '/d/u' });
    await session.close();
    expect(context.closed).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm exec nx test browser-core --testPathPattern=cloak-browser.service
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`libs/browser-core/src/lib/cloak-browser.service.ts`:

```ts
import type { BrowserLauncher, InteractiveSession, LaunchOptions } from './types';

export class CloakBrowserService {
  constructor(private readonly launcher: BrowserLauncher) {}

  /** Launch a visible, operator-driven window bound to a profile's userDataDir. */
  async openInteractiveSession(launch: LaunchOptions): Promise<InteractiveSession> {
    const context = await this.launcher.launchPersistentContext({ ...launch, headless: false });

    // Ensure a window is actually shown.
    if (context.pages().length === 0) {
      await context.newPage();
    }

    const listeners: Array<() => void> = [];
    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      listeners.forEach((l) => l());
    };
    context.on('close', fire);

    return {
      onClosed(listener: () => void) {
        listeners.push(listener);
      },
      async close() {
        await context.close();
      },
    };
  }
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
pnpm exec nx test browser-core --testPathPattern=cloak-browser.service
```

Expected: PASS (4 tests).

- [ ] **Step 5: Export + commit**

Add to barrel: `export * from './lib/cloak-browser.service';`

```bash
git add -A && git commit -m "feat(browser-core): openInteractiveSession with once-only close"
```

---

## Task 6: Real `CloakBrowserLauncher`

**Files:** Create `libs/browser-core/src/lib/cloak-browser.launcher.ts`; maybe `cloakbrowser.d.ts`; Modify barrel.

- [ ] **Step 1: Write the adapter**

`libs/browser-core/src/lib/cloak-browser.launcher.ts`:

```ts
import { ensureBinary, launchPersistentContext } from 'cloakbrowser';
import type { BrowserContextLike, BrowserLauncher, LaunchOptions } from './types';

/** Thin pass-through to CloakBrowser's Playwright-compatible API. */
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

- [ ] **Step 2: Add ambient types if needed**

If `nx build browser-core` reports a missing declaration for `cloakbrowser`, create `libs/browser-core/src/cloakbrowser.d.ts`:

```ts
declare module 'cloakbrowser' {
  export function ensureBinary(): Promise<void>;
  export function launchPersistentContext(opts: Record<string, unknown>): Promise<unknown>;
}
```

- [ ] **Step 3: Build + export + commit**

```bash
pnpm exec nx build browser-core
```

Add to barrel: `export * from './lib/cloak-browser.launcher';`

```bash
git add -A && git commit -m "feat(browser-core): real CloakBrowserLauncher adapter"
```

Expected: build succeeds.

---

## Task 7: Optional Nest module adapter

**Files:** Create `libs/browser-core/src/lib/cloak-browser.module.ts`; Modify barrel.

- [ ] **Step 1: Write the module**

`libs/browser-core/src/lib/cloak-browser.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { CloakBrowserLauncher } from './cloak-browser.launcher';
import { CloakBrowserService } from './cloak-browser.service';
import type { BrowserLauncher } from './types';

export const BROWSER_LAUNCHER = Symbol('BROWSER_LAUNCHER');

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

- [ ] **Step 2: Build + export + commit**

```bash
pnpm exec nx build browser-core
```

Add to barrel: `export * from './lib/cloak-browser.module';`

```bash
git add -A && git commit -m "feat(browser-core): optional NestJS module adapter"
```

Expected: build succeeds.

---

## Task 8: App config loader (TDD)

**Files:** Create `apps/automation-api/src/app/config.ts` + `config.spec.ts`.

- [ ] **Step 1: Failing test**

`apps/automation-api/src/app/config.spec.ts`:

```ts
import { resolve } from 'node:path';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('defaults when env empty', () => {
    const c = loadConfig({});
    expect(c.dataRoot).toBe(resolve('./data'));
    expect(c.artifactsRoot).toBe(resolve('./artifacts'));
    expect(c.profileLockTtlMs).toBe(180000);
    expect(c.host).toBe('127.0.0.1');
    expect(c.port).toBe(3000);
    expect(c.binaryPath).toBeNull();
  });
  it('reads + resolves overrides', () => {
    const c = loadConfig({ DATA_ROOT: './x', ARTIFACTS_ROOT: './y', PROFILE_LOCK_TTL_MS: '5000', HOST: '0.0.0.0', PORT: '8080', CLOAKBROWSER_BINARY_PATH: '/opt/c' });
    expect(c.dataRoot).toBe(resolve('./x'));
    expect(c.profileLockTtlMs).toBe(5000);
    expect(c.host).toBe('0.0.0.0');
    expect(c.port).toBe(8080);
    expect(c.binaryPath).toBe('/opt/c');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm exec nx test automation-api --testPathPattern=config
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`apps/automation-api/src/app/config.ts`:

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

- [ ] **Step 4: Run — expect PASS + commit**

```bash
pnpm exec nx test automation-api --testPathPattern=config
git add -A && git commit -m "feat(api): config loader"
```

Expected: PASS.

---

## Task 9: Profile types + filesystem store (TDD)

**Files:** Create `apps/automation-api/src/profiles/profile.types.ts`, `profile.store.ts` + `profile.store.spec.ts`.

- [ ] **Step 1: Write the types**

`apps/automation-api/src/profiles/profile.types.ts`:

```ts
export type ProfileStatus = 'idle' | 'authenticating';

export interface LaunchDefaults {
  headless: boolean;
  geoip: boolean;
}

export interface ProfileMetadata {
  id: string;
  label: string;
  userDataDir: string; // "profiles/<id>/user-data"
  proxy: string | null;
  fingerprintSeed: string | null;
  launchDefaults: LaunchDefaults;
  status: ProfileStatus;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Failing test**

`apps/automation-api/src/profiles/profile.store.spec.ts`:

```ts
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ProfileStore } from './profile.store';
import type { ProfileMetadata } from './profile.types';

function sample(id: string): ProfileMetadata {
  return {
    id, label: 'inv-01', userDataDir: `profiles/${id}/user-data`,
    proxy: null, fingerprintSeed: null,
    launchDefaults: { headless: false, geoip: false },
    status: 'idle', lastLoginAt: null,
    createdAt: '2026-06-02T00:00:00.000Z', updatedAt: '2026-06-02T00:00:00.000Z',
  };
}

describe('ProfileStore', () => {
  let dataRoot: string; let store: ProfileStore;
  beforeEach(async () => { dataRoot = await mkdtemp(join(tmpdir(), 'socmint-store-')); store = new ProfileStore(dataRoot); });
  afterEach(async () => { await rm(dataRoot, { recursive: true, force: true }); });

  it('write then read round-trips + creates user-data dir', async () => {
    const p = sample('id-1');
    await store.write(p);
    const onDisk = JSON.parse(await readFile(resolve(dataRoot, 'profiles', 'id-1', 'profile.json'), 'utf8'));
    expect(onDisk).toEqual(p);
    expect(await store.read('id-1')).toEqual(p);
  });
  it('read returns null when missing', async () => { expect(await store.read('nope')).toBeNull(); });
  it('list returns all', async () => {
    await store.write(sample('id-1')); await store.write(sample('id-2'));
    expect((await store.list()).map((p) => p.id).sort()).toEqual(['id-1', 'id-2']);
  });
  it('remove deletes the tree', async () => {
    await store.write(sample('id-1')); await store.remove('id-1');
    expect(await store.read('id-1')).toBeNull();
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

```bash
pnpm exec nx test automation-api --testPathPattern=profile.store
```

Expected: FAIL (module not found).

- [ ] **Step 4: Implement**

`apps/automation-api/src/profiles/profile.store.ts`:

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
    await mkdir(resolveUserDataDir(this.dataRoot, profile.id), { recursive: true });
    await writeFile(this.metaPath(profile.id), JSON.stringify(profile, null, 2), 'utf8');
  }

  async read(id: string): Promise<ProfileMetadata | null> {
    try {
      return JSON.parse(await readFile(this.metaPath(id), 'utf8')) as ProfileMetadata;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async list(): Promise<ProfileMetadata[]> {
    const root = resolve(this.dataRoot, 'profiles');
    let ids: string[];
    try { ids = await readdir(root); }
    catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []; throw err; }
    const out: ProfileMetadata[] = [];
    for (const id of ids) { const p = await this.read(id); if (p) out.push(p); }
    return out;
  }

  async remove(id: string): Promise<void> {
    await rm(resolveProfileDir(this.dataRoot, id), { recursive: true, force: true });
  }
}
```

- [ ] **Step 5: Run — expect PASS + commit**

```bash
pnpm exec nx test automation-api --testPathPattern=profile.store
git add -A && git commit -m "feat(api): profile types + filesystem store"
```

Expected: PASS.

---

## Task 10: Exclusive lock service + stale recovery (TDD)

**Files:** Create `apps/automation-api/src/profiles/lock.service.ts` + `lock.service.spec.ts`.

- [ ] **Step 1: Failing test**

`apps/automation-api/src/profiles/lock.service.spec.ts`:

```ts
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LockService, ProfileBusyError } from './lock.service';

describe('LockService', () => {
  let dataRoot: string; let dir: string; let lock: LockService;
  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'socmint-lock-'));
    dir = resolve(dataRoot, 'profiles', 'id-1');
    await mkdir(dir, { recursive: true });
    lock = new LockService(180000);
  });
  afterEach(async () => { await rm(dataRoot, { recursive: true, force: true }); });

  it('acquire writes pid + startedAt', async () => {
    await lock.acquire(dir, 1234);
    const raw = JSON.parse(await readFile(resolve(dir, 'profile.lock'), 'utf8'));
    expect(raw.pid).toBe(1234); expect(typeof raw.startedAt).toBe('string');
  });
  it('second acquire on a live lock throws ProfileBusyError', async () => {
    await lock.acquire(dir, 1); await expect(lock.acquire(dir, 2)).rejects.toBeInstanceOf(ProfileBusyError);
  });
  it('release is idempotent', async () => {
    await lock.acquire(dir, 1); await lock.release(dir);
    await expect(lock.release(dir)).resolves.toBeUndefined();
    await expect(lock.acquire(dir, 9)).resolves.toBeUndefined();
  });
  it('acquire overrides a stale lock', async () => {
    await writeFile(resolve(dir, 'profile.lock'), JSON.stringify({ pid: 1, startedAt: '2000-01-01T00:00:00.000Z' }));
    await expect(lock.acquire(dir, 4)).resolves.toBeUndefined();
  });
  it('isLocked: false when stale, true when live', async () => {
    await writeFile(resolve(dir, 'profile.lock'), JSON.stringify({ pid: 1, startedAt: '2000-01-01T00:00:00.000Z' }));
    expect(await lock.isLocked(dir)).toBe(false);
    await lock.acquire(dir, 1); expect(await lock.isLocked(dir)).toBe(true);
  });
  it('clearStaleUnder removes only stale locks', async () => {
    const other = resolve(dataRoot, 'profiles', 'id-2'); await mkdir(other, { recursive: true });
    await lock.acquire(dir, 1);
    await writeFile(resolve(other, 'profile.lock'), JSON.stringify({ pid: 1, startedAt: '2000-01-01T00:00:00.000Z' }));
    await lock.clearStaleUnder(resolve(dataRoot, 'profiles'));
    expect(await lock.isLocked(dir)).toBe(true);
    expect(await lock.isLocked(other)).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm exec nx test automation-api --testPathPattern=lock.service
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`apps/automation-api/src/profiles/lock.service.ts`:

```ts
import { open, readFile, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

export class ProfileBusyError extends Error {
  constructor() { super('Profile already running'); this.name = 'ProfileBusyError'; }
}

interface LockFile { pid: number; startedAt: string; }

export class LockService {
  constructor(private readonly ttlMs: number) {}

  private lockPath(dir: string) { return resolve(dir, 'profile.lock'); }

  private async readLock(path: string): Promise<LockFile | null> {
    try { return JSON.parse(await readFile(path, 'utf8')) as LockFile; }
    catch { return null; }
  }

  private isStale(lock: LockFile): boolean {
    const started = Date.parse(lock.startedAt);
    if (Number.isNaN(started)) return true;
    return Date.now() - started > this.ttlMs;
  }

  async acquire(dir: string, pid: number): Promise<void> {
    const path = this.lockPath(dir);
    const existing = await this.readLock(path);
    if (existing && this.isStale(existing)) await rm(path, { force: true });
    try {
      const handle = await open(path, 'wx');
      await handle.writeFile(JSON.stringify({ pid, startedAt: new Date().toISOString() }));
      await handle.close();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new ProfileBusyError();
      throw err;
    }
  }

  async release(dir: string): Promise<void> { await rm(this.lockPath(dir), { force: true }); }

  async isLocked(dir: string): Promise<boolean> {
    const lock = await this.readLock(this.lockPath(dir));
    return lock !== null && !this.isStale(lock);
  }

  async clearStaleUnder(profilesRoot: string): Promise<void> {
    let ids: string[];
    try { ids = await readdir(profilesRoot); }
    catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return; throw err; }
    for (const id of ids) {
      const path = this.lockPath(resolve(profilesRoot, id));
      const lock = await this.readLock(path);
      if (lock && this.isStale(lock)) await rm(path, { force: true });
    }
  }
}
```

- [ ] **Step 4: Run — expect PASS + commit**

```bash
pnpm exec nx test automation-api --testPathPattern=lock.service
git add -A && git commit -m "feat(api): exclusive lock service with stale recovery"
```

Expected: PASS (6 tests).

---

## Task 11: Profile DTOs (TDD)

**Files:** Create `apps/automation-api/src/profiles/dto.ts` + `dto.spec.ts`.

- [ ] **Step 1: Failing test**

`apps/automation-api/src/profiles/dto.spec.ts`:

```ts
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateProfileDto, UpdateProfileDto } from './dto';

function errs<T extends object>(cls: new () => T, payload: unknown) {
  return validateSync(plainToInstance(cls, payload), { whitelist: true });
}

describe('Profile DTOs', () => {
  it('CreateProfileDto accepts {label} and optional proxy', () => {
    expect(errs(CreateProfileDto, { label: 'a' })).toHaveLength(0);
    expect(errs(CreateProfileDto, { label: 'a', proxy: 'http://1.2.3.4:8080' })).toHaveLength(0);
  });
  it('CreateProfileDto rejects empty label', () => {
    expect(errs(CreateProfileDto, {}).length).toBeGreaterThan(0);
    expect(errs(CreateProfileDto, { label: '' }).length).toBeGreaterThan(0);
  });
  it('UpdateProfileDto accepts empty patch and rejects empty label', () => {
    expect(errs(UpdateProfileDto, {})).toHaveLength(0);
    expect(errs(UpdateProfileDto, { label: '' }).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm exec nx test automation-api --testPathPattern=profiles/dto
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`apps/automation-api/src/profiles/dto.ts`:

```ts
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateProfileDto {
  @IsString() @IsNotEmpty() label!: string;
  @IsOptional() @IsString() proxy?: string | null;
}

export class UpdateProfileDto {
  @IsOptional() @IsString() @IsNotEmpty() label?: string;
  @IsOptional() @IsString() proxy?: string | null;
}
```

- [ ] **Step 4: Run — expect PASS + commit**

```bash
pnpm exec nx test automation-api --testPathPattern=profiles/dto
git add -A && git commit -m "feat(api): profile create/update DTOs"
```

Expected: PASS.

---

## Task 12: ProfileService — CRUD + lifecycle (TDD)

**Files:** Create `apps/automation-api/src/profiles/profile.service.ts` + `profile.service.spec.ts`.

- [ ] **Step 1: Failing test**

`apps/automation-api/src/profiles/profile.service.spec.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ProfileStore } from './profile.store';
import { LockService } from './lock.service';
import { ProfileNotFoundError, ProfileRunningError, ProfileService } from './profile.service';

describe('ProfileService', () => {
  let dataRoot: string; let svc: ProfileService; let store: ProfileStore; let lock: LockService;
  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'socmint-svc-'));
    store = new ProfileStore(dataRoot); lock = new LockService(180000);
    svc = new ProfileService(store, lock, dataRoot);
  });
  afterEach(async () => { await rm(dataRoot, { recursive: true, force: true }); });

  it('create assigns UUID, idle status, null lastLoginAt, defaults', async () => {
    const p = await svc.create({ label: 'inv-01' });
    expect(p.id).toMatch(/[0-9a-f-]{36}/);
    expect(p.status).toBe('idle');
    expect(p.lastLoginAt).toBeNull();
    expect(p.userDataDir).toBe(`profiles/${p.id}/user-data`);
    expect(p.launchDefaults).toEqual({ headless: false, geoip: false });
    expect(await store.read(p.id)).toEqual(p);
  });
  it('get throws ProfileNotFoundError for unknown id', async () => {
    await expect(svc.get('nope')).rejects.toBeInstanceOf(ProfileNotFoundError);
  });
  it('update changes label/proxy and bumps updatedAt', async () => {
    const p = await svc.create({ label: 'inv-01' });
    const u = await svc.update(p.id, { label: 'renamed', proxy: 'http://p:1' });
    expect(u.label).toBe('renamed'); expect(u.proxy).toBe('http://p:1');
    expect(u.updatedAt >= p.updatedAt).toBe(true);
  });
  it('update rejects while a live lock is held', async () => {
    const p = await svc.create({ label: 'inv-01' });
    await lock.acquire(resolve(dataRoot, 'profiles', p.id), 1);
    await expect(svc.update(p.id, { label: 'x' })).rejects.toBeInstanceOf(ProfileRunningError);
  });
  it('setStatus and setLastLoginAt persist', async () => {
    const p = await svc.create({ label: 'inv-01' });
    await svc.setStatus(p.id, 'authenticating');
    expect((await svc.get(p.id)).status).toBe('authenticating');
    await svc.setLastLoginAt(p.id, '2026-06-02T01:00:00.000Z');
    const after = await svc.get(p.id);
    expect(after.lastLoginAt).toBe('2026-06-02T01:00:00.000Z');
    expect(after.status).toBe('authenticating');
  });
  it('remove deletes idle; rejects while locked', async () => {
    const p = await svc.create({ label: 'inv-01' });
    await lock.acquire(resolve(dataRoot, 'profiles', p.id), 1);
    await expect(svc.remove(p.id)).rejects.toBeInstanceOf(ProfileRunningError);
    await lock.release(resolve(dataRoot, 'profiles', p.id));
    await svc.remove(p.id);
    await expect(svc.get(p.id)).rejects.toBeInstanceOf(ProfileNotFoundError);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm exec nx test automation-api --testPathPattern=profile.service
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`apps/automation-api/src/profiles/profile.service.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { resolveProfileDir } from '@socmint/browser-core';
import type { CreateProfileDto, UpdateProfileDto } from './dto';
import { LockService } from './lock.service';
import { ProfileStore } from './profile.store';
import type { ProfileMetadata, ProfileStatus } from './profile.types';

export class ProfileNotFoundError extends Error {
  constructor(id: string) { super(`Profile not found: ${id}`); this.name = 'ProfileNotFoundError'; }
}
export class ProfileRunningError extends Error {
  constructor(id: string) { super(`Profile is running: ${id}`); this.name = 'ProfileRunningError'; }
}

export class ProfileService {
  constructor(
    private readonly store: ProfileStore,
    private readonly lock: LockService,
    private readonly dataRoot: string,
  ) {}

  private dir(id: string) { return resolveProfileDir(this.dataRoot, id); }

  async create(dto: CreateProfileDto): Promise<ProfileMetadata> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const profile: ProfileMetadata = {
      id, label: dto.label, userDataDir: `profiles/${id}/user-data`,
      proxy: dto.proxy ?? null, fingerprintSeed: null,
      launchDefaults: { headless: false, geoip: false },
      status: 'idle', lastLoginAt: null, createdAt: now, updatedAt: now,
    };
    await this.store.write(profile);
    return profile;
  }

  list(): Promise<ProfileMetadata[]> { return this.store.list(); }

  async get(id: string): Promise<ProfileMetadata> {
    const p = await this.store.read(id);
    if (!p) throw new ProfileNotFoundError(id);
    return p;
  }

  async update(id: string, dto: UpdateProfileDto): Promise<ProfileMetadata> {
    const p = await this.get(id);
    if (await this.lock.isLocked(this.dir(id))) throw new ProfileRunningError(id);
    const next: ProfileMetadata = {
      ...p,
      label: dto.label ?? p.label,
      proxy: dto.proxy ?? p.proxy,
      updatedAt: new Date().toISOString(),
    };
    await this.store.write(next);
    return next;
  }

  async setStatus(id: string, status: ProfileStatus): Promise<void> {
    const p = await this.get(id);
    await this.store.write({ ...p, status, updatedAt: new Date().toISOString() });
  }

  async setLastLoginAt(id: string, at: string): Promise<void> {
    const p = await this.get(id);
    await this.store.write({ ...p, lastLoginAt: at, updatedAt: new Date().toISOString() });
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    if (await this.lock.isLocked(this.dir(id))) throw new ProfileRunningError(id);
    await this.store.remove(id);
  }
}
```

- [ ] **Step 4: Run — expect PASS + commit**

```bash
pnpm exec nx test automation-api --testPathPattern=profile.service
git add -A && git commit -m "feat(api): ProfileService CRUD + lifecycle"
```

Expected: PASS (6 tests).

---

## Task 13: Append-only audit logger (TDD)

**Files:** Create `apps/automation-api/src/audit/audit.logger.ts` + `audit.logger.spec.ts`.

- [ ] **Step 1: Failing test**

`apps/automation-api/src/audit/audit.logger.spec.ts`:

```ts
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AuditLogger } from './audit.logger';

describe('AuditLogger', () => {
  let root: string; let logger: AuditLogger;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'socmint-audit-')); logger = new AuditLogger(root); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('appends one JSON line per entry', async () => {
    await logger.append({ profileId: 'p1', sessionId: 's1', event: 'opened', at: '2026-06-02T00:00:00.000Z' });
    await logger.append({ profileId: 'p1', sessionId: 's1', event: 'closed', at: '2026-06-02T00:01:00.000Z' });
    const lines = (await readFile(resolve(root, 'audit.log'), 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).event).toBe('opened');
    expect(JSON.parse(lines[1]).event).toBe('closed');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm exec nx test automation-api --testPathPattern=audit.logger
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`apps/automation-api/src/audit/audit.logger.ts`:

```ts
import { appendFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export type AuditEntry = Record<string, string>;

export class AuditLogger {
  constructor(private readonly artifactsRoot: string) {}

  async append(entry: AuditEntry): Promise<void> {
    await mkdir(this.artifactsRoot, { recursive: true });
    await appendFile(resolve(this.artifactsRoot, 'audit.log'), JSON.stringify(entry) + '\n', 'utf8');
  }
}
```

- [ ] **Step 4: Run — expect PASS + commit**

```bash
pnpm exec nx test automation-api --testPathPattern=audit.logger
git add -A && git commit -m "feat(api): append-only audit logger"
```

Expected: PASS.

---

## Task 14: SessionRegistry — interactive login (TDD)

**Files:** Create `apps/automation-api/src/sessions/session.registry.ts` + `session.registry.spec.ts`.

- [ ] **Step 1: Failing test**

`apps/automation-api/src/sessions/session.registry.spec.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { InteractiveSession, LaunchOptions } from '@socmint/browser-core';
import { ProfileStore } from '../profiles/profile.store';
import { LockService, ProfileBusyError } from '../profiles/lock.service';
import { ProfileService } from '../profiles/profile.service';
import { AuditLogger } from '../audit/audit.logger';
import { SessionRegistry } from './session.registry';

/** Fake CloakBrowserService capturing the close callback so the test can fire it. */
class FakeBrowser {
  public lastLaunch: LaunchOptions | null = null;
  public closed = false;
  private closeCb: (() => void) | null = null;
  public fail = false;
  async openInteractiveSession(launch: LaunchOptions): Promise<InteractiveSession> {
    if (this.fail) throw new Error('launch failed');
    this.lastLaunch = launch;
    return {
      onClosed: (cb: () => void) => { this.closeCb = cb; },
      close: async () => { this.closed = true; this.closeCb?.(); },
    };
  }
  /** test helper: simulate the operator closing the window */
  fireClose() { this.closeCb?.(); }
}

async function harness() {
  const dataRoot = await mkdtemp(join(tmpdir(), 'socmint-sess-data-'));
  const artifactsRoot = await mkdtemp(join(tmpdir(), 'socmint-sess-art-'));
  const store = new ProfileStore(dataRoot);
  const lock = new LockService(180000);
  const profiles = new ProfileService(store, lock, dataRoot);
  const browser = new FakeBrowser();
  const audit = new AuditLogger(artifactsRoot);
  const registry = new SessionRegistry(profiles, lock, browser as never, audit, dataRoot);
  return { dataRoot, artifactsRoot, store, lock, profiles, browser, registry };
}

describe('SessionRegistry', () => {
  it('open acquires lock, sets authenticating, launches with resolved userDataDir', async () => {
    const { profiles, browser, registry, lock, dataRoot } = await harness();
    const p = await profiles.create({ label: 'inv-01', proxy: 'http://x:1' });
    const res = await registry.open(p.id);
    expect(res.status).toBe('authenticating');
    expect((await profiles.get(p.id)).status).toBe('authenticating');
    expect(await lock.isLocked(resolve(dataRoot, 'profiles', p.id))).toBe(true);
    expect(browser.lastLaunch?.userDataDir).toBe(resolve(dataRoot, 'profiles', p.id, 'user-data'));
    expect(browser.lastLaunch?.proxy).toBe('http://x:1');
  });

  it('window close → idle, lastLoginAt set, lock released', async () => {
    const { profiles, browser, registry, lock, dataRoot } = await harness();
    const p = await profiles.create({ label: 'inv-01' });
    await registry.open(p.id);
    browser.fireClose();
    await new Promise((r) => setImmediate(r)); // let async cleanup settle
    const after = await profiles.get(p.id);
    expect(after.status).toBe('idle');
    expect(after.lastLoginAt).not.toBeNull();
    expect(await lock.isLocked(resolve(dataRoot, 'profiles', p.id))).toBe(false);
  });

  it('second open while active throws ProfileBusyError', async () => {
    const { profiles, registry } = await harness();
    const p = await profiles.create({ label: 'inv-01' });
    await registry.open(p.id);
    await expect(registry.open(p.id)).rejects.toBeInstanceOf(ProfileBusyError);
  });

  it('launch failure rolls back lock + status', async () => {
    const { profiles, browser, registry, lock, dataRoot } = await harness();
    const p = await profiles.create({ label: 'inv-01' });
    browser.fail = true;
    await expect(registry.open(p.id)).rejects.toThrow('launch failed');
    expect((await profiles.get(p.id)).status).toBe('idle');
    expect(await lock.isLocked(resolve(dataRoot, 'profiles', p.id))).toBe(false);
  });

  it('close() force-closes and cleans up', async () => {
    const { profiles, browser, registry, lock, dataRoot } = await harness();
    const p = await profiles.create({ label: 'inv-01' });
    await registry.open(p.id);
    await registry.close(p.id);
    await new Promise((r) => setImmediate(r));
    expect(browser.closed).toBe(true);
    expect((await profiles.get(p.id)).status).toBe('idle');
    expect(await lock.isLocked(resolve(dataRoot, 'profiles', p.id))).toBe(false);
  });

  it('writes opened + closed audit entries', async () => {
    const { profiles, browser, registry, artifactsRoot } = await harness();
    const p = await profiles.create({ label: 'inv-01' });
    await registry.open(p.id);
    browser.fireClose();
    await new Promise((r) => setImmediate(r));
    const { readFile } = await import('node:fs/promises');
    const log = await readFile(resolve(artifactsRoot, 'audit.log'), 'utf8');
    expect(log).toContain('"event":"opened"');
    expect(log).toContain('"event":"closed"');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm exec nx test automation-api --testPathPattern=session.registry
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`apps/automation-api/src/sessions/session.registry.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { CloakBrowserService, resolveProfileDir, resolveUserDataDir } from '@socmint/browser-core';
import type { InteractiveSession } from '@socmint/browser-core';
import { LockService } from '../profiles/lock.service';
import { ProfileService } from '../profiles/profile.service';
import { AuditLogger } from '../audit/audit.logger';

interface ActiveSession { sessionId: string; session: InteractiveSession; startedAt: string; }

export class SessionRegistry {
  private readonly active = new Map<string, ActiveSession>();

  constructor(
    private readonly profiles: ProfileService,
    private readonly lock: LockService,
    private readonly browser: CloakBrowserService,
    private readonly audit: AuditLogger,
    private readonly dataRoot: string,
  ) {}

  private dir(profileId: string) { return resolveProfileDir(this.dataRoot, profileId); }

  async open(profileId: string): Promise<{ sessionId: string; status: 'authenticating' }> {
    const profile = await this.profiles.get(profileId); // 404
    await this.lock.acquire(this.dir(profileId), process.pid); // 409

    try {
      await this.profiles.setStatus(profileId, 'authenticating');
      const session = await this.browser.openInteractiveSession({
        userDataDir: resolveUserDataDir(this.dataRoot, profileId),
        proxy: profile.proxy,
        geoip: profile.launchDefaults.geoip,
      });
      const sessionId = randomUUID();
      const startedAt = new Date().toISOString();
      this.active.set(profileId, { sessionId, session, startedAt });
      session.onClosed(() => { void this.cleanup(profileId); });
      await this.audit.append({ profileId, sessionId, event: 'opened', at: startedAt });
      return { sessionId, status: 'authenticating' };
    } catch (err) {
      // rollback: release the lock + revert status before surfacing the error
      await this.lock.release(this.dir(profileId));
      await this.profiles.setStatus(profileId, 'idle');
      throw err;
    }
  }

  private async cleanup(profileId: string): Promise<void> {
    const entry = this.active.get(profileId);
    if (!entry) return;
    this.active.delete(profileId);
    const at = new Date().toISOString();
    await this.lock.release(this.dir(profileId));
    await this.profiles.setStatus(profileId, 'idle');
    await this.profiles.setLastLoginAt(profileId, at);
    await this.audit.append({ profileId, sessionId: entry.sessionId, event: 'closed', at });
  }

  /** Force-close an active session (no-op if none). */
  async close(profileId: string): Promise<void> {
    const entry = this.active.get(profileId);
    if (!entry) return;
    await entry.session.close(); // triggers onClosed → cleanup
  }

  /** Persist all sessions on shutdown. */
  async onModuleDestroy(): Promise<void> {
    for (const profileId of [...this.active.keys()]) {
      await this.close(profileId);
    }
  }
}
```

- [ ] **Step 4: Run — expect PASS + commit**

```bash
pnpm exec nx test automation-api --testPathPattern=session.registry
git add -A && git commit -m "feat(api): in-process interactive SessionRegistry"
```

Expected: PASS (6 tests).

> If this fails because importing `@socmint/browser-core` loads `cloakbrowser` (the barrel re-exports the real launcher), mock it for the API's Jest run: add `moduleNameMapper: { '^cloakbrowser$': '<rootDir>/src/test/cloakbrowser.mock.ts' }` to `apps/automation-api/jest.config.ts` and create `apps/automation-api/src/test/cloakbrowser.mock.ts` exporting `export const ensureBinary = async () => undefined; export const launchPersistentContext = async () => { throw new Error('mocked'); };`. Commit both.

---

## Task 15: Controllers + DI wiring + bootstrap

**Files:** Create `apps/automation-api/src/profiles/profiles.controller.ts`, `apps/automation-api/src/sessions/sessions.controller.ts`, `apps/automation-api/src/app/domain-exception.filter.ts`; Modify `apps/automation-api/src/app/app.module.ts`, `apps/automation-api/src/main.ts`.

- [ ] **Step 1: Profiles controller**

`apps/automation-api/src/profiles/profiles.controller.ts`:

```ts
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { CreateProfileDto, UpdateProfileDto } from './dto';
import { ProfileService } from './profile.service';

@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profiles: ProfileService) {}

  @Post() @HttpCode(201) create(@Body() dto: CreateProfileDto) { return this.profiles.create(dto); }
  @Get() list() { return this.profiles.list(); }
  @Get(':id') get(@Param('id') id: string) { return this.profiles.get(id); }
  @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdateProfileDto) { return this.profiles.update(id, dto); }
  @Delete(':id') @HttpCode(204) async remove(@Param('id') id: string) { await this.profiles.remove(id); }
}
```

- [ ] **Step 2: Sessions controller**

`apps/automation-api/src/sessions/sessions.controller.ts`:

```ts
import { Controller, Delete, HttpCode, Param, Post } from '@nestjs/common';
import { SessionRegistry } from './session.registry';

@Controller('profiles/:id/login-session')
export class SessionsController {
  constructor(private readonly sessions: SessionRegistry) {}

  @Post() @HttpCode(202) open(@Param('id') id: string) { return this.sessions.open(id); }
  @Delete() @HttpCode(204) async close(@Param('id') id: string) { await this.sessions.close(id); }
}
```

- [ ] **Step 3: Domain exception filter**

`apps/automation-api/src/app/domain-exception.filter.ts`:

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { ProfileBusyError } from '../profiles/lock.service';
import { ProfileNotFoundError, ProfileRunningError } from '../profiles/profile.service';

@Catch(ProfileNotFoundError, ProfileRunningError, ProfileBusyError)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(err: Error, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    if (err instanceof ProfileNotFoundError) status = HttpStatus.NOT_FOUND;
    else if (err instanceof ProfileRunningError || err instanceof ProfileBusyError) status = HttpStatus.CONFLICT;
    res.status(status).json(new HttpException(err.message, status).getResponse());
  }
}
```

- [ ] **Step 4: Wire the module**

Replace `apps/automation-api/src/app/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { CloakBrowserLauncher, CloakBrowserService } from '@socmint/browser-core';
import { ProfilesController } from '../profiles/profiles.controller';
import { ProfileStore } from '../profiles/profile.store';
import { LockService } from '../profiles/lock.service';
import { ProfileService } from '../profiles/profile.service';
import { AuditLogger } from '../audit/audit.logger';
import { SessionRegistry } from '../sessions/session.registry';
import { SessionsController } from '../sessions/sessions.controller';
import { APP_CONFIG, AppConfig, loadConfig } from './config';

@Module({
  controllers: [ProfilesController, SessionsController],
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    { provide: ProfileStore, useFactory: (c: AppConfig) => new ProfileStore(c.dataRoot), inject: [APP_CONFIG] },
    { provide: LockService, useFactory: (c: AppConfig) => new LockService(c.profileLockTtlMs), inject: [APP_CONFIG] },
    {
      provide: ProfileService,
      useFactory: (s: ProfileStore, l: LockService, c: AppConfig) => new ProfileService(s, l, c.dataRoot),
      inject: [ProfileStore, LockService, APP_CONFIG],
    },
    { provide: AuditLogger, useFactory: (c: AppConfig) => new AuditLogger(c.artifactsRoot), inject: [APP_CONFIG] },
    { provide: CloakBrowserService, useFactory: () => new CloakBrowserService(new CloakBrowserLauncher()) },
    {
      provide: SessionRegistry,
      useFactory: (p: ProfileService, l: LockService, b: CloakBrowserService, a: AuditLogger, c: AppConfig) =>
        new SessionRegistry(p, l, b, a, c.dataRoot),
      inject: [ProfileService, LockService, CloakBrowserService, AuditLogger, APP_CONFIG],
    },
  ],
})
export class AppModule {}
```

- [ ] **Step 5: Bootstrap**

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
  await new CloakBrowserLauncher().ensureBinary();
  await new LockService(cfg.profileLockTtlMs).clearStaleUnder(resolve(cfg.dataRoot, 'profiles'));

  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: true }); // dev: Vite proxy preferred; CORS as a fallback
  app.enableShutdownHooks(); // so SessionRegistry.onModuleDestroy runs
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new DomainExceptionFilter());

  await app.listen(cfg.port, cfg.host);
  Logger.log(`automation-api on http://${cfg.host}:${cfg.port}`, 'Bootstrap');
}
bootstrap();
```

> `SessionRegistry.onModuleDestroy` runs only if it is registered as a provider (it is) AND shutdown hooks are enabled (`enableShutdownHooks()` above). Nest calls the `onModuleDestroy` method by convention.

- [ ] **Step 6: Verify whole API builds + tests pass**

```bash
pnpm exec nx test automation-api
pnpm exec nx build automation-api
```

Expected: all unit tests PASS; build succeeds (the `cloakbrowser.d.ts` from Task 6 must exist for the build to type-check `main.ts`).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(api): controllers, DI wiring, hardened bootstrap"
```

---

## Task 16: Generate the React app + UI dependencies

**Files:** Create `apps/web/**`.

- [ ] **Step 1: Generate the Vite React app**

```bash
pnpm exec nx g @nx/react:application web --directory=apps/web --bundler=vite --unitTestRunner=vitest --e2eTestRunner=none --style=css --routing=false --no-interactive
```

Expected: `apps/web/` with `src/main.tsx`, `src/app/`, `vite.config.ts`, `index.html`, vitest config.

- [ ] **Step 2: Install UI deps**

```bash
pnpm add react@^19 react-dom@^19 react-router-dom@^6
pnpm add @radix-ui/react-dialog lucide-react sonner
pnpm add @fontsource/playfair-display @fontsource/source-serif-4 @fontsource/jetbrains-mono
pnpm add -D tailwindcss@^3.4 postcss autoprefixer @testing-library/react @testing-library/user-event @testing-library/jest-dom
```

(If the generator created React 18, the explicit `react@^19`/`react-dom@^19` upgrades it.)

- [ ] **Step 3: Init Tailwind config**

Create `apps/web/tailwind.config.ts`:

```ts
import type { Config } from 'tailwindcss';

export default {
  content: ['apps/web/src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        muted: 'var(--muted)',
        'muted-foreground': 'var(--muted-foreground)',
        border: 'var(--border)',
        'border-light': 'var(--border-light)',
      },
      fontFamily: {
        display: ['"Playfair Display"', 'Georgia', 'serif'],
        serif: ['"Source Serif 4"', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      fontSize: { '8xl': '8rem', '9xl': '10rem' },
      borderRadius: { none: '0', DEFAULT: '0', sm: '0', md: '0', lg: '0', xl: '0' },
    },
  },
  plugins: [],
} satisfies Config;
```

Create `apps/web/postcss.config.js`:

```js
module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

- [ ] **Step 4: Configure the Vite dev proxy**

In `apps/web/vite.config.ts`, add a `server.proxy` entry inside the existing `defineConfig({...})` `server` block (create `server` if absent):

```ts
  server: {
    port: 4200,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
```

- [ ] **Step 5: Remove the sample app component**

```bash
git rm -f apps/web/src/app/app.tsx apps/web/src/app/app.spec.tsx
```

(Delete the generator's sample CSS/nx-welcome files too if present. We add our own `app.tsx` in Task 23.)

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore(web): generate React+Vite app with Tailwind + UI deps"
```

---

## Task 17: Design tokens + global styles (Minimalist Monochrome)

**Files:** Create `apps/web/src/styles/theme.css`; Modify `apps/web/src/main.tsx` (imports).

- [ ] **Step 1: Write the tokens + global texture**

`apps/web/src/styles/theme.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --background: #ffffff;
  --foreground: #000000;
  --muted: #f5f5f5;
  --muted-foreground: #525252;
  --border: #000000;
  --border-light: #e5e5e5;
}

* { border-radius: 0 !important; box-shadow: none !important; }

html, body, #root { height: 100%; }

body {
  margin: 0;
  background-color: var(--background);
  color: var(--foreground);
  font-family: '"Source Serif 4"', Georgia, serif;
  -webkit-font-smoothing: antialiased;
}

/* Global paper texture: faint horizontal hairlines (DNA: line-based, never flat). */
body::before {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  background-image: repeating-linear-gradient(0deg, transparent, transparent 1px, #000 1px, #000 2px);
  background-size: 100% 4px;
  opacity: 0.015;
}

#root { position: relative; z-index: 1; }

/* Blink for the authenticating indicator (binary, not gradual). */
@keyframes mono-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0.25; } }
.animate-mono-blink { animation: mono-blink 1s steps(1, end) infinite; }
```

- [ ] **Step 2: Import tokens + fonts in `main.tsx`**

Ensure the top of `apps/web/src/main.tsx` imports (replace any generated `./styles.css` import):

```ts
import '@fontsource/playfair-display/400.css';
import '@fontsource/playfair-display/700.css';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles/theme.css';
```

- [ ] **Step 3: Verify the app builds + commit**

```bash
pnpm exec nx build web
git add -A && git commit -m "feat(web): Minimalist Monochrome design tokens + global texture"
```

Expected: build succeeds.

---

## Task 18: API client + Profile type

**Files:** Create `apps/web/src/api/client.ts`.

- [ ] **Step 1: Write the client**

`apps/web/src/api/client.ts`:

```ts
export interface Profile {
  id: string;
  label: string;
  proxy: string | null;
  status: 'idle' | 'authenticating';
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try { const body = await res.json(); if (body?.message) message = String(body.message); } catch { /* ignore */ }
    throw new Error(message);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  listProfiles: () => req<Profile[]>('/profiles'),
  getProfile: (id: string) => req<Profile>(`/profiles/${id}`),
  createProfile: (body: { label: string; proxy?: string | null }) =>
    req<Profile>('/profiles', { method: 'POST', body: JSON.stringify(body) }),
  updateProfile: (id: string, body: { label?: string; proxy?: string | null }) =>
    req<Profile>(`/profiles/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteProfile: (id: string) => req<void>(`/profiles/${id}`, { method: 'DELETE' }),
  openLoginSession: (id: string) =>
    req<{ sessionId: string; status: 'authenticating' }>(`/profiles/${id}/login-session`, { method: 'POST' }),
  closeLoginSession: (id: string) => req<void>(`/profiles/${id}/login-session`, { method: 'DELETE' }),
};
```

- [ ] **Step 2: Verify + commit**

```bash
pnpm exec nx build web
git add -A && git commit -m "feat(web): typed API client"
```

Expected: build succeeds.

---

## Task 19: `useProfiles` hook with conditional polling (TDD)

**Files:** Create `apps/web/src/hooks/use-profiles.ts` + `use-profiles.spec.tsx`.

- [ ] **Step 1: Failing test**

`apps/web/src/hooks/use-profiles.spec.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useProfiles } from './use-profiles';
import { api, type Profile } from '../api/client';

function profile(over: Partial<Profile> = {}): Profile {
  return {
    id: 'p1', label: 'inv-01', proxy: null, status: 'idle',
    lastLoginAt: null, createdAt: '', updatedAt: '', ...over,
  };
}

// Real timers + a tiny poll interval keep the test deterministic (RTL waitFor
// relies on real timers, so do NOT use vi.useFakeTimers here).
describe('useProfiles', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('loads profiles on mount', async () => {
    vi.spyOn(api, 'listProfiles').mockResolvedValue([profile()]);
    const { result } = renderHook(() => useProfiles(10));
    await waitFor(() => expect(result.current.profiles).toHaveLength(1));
    expect(result.current.profiles[0].label).toBe('inv-01');
  });

  it('polls while authenticating, then stops once idle', async () => {
    const spy = vi.spyOn(api, 'listProfiles')
      .mockResolvedValueOnce([profile({ status: 'authenticating' })])
      .mockResolvedValue([profile({ status: 'idle', lastLoginAt: '2026-06-02T00:00:00.000Z' })]);
    renderHook(() => useProfiles(10));
    // 1st poll = authenticating → schedules another; 2nd = idle → stops scheduling.
    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2));
    const stable = spy.mock.calls.length;
    await new Promise((r) => setTimeout(r, 60));
    expect(spy.mock.calls.length).toBe(stable); // no further polls after idle
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm exec nx test web --testPathPattern=use-profiles
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`apps/web/src/hooks/use-profiles.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Profile } from '../api/client';

export function useProfiles(pollMs = 1500) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await api.listProfiles();
      setProfiles(next);
      setError(null);
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load profiles');
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      const next = await refresh();
      if (cancelled) return;
      const anyAuth = (next ?? []).some((p) => p.status === 'authenticating');
      if (anyAuth) timer.current = setTimeout(tick, pollMs);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh, pollMs]);

  return { profiles, error, refresh };
}
```

- [ ] **Step 4: Run — expect PASS + commit**

```bash
pnpm exec nx test web --testPathPattern=use-profiles
git add -A && git commit -m "feat(web): useProfiles hook with conditional polling"
```

Expected: PASS (2 tests).

---

## Task 20: Themed UI primitives (Button, Input, Badge, Dialog)

**Files:** Create `apps/web/src/components/ui/button.tsx`, `input.tsx`, `badge.tsx`, `dialog.tsx`.

- [ ] **Step 1: Button**

`apps/web/src/components/ui/button.tsx`:

```tsx
import { forwardRef, type ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'outline' | 'ghost';

const base =
  'inline-flex items-center gap-2 px-6 py-3 font-mono text-sm uppercase tracking-widest ' +
  'transition-colors duration-100 focus-visible:outline focus-visible:outline-[3px] ' +
  'focus-visible:outline-foreground focus-visible:outline-offset-[3px] disabled:opacity-40';

const variants: Record<Variant, string> = {
  primary: 'bg-foreground text-background hover:bg-background hover:text-foreground hover:outline hover:outline-[2px] hover:outline-foreground',
  outline: 'bg-transparent text-foreground outline outline-[2px] outline-foreground hover:bg-foreground hover:text-background',
  ghost: 'bg-transparent text-foreground hover:underline',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }>(
  ({ variant = 'primary', className = '', ...props }, ref) => (
    <button ref={ref} className={`${base} ${variants[variant]} ${className}`} {...props} />
  ),
);
Button.displayName = 'Button';
```

- [ ] **Step 2: Input**

`apps/web/src/components/ui/input.tsx`:

```tsx
import { forwardRef, type InputHTMLAttributes } from 'react';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = '', ...props }, ref) => (
    <input
      ref={ref}
      className={
        'w-full bg-background px-0 py-2 font-serif text-lg text-foreground ' +
        'border-0 border-b-2 border-foreground placeholder:italic placeholder:text-muted-foreground ' +
        'focus:border-b-4 focus:outline-none ' + className
      }
      {...props}
    />
  ),
);
Input.displayName = 'Input';
```

- [ ] **Step 3: Badge**

`apps/web/src/components/ui/badge.tsx`:

```tsx
import type { ReactNode } from 'react';

export function Badge({ inverted = false, children }: { inverted?: boolean; children: ReactNode }) {
  const cls = inverted
    ? 'bg-foreground text-background'
    : 'bg-transparent text-foreground outline outline-[1px] outline-foreground';
  return (
    <span className={`inline-block px-3 py-1 font-mono text-xs uppercase tracking-widest ${cls}`}>
      {children}
    </span>
  );
}
```

- [ ] **Step 4: Dialog (Radix, themed)**

`apps/web/src/components/ui/dialog.tsx`:

```tsx
import * as RadixDialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;

export function DialogContent({ title, children }: { title: string; children: ReactNode }) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-40 bg-foreground/40" />
      <RadixDialog.Content
        className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1/2 
                   border-2 border-foreground bg-background p-8 focus:outline-none"
      >
        <RadixDialog.Title className="mb-6 font-display text-3xl tracking-tight">{title}</RadixDialog.Title>
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

export const DialogClose = RadixDialog.Close;
```

- [ ] **Step 5: Verify + commit**

```bash
pnpm exec nx build web
git add -A && git commit -m "feat(web): monochrome UI primitives"
```

Expected: build succeeds.

---

## Task 21: ProfileList component (TDD)

**Files:** Create `apps/web/src/components/profile-list.tsx` + `profile-list.spec.tsx`.

- [ ] **Step 1: Failing test**

`apps/web/src/components/profile-list.spec.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { ProfileList } from './profile-list';
import type { Profile } from '../api/client';

const profiles: Profile[] = [
  { id: 'p1', label: 'inv-01', proxy: null, status: 'idle', lastLoginAt: '2026-06-02T00:00:00.000Z', createdAt: '', updatedAt: '' },
  { id: 'p2', label: 'inv-02', proxy: null, status: 'authenticating', lastLoginAt: null, createdAt: '', updatedAt: '' },
];

describe('ProfileList', () => {
  it('renders a row per profile with status', () => {
    render(<ProfileList profiles={profiles} onLogin={() => {}} onDelete={() => {}} />);
    expect(screen.getByText('inv-01')).toBeInTheDocument();
    expect(screen.getByText('inv-02')).toBeInTheDocument();
    expect(screen.getByText(/authenticating/i)).toBeInTheDocument();
  });

  it('shows an empty state when there are no profiles', () => {
    render(<ProfileList profiles={[]} onLogin={() => {}} onDelete={() => {}} />);
    expect(screen.getByText(/no profiles yet/i)).toBeInTheDocument();
  });

  it('calls onLogin with the profile id', async () => {
    const onLogin = vi.fn();
    render(<ProfileList profiles={profiles} onLogin={onLogin} onDelete={() => {}} />);
    await userEvent.click(screen.getAllByRole('button', { name: /log in again/i })[0]);
    expect(onLogin).toHaveBeenCalledWith('p1');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm exec nx test web --testPathPattern=profile-list
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`apps/web/src/components/profile-list.tsx`:

```tsx
import { LogIn, Trash2 } from 'lucide-react';
import type { Profile } from '../api/client';
import { Badge } from './ui/badge';

function formatDate(iso: string | null): string {
  return iso ? iso.replace('T', ' ').slice(0, 16) : '—';
}

export function ProfileList({
  profiles,
  onLogin,
  onDelete,
}: {
  profiles: Profile[];
  onLogin: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (profiles.length === 0) {
    return (
      <div className="border-t-4 border-foreground py-32 text-center">
        <p className="font-display text-5xl tracking-tight md:text-7xl">No profiles yet.</p>
        <p className="mt-6 font-mono text-sm uppercase tracking-widest text-muted-foreground">
          Create one to capture a login session.
        </p>
      </div>
    );
  }

  return (
    <table className="w-full border-collapse border-t-4 border-foreground">
      <thead>
        <tr className="border-b-2 border-foreground text-left font-mono text-xs uppercase tracking-widest">
          <th className="py-4 pr-4">Label</th>
          <th className="py-4 pr-4">Status</th>
          <th className="py-4 pr-4">Last login</th>
          <th className="py-4 pr-4 text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        {profiles.map((p) => (
          <tr
            key={p.id}
            className="group border-b border-foreground transition-colors duration-100 hover:bg-foreground hover:text-background"
          >
            <td className="py-5 pr-4 font-serif text-lg">{p.label}</td>
            <td className="py-5 pr-4">
              {p.status === 'authenticating' ? (
                <span className="font-mono text-xs uppercase tracking-widest">
                  <span className="animate-mono-blink">Opening browser —</span>
                </span>
              ) : (
                <Badge>Idle</Badge>
              )}
            </td>
            <td className="py-5 pr-4 font-mono text-sm">{formatDate(p.lastLoginAt)}</td>
            <td className="py-5 pr-4">
              <div className="flex justify-end gap-4">
                <button
                  onClick={() => onLogin(p.id)}
                  disabled={p.status === 'authenticating'}
                  className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 disabled:opacity-40"
                >
                  <LogIn size={16} strokeWidth={1.5} /> Log in again
                </button>
                <button
                  onClick={() => onDelete(p.id)}
                  disabled={p.status === 'authenticating'}
                  className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 disabled:opacity-40"
                >
                  <Trash2 size={16} strokeWidth={1.5} /> Delete
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Run — expect PASS + commit**

```bash
pnpm exec nx test web --testPathPattern=profile-list
git add -A && git commit -m "feat(web): ProfileList editorial table"
```

Expected: PASS (3 tests).

---

## Task 22: CreateProfileDialog component (TDD)

**Files:** Create `apps/web/src/components/create-profile-dialog.tsx` + `create-profile-dialog.spec.tsx`.

- [ ] **Step 1: Failing test**

`apps/web/src/components/create-profile-dialog.spec.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { CreateProfileDialog } from './create-profile-dialog';

describe('CreateProfileDialog', () => {
  it('submits the label and calls onCreate', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<CreateProfileDialog onCreate={onCreate} />);
    await userEvent.click(screen.getByRole('button', { name: /create profile/i }));
    await userEvent.type(screen.getByPlaceholderText(/label/i), 'investigator-01');
    await userEvent.click(screen.getByRole('button', { name: /create & open browser/i }));
    expect(onCreate).toHaveBeenCalledWith({ label: 'investigator-01', proxy: null });
  });

  it('does not submit an empty label', async () => {
    const onCreate = vi.fn();
    render(<CreateProfileDialog onCreate={onCreate} />);
    await userEvent.click(screen.getByRole('button', { name: /create profile/i }));
    await userEvent.click(screen.getByRole('button', { name: /create & open browser/i }));
    expect(onCreate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm exec nx test web --testPathPattern=create-profile-dialog
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`apps/web/src/components/create-profile-dialog.tsx`:

```tsx
import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogTrigger, DialogContent, DialogClose } from './ui/dialog';

export function CreateProfileDialog({
  onCreate,
}: {
  onCreate: (body: { label: string; proxy: string | null }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [proxy, setProxy] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!label.trim()) return;
    setBusy(true);
    try {
      await onCreate({ label: label.trim(), proxy: proxy.trim() || null });
      setOpen(false);
      setLabel('');
      setProxy('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Create profile</Button>
      </DialogTrigger>
      <DialogContent title="New profile">
        <div className="space-y-8">
          <label className="block">
            <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Label</span>
            <Input placeholder="Label (e.g. investigator-01)" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
          </label>
          <label className="block">
            <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Proxy (optional)</span>
            <Input placeholder="http://user:pass@host:port" value={proxy} onChange={(e) => setProxy(e.target.value)} />
          </label>
          <div className="flex items-center justify-between border-t-2 border-foreground pt-6">
            <DialogClose asChild>
              <Button variant="ghost" type="button">Cancel</Button>
            </DialogClose>
            <Button type="button" onClick={submit} disabled={busy}>
              Create &amp; open browser <ArrowRight size={16} strokeWidth={1.5} />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run — expect PASS + commit**

```bash
pnpm exec nx test web --testPathPattern=create-profile-dialog
git add -A && git commit -m "feat(web): CreateProfileDialog"
```

Expected: PASS (2 tests).

---

## Task 23: ProfilesPage (profile-management view)

**Files:** Create `apps/web/src/pages/profiles-page.tsx`.

> This is the body that drives profile management. The `<Toaster/>` lives in `AppLayout` (Task 25), not here. No failing-test-first step — it is composed entirely of already-tested units (`useProfiles`, `ProfileList`, `CreateProfileDialog`); the routing test in Task 26 exercises it end-to-end.

- [ ] **Step 1: Write the page**

`apps/web/src/pages/profiles-page.tsx`:

```tsx
import { toast } from 'sonner';
import { api } from '../api/client';
import { useProfiles } from '../hooks/use-profiles';
import { ProfileList } from '../components/profile-list';
import { CreateProfileDialog } from '../components/create-profile-dialog';

export function ProfilesPage() {
  const { profiles, error, refresh } = useProfiles();

  const handleCreate = async (body: { label: string; proxy: string | null }) => {
    try {
      const created = await api.createProfile(body);
      await api.openLoginSession(created.id);
      toast('Browser opening — log in, then close the window to save.');
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create profile');
    }
  };

  const handleLogin = async (id: string) => {
    try {
      await api.openLoginSession(id);
      toast('Browser opening — log in, then close the window to save.');
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to open login session');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteProfile(id);
      toast('Profile deleted.');
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete profile');
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-16 md:px-8 lg:px-12">
      <header className="mb-12">
        <div className="flex items-end justify-between gap-6">
          <h1 className="font-display text-6xl tracking-tighter md:text-8xl">PROFILES</h1>
          <CreateProfileDialog onCreate={handleCreate} />
        </div>
        <div className="mt-6 flex items-center gap-4">
          <div className="h-1 flex-1 bg-foreground" />
          <div className="h-3 w-3 border border-foreground" />
        </div>
        <p className="mt-4 font-mono text-xs uppercase tracking-widest text-muted-foreground">
          CloakBrowser session capture · local
        </p>
      </header>

      {error && (
        <p className="mb-6 border-2 border-foreground bg-foreground px-4 py-3 font-mono text-xs uppercase tracking-widest text-background">
          {error}
        </p>
      )}

      <ProfileList profiles={profiles} onLogin={handleLogin} onDelete={handleDelete} />
    </div>
  );
}
```

- [ ] **Step 2: Verify it builds + commit**

```bash
pnpm exec nx build web
git add -A && git commit -m "feat(web): ProfilesPage view"
```

Expected: build succeeds.

---

## Task 24: Sidebar navigation (TDD)

**Files:** Create `apps/web/src/components/layout/sidebar.tsx` + `sidebar.spec.tsx`.

- [ ] **Step 1: Failing test**

`apps/web/src/components/layout/sidebar.spec.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
import { Sidebar } from './sidebar';

describe('Sidebar', () => {
  it('renders the wordmark and an active Profiles link on /profiles', () => {
    render(<MemoryRouter initialEntries={['/profiles']}><Sidebar /></MemoryRouter>);
    expect(screen.getByText('SOCMINT')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /profiles/i });
    expect(link).toHaveAttribute('aria-current', 'page');
  });

  it('Profiles link is not current on another route', () => {
    render(<MemoryRouter initialEntries={['/other']}><Sidebar /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /profiles/i })).not.toHaveAttribute('aria-current', 'page');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm exec nx test web --testPathPattern=sidebar
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`apps/web/src/components/layout/sidebar.tsx`:

```tsx
import { NavLink } from 'react-router-dom';

const NAV = [{ to: '/profiles', label: 'Profiles' }];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex h-full flex-col p-6">
      <div className="font-display text-2xl tracking-tight">SOCMINT</div>
      <div className="my-4 h-1 bg-foreground" />
      <ul className="space-y-1">
        {NAV.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              onClick={onNavigate}
              className={({ isActive }) =>
                'block px-3 py-2 font-mono text-xs uppercase tracking-widest transition-colors duration-100 ' +
                'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 ' +
                (isActive ? 'bg-foreground text-background' : 'hover:underline')
              }
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
```

(React Router's `NavLink` sets `aria-current="page"` automatically on the active link.)

- [ ] **Step 4: Run — expect PASS + commit**

```bash
pnpm exec nx test web --testPathPattern=sidebar
git add -A && git commit -m "feat(web): monochrome Sidebar navigation"
```

Expected: PASS (2 tests).

---

## Task 25: AppLayout shell + mobile drawer (TDD)

**Files:** Create `apps/web/src/components/layout/app-layout.tsx` + `app-layout.spec.tsx`.

- [ ] **Step 1: Failing test**

`apps/web/src/components/layout/app-layout.spec.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
import { AppLayout } from './app-layout';

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/profiles']}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/profiles" element={<div>PAGE CONTENT</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AppLayout', () => {
  it('renders the routed Outlet content', () => {
    renderLayout();
    expect(screen.getByText('PAGE CONTENT')).toBeInTheDocument();
  });

  it('hamburger opens the drawer navigation', async () => {
    renderLayout();
    await userEvent.click(screen.getByRole('button', { name: /open navigation/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /profiles/i }).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm exec nx test web --testPathPattern=app-layout
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`apps/web/src/components/layout/app-layout.tsx`:

```tsx
import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { Toaster } from 'sonner';
import * as RadixDialog from '@radix-ui/react-dialog';
import { Sidebar } from './sidebar';

export function AppLayout() {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-full md:grid md:grid-cols-[16rem_1fr]">
      {/* Desktop: fixed sidebar, thin black right border */}
      <aside className="hidden border-r border-foreground md:block">
        <Sidebar />
      </aside>

      {/* Mobile: top bar + off-canvas drawer */}
      <div className="flex items-center justify-between border-b border-foreground p-4 md:hidden">
        <span className="font-display text-xl tracking-tight">SOCMINT</span>
        <RadixDialog.Root open={open} onOpenChange={setOpen}>
          <RadixDialog.Trigger asChild>
            <button
              aria-label="Open navigation"
              className="focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2"
            >
              <Menu size={24} strokeWidth={1.5} />
            </button>
          </RadixDialog.Trigger>
          <RadixDialog.Portal>
            <RadixDialog.Overlay className="fixed inset-0 z-40 bg-foreground/40" />
            <RadixDialog.Content className="fixed inset-y-0 left-0 z-50 w-64 border-r border-foreground bg-background focus:outline-none">
              <RadixDialog.Title className="sr-only">Navigation</RadixDialog.Title>
              <Sidebar onNavigate={() => setOpen(false)} />
            </RadixDialog.Content>
          </RadixDialog.Portal>
        </RadixDialog.Root>
      </div>

      <main className="min-w-0">
        <Outlet />
      </main>

      <Toaster
        position="bottom-right"
        toastOptions={{
          unstyled: true,
          classNames: {
            toast: 'border-2 border-foreground bg-background px-4 py-3 font-mono text-xs uppercase tracking-widest text-foreground',
            error: 'border-2 border-foreground bg-foreground px-4 py-3 font-mono text-xs uppercase tracking-widest text-background',
          },
        }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run — expect PASS + commit**

```bash
pnpm exec nx test web --testPathPattern=app-layout
git add -A && git commit -m "feat(web): AppLayout dashboard shell + mobile drawer"
```

Expected: PASS (2 tests).

---

## Task 26: Router wiring (TDD)

**Files:** Create `apps/web/src/app.spec.tsx`; Modify `apps/web/src/app.tsx`, `apps/web/src/main.tsx`.

- [ ] **Step 1: Failing test**

`apps/web/src/app.spec.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
import { App } from './app';
import { api } from './api/client';

describe('App routing', () => {
  beforeEach(() => { vi.spyOn(api, 'listProfiles').mockResolvedValue([]); });

  it('renders the Profiles view at /', async () => {
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: /profiles/i })).toBeInTheDocument();
  });

  it('redirects unknown paths to /profiles', async () => {
    render(<MemoryRouter initialEntries={['/nope']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: /profiles/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm exec nx test web --testPathPattern=app.spec
```

Expected: FAIL — `App` still renders the old single-page shell (no router), so the `import` differs / the redirect test fails.

- [ ] **Step 3: Replace `app.tsx` with the router**

`apps/web/src/app.tsx`:

```tsx
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/layout/app-layout';
import { ProfilesPage } from './pages/profiles-page';

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<ProfilesPage />} />
        <Route path="/profiles" element={<ProfilesPage />} />
        <Route path="*" element={<Navigate to="/profiles" replace />} />
      </Route>
    </Routes>
  );
}
```

- [ ] **Step 4: Wrap the app in `<BrowserRouter>` in `main.tsx`**

Replace `apps/web/src/main.tsx` (fonts + tokens stay at the top):

```tsx
import '@fontsource/playfair-display/400.css';
import '@fontsource/playfair-display/700.css';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles/theme.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
```

- [ ] **Step 5: Run routing test + full web suite + build + commit**

```bash
pnpm exec nx test web --testPathPattern=app.spec
pnpm exec nx test web
pnpm exec nx build web
git add -A && git commit -m "feat(web): dashboard router (BrowserRouter + Routes)"
```

Expected: routing tests PASS; all web tests PASS; build succeeds.

---

## Task 27: Final verification

- [ ] **Step 1: Whole-repo test + build**

```bash
pnpm exec nx run-many -t test build
```

Expected: every project's tests PASS and builds succeed.

- [ ] **Step 2: Manual smoke (two terminals, PowerShell)**

```powershell
# Terminal A — API (first run downloads the ~200MB Chromium during ensureBinary)
pnpm exec nx serve automation-api
```

```powershell
# Terminal B — UI
pnpm exec nx serve web
```

Then in a browser at `http://127.0.0.1:4200`:
1. The app loads as a dashboard: a fixed left **sidebar** (SOCMINT wordmark + active **Profiles** link) with the Profiles view on the right; `/` resolved to `/profiles` and an unknown path (e.g. `/nope`) redirects back to it (criterion 7).
2. Click **Create profile**, enter a label, click **Create & open browser** → a real Chromium window opens (criterion 1).
3. Log into a site in that window, then **close the window** → the row flips from "Opening browser —" to **Idle** with a `Last login` timestamp; confirm `data/profiles/<id>/user-data/` exists on disk (criterion 2).
4. Click **Log in again** on that profile → the site still remembers the prior login (criterion 3).
5. While a profile shows "Opening browser —", clicking its (disabled) actions does nothing; an extra `POST …/login-session` via the API returns **409** (criterion 4).
6. Narrow the window to mobile width → the sidebar collapses; the **hamburger** opens a left drawer with the same nav (criterion 7).

- [ ] **Step 3: Accessibility spot-check**

Tab through the page: the sidebar link, hamburger button, Create button, dialog inputs (border thickens on focus), and row actions all show a visible 3px black focus outline (criterion 5).

- [ ] **Step 4: Final commit**

```bash
git add -A && git commit -m "chore: final verification" --allow-empty
```

---

## Spec → Task coverage map

| Spec requirement | Task(s) |
|---|---|
| Nx layout (browser-core, automation-api, web) | 1, 2, 16 |
| `browser-core` `openInteractiveSession` + `on('close')` + once-only | 3, 5 |
| Real launcher + `ensureBinary` | 6 |
| Path-traversal guard | 4, 9 |
| Profile model: `status idle\|authenticating`, `lastLoginAt` | 9, 12 |
| Exclusive lock authority + stale recovery | 10, 12, 14, 15 |
| Profile CRUD + lifecycle (reject update/delete while locked) | 11, 12, 15 |
| `SessionRegistry` open/cleanup/close/onModuleDestroy + rollback | 14, 15 |
| Audit (opened/closed) append-only | 13, 14 |
| HTTP API (CRUD + login-session POST/DELETE) | 15 |
| Error mapping 404/409 + 503 binary | 14, 15 |
| Bootstrap: ensureBinary, stale sweep, loopback bind, shutdown hooks | 15 |
| Centralized tokens, zero radius, no shadow, serif fonts, texture | 17, 20 |
| shadcn-style themed primitives (Button/Input/Badge/Dialog) | 20 |
| Profile table (invert on hover, mono metadata, status chip) | 21 |
| Create → create + open login session flow | 22, 23 |
| Authenticating indicator (binary blink, not spinner) | 17, 21 |
| Empty state (oversized serif) | 21 |
| Vite dev proxy `/api`, conditional polling | 16, 18, 19 |
| Dashboard shell: fixed sidebar (desktop) + hamburger drawer (mobile) | 24, 25 |
| react-router: `/profiles`, `/` + unknown → `/profiles` | 26 |
| Sidebar active-link inversion (`aria-current`) | 24 |
| Accessibility (focus-visible, contrast, ≥44px) | 20, 21, 24, 25 |
| `browser-core` zero `automation-api` imports; core no NestJS | 3–7 |
| Success criteria 1–7 | 23, 24, 25, 26, 27 |
