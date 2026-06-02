# Profiles Table Layout — Design

Date: 2026-06-02
Status: Approved

## Goal

Restructure the web app (`apps/web`) layout into a dashboard shape: a left
navigation sidebar containing only a **Profiles** entry, and a main content
area showing all profiles in a multi-row **table** with inline action
functions. No new backend/API work — this is a UI restructure that reuses the
existing three functions (create profile, open login session, delete profile).

## Non-Goals

- No new profile functions (no edit label/proxy, no search/filter, no
  reopen-session). Keep exactly the existing three actions.
- No master-detail panel, no detail drawer, no per-profile detail view. All
  fields shown inline in the table.
- No backend / API changes.

## Layout

```
┌────────────┬─────────────────────────────────────────────────┐
│ ProfileNav │  Profiles                          [+ New]       │
│            │  CloakBrowser · session capture · local          │
│  ▣ Socmint ├──────┬────────┬───────────┬────────┬─────────────┤
│            │ Label│ Status │ Last login│ Proxy  │ Actions      │
│  ▸ Profiles├──────┼────────┼───────────┼────────┼─────────────┤
│            │ acc1 │ Idle   │ 06-01     │ —      │ login · del │
│            │ acc2 │ Auth…  │ 06-02     │ :8080  │ login · del │
│  N profiles│ acc3 │ Idle   │ 05-30     │ —      │ login · del │
└────────────┴──────┴────────┴───────────┴────────┴─────────────┘
```

Two regions: a fixed-width sidebar and a flexible main column. The current
narrow `ProfileTabs` rail, the `ProfileList` column, and the `ProfileDetail`
panel are all replaced.

## Components

### `ProfileNav` (replaces `profile-tabs.tsx`)
- Fixed-width sidebar (~`w-56`), full height, `border-r-2 border-foreground`.
- Top: "Socmint" logo/wordmark.
- Single nav item **Profiles**, rendered active (room to add more items later).
- Footer: profile count (`N profiles`).
- Keeps the existing mono / brutalist styling (mono font, uppercase tracking,
  `border-2 border-foreground`).
- Props: `{ count: number }` (or `profiles` for the count).

### `ProfileTable` + `ProfileRow` (replaces `profile-list.tsx` + `profile-detail.tsx`)
- Renders a table of all profiles. Columns:
  **Label · Status · Last login · Proxy · ID · Actions**.
- `Status`: a `Badge` showing `Idle`, or a blinking `Opening…` when
  `status === 'authenticating'` (reuse `animate-mono-blink`).
- `Actions`: two inline buttons per row — **Open login** and **Delete** —
  both disabled while the row is `authenticating`.
- Date formatting reuses the existing `formatDate` helper convention.
- Empty state when `profiles.length === 0`: a message prompting the user to
  create a profile (mono, uppercase, muted).
- Props: `{ profiles, onLogin, onDelete }`.

### Header (in main column)
- Title **Profiles** + the `CloakBrowser · session capture · local` caption.
- **New profile** button via the existing `CreateProfileDialog`
  (reused as-is, `Plus` icon trigger).

## `app.tsx` changes
- Remove the `selectedId` state and the `useEffect` that auto-selects the
  first profile (no selection / master-detail needed).
- Keep `useProfiles`, `handleCreate`, `handleLogin`, `handleDelete`, the error
  banner, and the `Toaster` exactly as they are.
- New root structure: `<div className="flex min-h-screen">` containing
  `<ProfileNav>` and a `<main>` column with header + `<ProfileTable>`.
- `handleCreate` keeps opening the login session for the newly created
  profile; it no longer needs to set a selected id.

## Cleanup
- Delete: `profile-tabs.tsx`, `profile-list.tsx`, `profile-detail.tsx`,
  `profile-sidebar.tsx` and their spec files
  (`profile-list.spec.tsx`, `profile-detail.spec.tsx`, `profile-sidebar.spec.tsx`).
- Add specs: `profile-nav.spec.tsx`, `profile-table.spec.tsx`.

## Testing
- `ProfileTable`: renders a row per profile; shows the empty state with no
  profiles; renders status badge vs. blinking `Opening…` based on `status`;
  `Open login` / `Delete` buttons call `onLogin` / `onDelete` with the right id
  and are disabled when `authenticating`.
- `ProfileNav`: renders the Profiles nav item and the profile count.

## Styling
Keep the established mono / brutalist visual language already in the codebase
(font-mono, uppercase tracking-widest, `border-2 border-foreground`,
`animate-mono-blink`, existing `Badge` / `Button` UI components). The Creathink
dashboard reference informs the *layout shape* (sidebar + main table), not the
color palette.
