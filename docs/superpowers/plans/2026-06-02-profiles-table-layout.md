# Profiles Table Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure `apps/web` into a left nav sidebar (Profiles only) plus a main area with a multi-row profile table whose rows carry the existing three functions inline.

**Architecture:** Replace the current narrow `ProfileTabs` rail + `ProfileList` + `ProfileDetail` master-detail with two regions: a `ProfileNav` sidebar and a `<main>` column containing a header (title + New profile dialog) and a `ProfileTable`. No selection state, no drawer. Reuse `useProfiles`, the `handleCreate/handleLogin/handleDelete` handlers, `CreateProfileDialog`, `Badge`, and `Button`. No backend/API changes.

**Tech Stack:** React 19, TypeScript, Vite, Vitest + @testing-library/react + user-event, Tailwind (mono/brutalist tokens already in the codebase), lucide-react icons, Nx monorepo.

**Spec:** `docs/superpowers/specs/2026-06-02-profiles-table-layout-design.md`

**Test command (whole web suite):** `npx nx test web`

---

## File Structure

- Create: `apps/web/src/components/profile-nav.tsx` — sidebar nav, Profiles item + count.
- Create: `apps/web/src/components/profile-nav.spec.tsx` — tests for nav.
- Create: `apps/web/src/components/profile-table.tsx` — table of profiles + inline actions.
- Create: `apps/web/src/components/profile-table.spec.tsx` — tests for table.
- Modify: `apps/web/src/app.tsx` — new two-region layout, drop `selectedId`.
- Delete: `apps/web/src/components/profile-tabs.tsx`
- Delete: `apps/web/src/components/profile-list.tsx`
- Delete: `apps/web/src/components/profile-detail.tsx`
- Delete: `apps/web/src/components/profile-sidebar.tsx`
- Delete: `apps/web/src/components/profile-detail.spec.tsx`
- Delete: `apps/web/src/components/profile-sidebar.spec.tsx`

(`profile-list.spec.tsx` is already deleted in the working tree.)

Reference — the `Profile` type fields used: `id`, `label`, `proxy` (`string | null`), `status` (`'idle' | 'authenticating'`), `lastLoginAt` (`string | null`), `createdAt`, `updatedAt`.

---

## Task 1: ProfileNav component

**Files:**
- Create: `apps/web/src/components/profile-nav.tsx`
- Test: `apps/web/src/components/profile-nav.spec.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/profile-nav.spec.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProfileNav } from './profile-nav';

describe('ProfileNav', () => {
  it('renders the Profiles nav item', () => {
    render(<ProfileNav count={0} />);
    expect(screen.getByText('Profiles')).toBeInTheDocument();
  });

  it('renders the profile count (singular)', () => {
    render(<ProfileNav count={1} />);
    expect(screen.getByText('1 profile')).toBeInTheDocument();
  });

  it('renders the profile count (plural)', () => {
    render(<ProfileNav count={3} />);
    expect(screen.getByText('3 profiles')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test web`
Expected: FAIL — cannot resolve `./profile-nav`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/components/profile-nav.tsx`:

```tsx
export function ProfileNav({ count }: { count: number }) {
  return (
    <aside
      className="flex h-screen w-56 shrink-0 flex-col border-r-2 border-foreground bg-background"
      aria-label="Sections"
    >
      <div className="border-b-2 border-foreground px-5 py-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Socmint
        </p>
      </div>

      <nav className="flex-1 py-2">
        <a
          href="#profiles"
          aria-current="page"
          className="block border-b border-border-light bg-foreground px-5 py-4 font-mono text-xs uppercase tracking-widest text-background"
        >
          Profiles
        </a>
      </nav>

      <div className="border-t-2 border-foreground px-5 py-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {count} profile{count === 1 ? '' : 's'}
        </p>
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test web`
Expected: PASS for the 3 ProfileNav tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/profile-nav.tsx apps/web/src/components/profile-nav.spec.tsx
git commit -m "feat(web): add ProfileNav sidebar"
```

---

## Task 2: ProfileTable component

**Files:**
- Create: `apps/web/src/components/profile-table.tsx`
- Test: `apps/web/src/components/profile-table.spec.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/profile-table.spec.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileTable } from './profile-table';
import type { Profile } from '../api/client';

const profiles: Profile[] = [
  {
    id: 'p1',
    label: 'inv-01',
    proxy: null,
    status: 'idle',
    lastLoginAt: '2026-06-02T00:00:00.000Z',
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'p2',
    label: 'inv-02',
    proxy: 'http://host:8080',
    status: 'authenticating',
    lastLoginAt: null,
    createdAt: '',
    updatedAt: '',
  },
];

describe('ProfileTable', () => {
  it('renders a row per profile', () => {
    render(<ProfileTable profiles={profiles} onLogin={() => {}} onDelete={() => {}} />);
    expect(screen.getByText('inv-01')).toBeInTheDocument();
    expect(screen.getByText('inv-02')).toBeInTheDocument();
  });

  it('shows a blinking opening state for an authenticating profile', () => {
    render(<ProfileTable profiles={profiles} onLogin={() => {}} onDelete={() => {}} />);
    expect(screen.getByText(/opening/i)).toBeInTheDocument();
  });

  it('shows an empty state when there are no profiles', () => {
    render(<ProfileTable profiles={[]} onLogin={() => {}} onDelete={() => {}} />);
    expect(screen.getByText(/no profiles yet/i)).toBeInTheDocument();
  });

  it('calls onLogin with the profile id when Open login is clicked', async () => {
    const onLogin = vi.fn();
    render(<ProfileTable profiles={profiles} onLogin={onLogin} onDelete={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /open login/i }));
    expect(onLogin).toHaveBeenCalledWith('p1');
  });

  it('calls onDelete with the profile id when Delete is clicked', async () => {
    const onDelete = vi.fn();
    render(<ProfileTable profiles={profiles} onLogin={() => {}} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledWith('p1');
  });

  it('disables actions for an authenticating profile', () => {
    render(<ProfileTable profiles={profiles} onLogin={() => {}} onDelete={() => {}} />);
    // p2 (inv-02) is authenticating; its two buttons are the 2nd login + 2nd delete.
    const loginButtons = screen.getAllByRole('button', { name: /open login/i });
    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    expect(loginButtons[1]).toBeDisabled();
    expect(deleteButtons[1]).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test web`
Expected: FAIL — cannot resolve `./profile-table`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/components/profile-table.tsx`:

```tsx
import { LogIn, Trash2 } from 'lucide-react';
import type { Profile } from '../api/client';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

function formatDate(iso: string | null): string {
  return iso ? iso.replace('T', ' ').slice(0, 19) : '—';
}

const HEADERS = ['Label', 'Status', 'Last login', 'Proxy', 'ID', 'Actions'];

export function ProfileTable({
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
      <p className="px-2 py-12 font-mono text-xs uppercase tracking-widest text-muted-foreground">
        No profiles yet. Create one to open a browser for login.
      </p>
    );
  }

  return (
    <table className="w-full border-collapse text-left" aria-label="Profiles">
      <thead>
        <tr className="border-b-2 border-foreground">
          {HEADERS.map((h) => (
            <th
              key={h}
              className="px-4 py-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground"
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {profiles.map((p) => {
          const busy = p.status === 'authenticating';
          return (
            <tr key={p.id} className="border-b border-border-light align-middle">
              <td className="px-4 py-4 font-serif text-base">{p.label}</td>
              <td className="px-4 py-4">
                {busy ? (
                  <span className="animate-mono-blink font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Opening…
                  </span>
                ) : (
                  <Badge>Idle</Badge>
                )}
              </td>
              <td className="px-4 py-4 font-mono text-xs">{formatDate(p.lastLoginAt)}</td>
              <td className="px-4 py-4 break-all font-mono text-xs">{p.proxy ?? '—'}</td>
              <td className="px-4 py-4 break-all font-mono text-[10px] text-muted-foreground">
                {p.id}
              </td>
              <td className="px-4 py-4">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() => onLogin(p.id)}
                    className="gap-2"
                  >
                    <LogIn size={16} strokeWidth={1.5} />
                    Open login
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => onDelete(p.id)}
                    className="gap-2"
                  >
                    <Trash2 size={16} strokeWidth={1.5} />
                    Delete
                  </Button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test web`
Expected: PASS for all ProfileTable tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/profile-table.tsx apps/web/src/components/profile-table.spec.tsx
git commit -m "feat(web): add ProfileTable with inline actions"
```

---

## Task 3: Rewire app.tsx and remove old components

**Files:**
- Modify: `apps/web/src/app.tsx`
- Delete: `apps/web/src/components/profile-tabs.tsx`, `profile-list.tsx`, `profile-detail.tsx`, `profile-sidebar.tsx`, `profile-detail.spec.tsx`, `profile-sidebar.spec.tsx`

- [ ] **Step 1: Replace `app.tsx` contents**

Overwrite `apps/web/src/app.tsx` with:

```tsx
import { Plus } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { api } from './api/client';
import { useProfiles } from './hooks/use-profiles';
import { ProfileNav } from './components/profile-nav';
import { ProfileTable } from './components/profile-table';
import { CreateProfileDialog } from './components/create-profile-dialog';

export function App() {
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
    <div className="flex min-h-screen">
      <ProfileNav count={profiles.length} />

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b-2 border-foreground px-8 py-6 lg:px-10">
          <div>
            <h1 className="font-display text-3xl tracking-tight">Profiles</h1>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              CloakBrowser · session capture · local
            </p>
          </div>
          <CreateProfileDialog
            onCreate={handleCreate}
            triggerLabel="New profile"
            triggerClassName="gap-2"
            triggerIcon={<Plus size={16} strokeWidth={1.5} />}
          />
        </header>

        {error && (
          <p className="mx-8 mt-4 shrink-0 border-2 border-foreground bg-foreground px-4 py-3 font-mono text-xs uppercase tracking-widest text-background lg:mx-10">
            {error}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-auto px-8 py-6 lg:px-10">
          <ProfileTable profiles={profiles} onLogin={handleLogin} onDelete={handleDelete} />
        </div>
      </main>

      <Toaster
        position="bottom-right"
        toastOptions={{
          unstyled: true,
          classNames: {
            toast:
              'border-2 border-foreground bg-background px-4 py-3 font-mono text-xs uppercase tracking-widest text-foreground',
            error:
              'border-2 border-foreground bg-foreground px-4 py-3 font-mono text-xs uppercase tracking-widest text-background',
          },
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Delete the superseded files**

```bash
git rm apps/web/src/components/profile-tabs.tsx \
       apps/web/src/components/profile-list.tsx \
       apps/web/src/components/profile-detail.tsx \
       apps/web/src/components/profile-sidebar.tsx \
       apps/web/src/components/profile-detail.spec.tsx \
       apps/web/src/components/profile-sidebar.spec.tsx
```

Note: some of these are untracked (`??`) — for those, `git rm` will report "did not match"; delete them directly instead, e.g. `rm apps/web/src/components/profile-sidebar.tsx`. Goal: none of the six files remain on disk.

- [ ] **Step 3: Verify no stale imports remain**

Run (Grep tool or rg): search `apps/web/src` for `profile-tabs`, `profile-list`, `profile-detail`, `profile-sidebar`, `ProfileTabs`, `ProfileList`, `ProfileDetail`, `ProfileSidebar`.
Expected: zero matches.

- [ ] **Step 4: Run the full web suite + build typecheck**

Run: `npx nx test web`
Expected: PASS (only `profile-nav.spec.tsx` and `profile-table.spec.tsx` plus any other existing specs).

Run: `npx nx build web`
Expected: builds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add -A apps/web/src
git commit -m "feat(web): switch to sidebar nav + profile table layout"
```

---

## Task 4: Manual visual check

- [ ] **Step 1: Run the dev server and eyeball the layout**

Run: `npx nx serve web` (opens on http://127.0.0.1:4200).
Confirm: left sidebar shows "Socmint" + active "Profiles" + count footer; main area shows the header with a working "New profile" dialog and a table with one row per profile; status column shows `Idle` / blinking `Opening…`; `Open login` and `Delete` buttons act on the right row and are disabled while a profile is authenticating; empty state appears when there are no profiles.

- [ ] **Step 2: Stop the server**

No commit (verification only).

---

## Self-Review

- **Spec coverage:** ProfileNav (Task 1) ✓ sidebar + single Profiles item + count. ProfileTable (Task 2) ✓ table columns Label/Status/Last login/Proxy/ID/Actions + inline Open login/Delete + status badge/blink + empty state. Header + CreateProfileDialog reuse + app.tsx restructure + drop selectedId (Task 3) ✓. Cleanup of four components + two specs (Task 3) ✓. Tests (Tasks 1–2) ✓.
- **Placeholders:** none — every code/command step is concrete.
- **Type consistency:** `ProfileTable` / `ProfileNav` prop names (`profiles`, `onLogin`, `onDelete`, `count`) match across the test, implementation, and `app.tsx` usage. `Profile` fields match `api/client`. `Button` `variant="outline"` and `disabled` match existing usage in the deleted `ProfileDetail`.
