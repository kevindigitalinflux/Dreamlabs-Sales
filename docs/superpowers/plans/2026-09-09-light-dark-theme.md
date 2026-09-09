# Light/Dark Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real light/dark theme toggle to the app — light is the default, brand-palette-only, with the Sidebar/mobile nav staying visually identical in both themes and the choice persisted per-account.

**Architecture:** A `[data-theme]` attribute on `<html>` drives a CSS custom-property swap (Tailwind v4's `@theme` block already generates every color utility class from these properties, so ~40+ existing files need zero changes). A dedicated, permanently-dark `nav-*` token set keeps the Sidebar/mobile nav theme-invariant. A `ThemeProvider` (mirroring the existing `useFocusMode` pattern) is scoped to `AppShell` only — never wraps Login/Welcome — so unauthenticated pages always render light. The 3 recharts-based analytics components read `useTheme()` directly since SVG chart libraries can't resolve Tailwind classes.

**Tech Stack:** React 18 + TypeScript, Tailwind CSS v4 (`@theme` directive), Supabase (Postgres + RLS), recharts.

**Spec:** `docs/superpowers/specs/2026-09-09-light-dark-theme-design.md` (read this in full — §1 explains the Sidebar/MobileNav token-sharing problem this plan's Task 5 fixes, §3 has the exact `useTheme` state machine and the `ThemeProvider` placement reasoning, §4 explains why light becomes the *base* `@theme` definition rather than the *override* — this plan's Task 2 implements that inversion deliberately, do not "fix" it back).

## Global Constraints

- No `any` — cast to `unknown` first if needed. Strict TypeScript throughout.
- Named exports only, no default exports.
- Tailwind utility classes only — no custom CSS or inline styles (the two recharts wrapper components are the existing, already-established exception, since recharts needs literal color values, not Tailwind classes).
- Brand-palette-only: no new arbitrary colors besides the one agreed addition (`#FFFFFF` for card surfaces in light mode). The 5 accent colors (navy, violet, purple, magenta, cyan) are identical in both themes.
- The Sidebar and `MobileNav` must render pixel-identical in both themes — this is the one piece of chrome that never changes.
- `ThemeProvider` must be scoped to `AppShell` only, never wrapping `/login`, `/welcome`, `/auth/callback`, or `/unsubscribe/:leadId` — those routes always render light with no theme JS running at all.
- Light is the default theme.

---

### Task 1: `profiles.theme_preference` migration + type update

**Files:**
- Create: `supabase/migrations/015_theme_preference.sql`
- Modify: `src/types/index.ts:22-30` (the `Profile` interface)

**Interfaces:**
- Consumes: nothing new.
- Produces: `profiles.theme_preference` column (`TEXT`, `CHECK IN ('light','dark')`, `DEFAULT 'light'`, `NOT NULL`); `Profile.theme_preference: 'light' | 'dark'` in the TypeScript type. Task 3's `ThemeProvider` reads this field directly off `useAuth().profile`.

- [ ] **Step 1: Write the migration**

```sql
-- Per-account theme preference. Defaults to 'light' (this app's default theme).
ALTER TABLE profiles ADD COLUMN theme_preference TEXT NOT NULL DEFAULT 'light'
  CHECK (theme_preference IN ('light', 'dark'));
```

- [ ] **Step 2: Apply the migration to the live Supabase project**

Use `mcp__plugin_supabase_supabase__apply_migration` (name: `theme_preference`, project_id `wgomksxelyfkzepbnkdd`), or `supabase db push` — whichever this repo's other migrations were applied with (check `013_calling_integration.sql`'s application method for precedent if unsure).

- [ ] **Step 3: Verify**

Query `information_schema.columns` to confirm `profiles.theme_preference` exists with `is_nullable = 'NO'` and `column_default = 'light'::text`, and confirm the CHECK constraint exists via `information_schema.check_constraints` or `pg_constraint`.

- [ ] **Step 4: Update the TypeScript type**

In `src/types/index.ts`, change the `Profile` interface:

```typescript
export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  platform_role: PlatformRole;
  avatar_url: string | null;
  theme_preference: 'light' | 'dark';
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (no existing code constructs a `Profile` object literal that would now be missing a required field — `useAuth.tsx` fetches via `select('*')` and casts, so the new field arrives automatically).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/015_theme_preference.sql src/types/index.ts
git commit -m "feat: add profiles.theme_preference column"
```

---

### Task 2: `index.css` palette restructure

**Files:**
- Modify: `src/index.css` (full rewrite of the `@theme` block and the addition of a dark-mode override block)

**Interfaces:**
- Consumes: nothing.
- Produces: the `bg-nav-text`/`text-nav-text`/`text-nav-muted`/`border-nav-line`/`bg-nav-hover` Tailwind utility classes (auto-generated by Tailwind v4 from the new `--color-nav-*` custom properties) that Task 5 uses; the light-mode-as-base / `[data-theme="dark"]`-as-override CSS structure that Task 3's `ThemeProvider` and Task 4's toggle rely on.

- [ ] **Step 1: Rewrite `src/index.css`**

```css
@import "tailwindcss";

@theme {
  /* Accent colors — identical in both themes (this is also what keeps the sidebar's
     bg-navy background correct in both themes, with no special handling needed). */
  --color-navy: #040F49;
  --color-violet: #8B32FF;
  --color-purple: #64378B;
  --color-magenta: #F0386B;
  --color-cyan: #00DFDF;

  /* Page-content neutrals. LIGHT values are the base/default here — light is this
     app's default theme, and unauthenticated pages (which never mount ThemeProvider)
     must render correctly with no [data-theme] attribute present at all. Dark mode
     is the override, defined below under [data-theme="dark"] — this is an intentional
     inversion of the pre-theming file's dark-as-base structure, not an oversight.
     Brand-palette-only: offwhite/navy are the app's existing documented brand
     tokens, swapping which role they play; #FFFFFF is the one agreed non-brand
     addition, used only for card surfaces so they read as distinct from the page
     background. */
  --color-offwhite: #040F49;
  --color-bg: #F4F4F8;
  --color-card: #FFFFFF;
  --color-surface: rgba(4, 15, 73, 0.04);
  --color-muted: rgba(4, 15, 73, 0.55);
  --color-line: rgba(4, 15, 73, 0.10);

  /* Nav chrome (Sidebar, MobileNav): permanently dark regardless of theme, locked to
     this app's original dark-mode neutral values. Never redefined under
     [data-theme="dark"] below — these four are the same in both themes, always. */
  --color-nav-text: #F4F4F8;
  --color-nav-muted: rgba(244, 244, 248, 0.55);
  --color-nav-line: rgba(255, 255, 255, 0.08);
  --color-nav-hover: #1A2575;

  --font-heading: "Montserrat", ui-sans-serif, system-ui, sans-serif;
  --font-body: "DM Sans", ui-sans-serif, system-ui, sans-serif;
}

/* Dark mode override — only the page-content neutrals change; accents and nav-*
   tokens above are untouched here. */
:root[data-theme="dark"] {
  --color-offwhite: #F4F4F8;
  --color-bg: #09102E;
  --color-card: #111C6A;
  --color-surface: #1A2575;
  --color-muted: rgba(244, 244, 248, 0.55);
  --color-line: rgba(255, 255, 255, 0.08);
}

@layer base {
  body {
    @apply bg-bg font-body text-offwhite;
    font-size: 16px;
    line-height: 1.6;
    letter-spacing: 0.02em;
  }
  h1, h2, h3, h4 {
    @apply font-heading;
    line-height: 1.25;
  }
}

/* Right slide-in for the lead panel (referenced as animate-[slidein_...]). */
@keyframes slidein {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}
```

- [ ] **Step 2: Type-check and build**

Run: `npx tsc --noEmit` (expected clean — this is a CSS-only change) and `npm run build` (expected to succeed; this confirms Tailwind's v4 build pipeline accepts the new `@theme` block and the `:root[data-theme="dark"]` override without error).

- [ ] **Step 3: Manual visual spot-check**

This task alone has no way to toggle themes yet (Task 3/4 add that) — but you can confirm the *default* (no `data-theme` attribute) now renders light instead of dark by starting the dev server and loading any page: the background should now be off-white/`#F4F4F8` with dark navy text, not the previous dark navy background. This is expected and correct — later tasks add the toggle back to dark. Do not treat this as a regression to fix; it's this task's actual, intended effect (the whole app has no way to switch back to dark until Task 3/4 land).

- [ ] **Step 4: Commit**

```bash
git add src/index.css
git commit -m "feat: restructure theme tokens — light as base, dark as override, add nav-* tokens"
```

---

### Task 3: `useTheme` hook

**Files:**
- Create: `src/hooks/useTheme.tsx`

**Interfaces:**
- Consumes: `useAuth` (`./useAuth`, `profile: Profile | null` where `Profile.theme_preference: 'light' | 'dark'` per Task 1); `supabase` client.
- Produces: `Theme` type (`'light' | 'dark'`), `ThemeProvider({ children })`, `useTheme(): { theme: Theme; toggle: () => void }` — Task 4's `ThemeToggle` and Task 6's chart components both call `useTheme()` by this exact name/shape.

- [ ] **Step 1: Write the hook**

Create `src/hooks/useTheme.tsx`:

```tsx
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

export type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Light/dark theme. Seeded from localStorage on first render (fast, avoids a flash
 * of the wrong theme before the account's profile loads), then reconciled once with
 * the account's saved `theme_preference` when it becomes available. Every toggle
 * writes to both localStorage and the profiles table.
 *
 * Scoped to AppShell only (see AppShell.tsx) — never wraps unauthenticated routes,
 * so Login/Welcome always render light with no theme JS running at all.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('theme') === 'dark' ? 'dark' : 'light'));

  useEffect(() => {
    const pref = profile?.theme_preference;
    if (!pref) return;
    setTheme((current) => {
      if (pref === current) return current;
      localStorage.setItem('theme', pref);
      return pref;
    });
  }, [profile?.theme_preference]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'light' ? 'dark' : 'light';
      localStorage.setItem('theme', next);
      if (profile) void supabase.from('profiles').update({ theme_preference: next }).eq('id', profile.id);
      return next;
    });
  }, [profile]);

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

/** Access theme state; must be used inside ThemeProvider. */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification (deferred to Task 4)**

This hook has no UI of its own — nothing calls `ThemeProvider`/`useTheme` yet. Verification happens once Task 4 wires it into `AppShell` and adds the visible toggle.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useTheme.tsx
git commit -m "feat: add useTheme hook (localStorage-seeded, account-reconciled)"
```

---

### Task 4: `ThemeToggle` component + wire into `TopBar`/`AppShell`

**Files:**
- Create: `src/components/layout/ThemeToggle.tsx`
- Modify: `src/components/layout/TopBar.tsx`
- Modify: `src/components/layout/AppShell.tsx`

**Interfaces:**
- Consumes: `useTheme` from `../../hooks/useTheme` (Task 3).
- Produces: `ThemeToggle()`, a named export rendered by `TopBar`. `AppShell` now wraps its return value in `ThemeProvider`, making `useTheme()` available to everything it renders (including, transitively, every page rendered through its `<Outlet />`).

- [ ] **Step 1: Write the toggle component**

Create `src/components/layout/ThemeToggle.tsx`:

```tsx
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme';

/** Light/dark segmented toggle — both options always visible, matching the Analytics period-toggle pattern (docs/superpowers/specs/2026-09-09-light-dark-theme-design.md). */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <div role="group" aria-label="Theme" className="flex items-center gap-1 rounded-lg border border-line p-1">
      <button
        type="button"
        onClick={() => theme !== 'light' && toggle()}
        aria-pressed={theme === 'light'}
        aria-label="Light mode"
        className={`flex min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-md ${theme === 'light' ? 'bg-violet text-offwhite' : 'text-muted hover:text-offwhite'}`}
      >
        <Sun className="h-4 w-4" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => theme !== 'dark' && toggle()}
        aria-pressed={theme === 'dark'}
        aria-label="Dark mode"
        className={`flex min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-md ${theme === 'dark' ? 'bg-violet text-offwhite' : 'text-muted hover:text-offwhite'}`}
      >
        <Moon className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into TopBar**

In `src/components/layout/TopBar.tsx`, add the import:

```typescript
import { ThemeToggle } from './ThemeToggle';
```

And render it — insert immediately before the `<OrgSwitcher />` line:

```tsx
      <ThemeToggle />
      <OrgSwitcher />
```

- [ ] **Step 3: Wrap `AppShell` in `ThemeProvider`**

In `src/components/layout/AppShell.tsx`, add the import:

```typescript
import { ThemeProvider } from '../../hooks/useTheme';
```

And wrap the existing returned JSX (do not change anything else in this file — `focusMode`, `Sidebar`, `TopBar`, `MobileNav`, the `<Outlet />` all stay exactly as they are, just nested one level deeper):

```tsx
export function AppShell() {
  const { focusMode } = useFocusMode();
  return (
    <ThemeProvider>
      <div className="flex min-h-screen">
        {!focusMode && <Sidebar />}
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main className="flex-1 p-4 pb-20 md:p-6 md:pb-6">
            <Outlet />
          </main>
        </div>
        {!focusMode && <MobileNav />}
      </div>
    </ThemeProvider>
  );
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual browser verification (do this yourself if you're a subagent implementer — deferred to the controller if this environment's sandbox blocks outbound network calls, matching prior tasks in this project's history)**

Start the dev server, sign in, and confirm: the top bar shows a Sun/Moon segmented toggle next to the Focus button; clicking Moon switches the whole page to dark (background, cards, text all flip); clicking Sun switches back to light; the currently-active option is visually highlighted and the other is not; reloading the page after toggling to dark keeps it dark (persistence). Confirm `/login` (sign out first) still renders light regardless of what you last toggled to.

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/ThemeToggle.tsx src/components/layout/TopBar.tsx src/components/layout/AppShell.tsx
git commit -m "feat: add theme toggle to the top bar, wire ThemeProvider into AppShell"
```

---

### Task 5: Sidebar/MobileNav theme-invariance fix

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/components/layout/MobileNav.tsx`

**Interfaces:**
- Consumes: the `nav-*` Tailwind utility classes from Task 2 (`text-nav-text`, `text-nav-muted`, `border-nav-line`, `bg-nav-hover`).
- Produces: nothing new — this task only swaps existing class names, no new exports.

This is the fix for the problem identified in the spec's §1: both files currently use the *shared* `text-offwhite`/`text-muted`/`border-line`/`bg-surface` tokens, which now change value between themes (per Task 2) — without this fix, the sidebar's own text would go dark-on-dark in light mode.

- [ ] **Step 1: Fix `Sidebar.tsx`**

In `src/components/layout/Sidebar.tsx`, make these exact replacements:

1. The `<aside>` element's `border-line` → `border-nav-line` (its `bg-navy/40` stays unchanged — `navy` is a constant accent):

```tsx
    <aside className="hidden w-56 shrink-0 flex-col border-r border-nav-line bg-navy/40 p-4 md:flex">
```

2. The wordmark `<p>` currently has no explicit text-color class, so it inherits `body`'s `text-offwhite` — which now changes between themes. Add an explicit `text-nav-text` class so it stays locked to the dark nav color regardless of theme:

```tsx
      <p className="mb-8 px-2 font-heading text-lg font-extrabold text-nav-text">
        Dreamlabs<span className="text-cyan">Sales</span>
      </p>
```

3. The `navClass` function currently reads:

```typescript
function navClass({ isActive }: { isActive: boolean }): string {
  return `flex min-h-11 items-center gap-3 rounded-lg px-3 text-[15px] font-semibold transition-colors motion-reduce:transition-none ${
    isActive ? 'bg-violet/20 text-offwhite' : 'text-muted hover:bg-surface hover:text-offwhite'
  }`;
}
```

Change it to:

```typescript
function navClass({ isActive }: { isActive: boolean }): string {
  return `flex min-h-11 items-center gap-3 rounded-lg px-3 text-[15px] font-semibold transition-colors motion-reduce:transition-none ${
    isActive ? 'bg-violet/20 text-nav-text' : 'text-nav-muted hover:bg-nav-hover hover:text-nav-text'
  }`;
}
```

Nothing else in this file changes — `bg-violet/20`, `text-cyan` (used for the "Sales" span and nowhere else needing a fix), the `<img>` logo, `NAV_ITEMS`, and the admin-only `NavLink` (which uses the same `navClass` function, so it's fixed automatically) are all untouched.

- [ ] **Step 2: Fix `MobileNav.tsx`**

In `src/components/layout/MobileNav.tsx`, make these exact replacements:

1. The `<nav>` element's `border-line` → `border-nav-line` (`bg-navy/95` stays unchanged):

```tsx
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-nav-line bg-navy/95 backdrop-blur md:hidden"
```

2. The `NavLink` className function's inactive-state `text-muted` → `text-nav-muted` (the active state's `text-cyan` is a constant accent, unchanged):

```tsx
          className={({ isActive }) =>
            `flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-semibold ${
              isActive ? 'text-cyan' : 'text-nav-muted'
            }`
          }
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (these are className string changes only).

- [ ] **Step 4: Manual browser verification**

With the dev server running and signed in, toggle to light mode and confirm the Sidebar and mobile bottom nav (resize the browser to a narrow/mobile width to see it) look **exactly** as they did before this whole plan started — dark navy background, off-white text, no visible change at all — while the rest of the page (top bar, page content) is now light. Toggle back to dark and confirm the sidebar still looks correct there too (it should, since these tokens never change).

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/Sidebar.tsx src/components/layout/MobileNav.tsx
git commit -m "fix: lock Sidebar/MobileNav to permanently-dark nav-* tokens"
```

---

### Task 6: Theme-aware analytics charts

**Files:**
- Create: `src/components/analytics/chartColors.ts`
- Modify: `src/components/analytics/BarChart.tsx`
- Modify: `src/components/analytics/DonutChart.tsx`

**Interfaces:**
- Consumes: `useTheme` from `../../hooks/useTheme` (Task 3).
- Produces: `ChartNeutrals` interface and `chartNeutralsFor(theme: Theme): ChartNeutrals` — used only by `BarChart.tsx`/`DonutChart.tsx` in this task, not exported further.

Recharts renders literal SVG attributes and cannot resolve Tailwind classes or `var()` CSS custom properties the way regular DOM elements can reliably across all recharts internals — this is why these two files already hardcode real hex/rgba values (established in the analytics build, not new to this plan). The 3 brand *accent* colors used elsewhere in the analytics feature (`#00DFDF`, `#8B32FF`, `#F0386B` passed as `color` props from `PipelineSection.tsx`) do NOT need to change — accents are identical in both themes, per this plan's Global Constraints. Only the *neutral* values hardcoded directly inside `BarChart.tsx`/`DonutChart.tsx` (gridlines, axis-tick text, tooltip background/border/text, hover cursor) need a light-mode equivalent.

- [ ] **Step 1: Write the shared neutrals module**

Create `src/components/analytics/chartColors.ts`:

```typescript
import type { Theme } from '../../hooks/useTheme';

export interface ChartNeutrals {
  grid: string;
  tick: string;
  cursor: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
}

const DARK: ChartNeutrals = {
  grid: 'rgba(255,255,255,0.08)',
  tick: 'rgba(244,244,248,0.55)',
  cursor: 'rgba(255,255,255,0.04)',
  tooltipBg: '#111C6A',
  tooltipBorder: 'rgba(255,255,255,0.08)',
  tooltipText: '#F4F4F8',
};

const LIGHT: ChartNeutrals = {
  grid: 'rgba(4,15,73,0.10)',
  tick: 'rgba(4,15,73,0.55)',
  cursor: 'rgba(4,15,73,0.04)',
  tooltipBg: '#FFFFFF',
  tooltipBorder: 'rgba(4,15,73,0.10)',
  tooltipText: '#040F49',
};

/** The recharts-specific neutral colors (gridlines, tooltips, axis ticks) for the given theme — matches index.css's light/dark neutral values exactly, since recharts can't read CSS custom properties. */
export function chartNeutralsFor(theme: Theme): ChartNeutrals {
  return theme === 'dark' ? DARK : LIGHT;
}
```

- [ ] **Step 2: Make `BarChart.tsx` theme-aware**

Replace the full contents of `src/components/analytics/BarChart.tsx`:

```tsx
import { Bar, BarChart as RechartsBarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useTheme } from '../../hooks/useTheme';
import { chartNeutralsFor } from './chartColors';

export interface ChartDatum {
  label: string;
  value: number;
}

/** Single-series bar chart. Accent colors match in both themes; neutrals (gridlines/ticks/tooltip) switch via chartNeutralsFor. */
export function BarChart({ data, color = '#00DFDF' }: { data: ChartDatum[]; color?: string }) {
  const { theme } = useTheme();
  const n = chartNeutralsFor(theme);
  return (
    <ResponsiveContainer width="100%" height={240}>
      <RechartsBarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={n.grid} vertical={false} />
        <XAxis dataKey="label" tick={{ fill: n.tick, fontSize: 12 }} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} tick={{ fill: n.tick, fontSize: 12 }} axisLine={false} tickLine={false} width={32} />
        <Tooltip
          cursor={{ fill: n.cursor }}
          contentStyle={{ background: n.tooltipBg, border: `1px solid ${n.tooltipBorder}`, borderRadius: 8, color: n.tooltipText }}
        />
        <Bar dataKey="value" fill={color} radius={[6, 6, 0, 0]} />
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 3: Make `DonutChart.tsx` theme-aware**

Replace the full contents of `src/components/analytics/DonutChart.tsx`:

```tsx
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useTheme } from '../../hooks/useTheme';
import { chartNeutralsFor } from './chartColors';
import type { ChartDatum } from './BarChart';

const DEFAULT_COLORS = ['#8B32FF', '#00DFDF', '#F0386B', '#64378B', '#F59E0B', '#22C55E', '#EF4444', '#94A3B8'];

/** Donut chart. Accent colors match in both themes; neutrals (tooltip/legend text) switch via chartNeutralsFor. */
export function DonutChart({ data, colors = DEFAULT_COLORS }: { data: ChartDatum[]; colors?: string[] }) {
  const { theme } = useTheme();
  const n = chartNeutralsFor(theme);
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="label" innerRadius={50} outerRadius={80} paddingAngle={2}>
          {data.map((_, i) => (
            <Cell key={i} fill={colors[i % colors.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={{ background: n.tooltipBg, border: `1px solid ${n.tooltipBorder}`, borderRadius: 8, color: n.tooltipText }} />
        <Legend wrapperStyle={{ fontSize: 12, color: n.tick }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: all pre-existing tests pass unchanged (this task touches no `lib/` pure functions, only presentational chart components with no dedicated tests, matching this codebase's established convention).

- [ ] **Step 6: Manual browser verification**

Navigate to `/analytics` in both themes. Confirm in light mode: bar chart gridlines and axis labels are visibly dark-on-light (not invisible white-on-white), the donut chart's tooltip and legend text are dark and readable, and hovering a bar/segment shows a correctly-styled tooltip (white background, dark text, subtle border) rather than the old dark tooltip floating on a light page.

- [ ] **Step 7: Commit**

```bash
git add src/components/analytics/chartColors.ts src/components/analytics/BarChart.tsx src/components/analytics/DonutChart.tsx
git commit -m "feat: make analytics chart neutrals theme-aware"
```

---

## Self-Review Notes (from writing this plan)

- **Spec coverage:** every section of the design spec has a task — §1 (Sidebar/MobileNav fix) → Task 5, §2 (palette) → Task 2, §3 (architecture, `useTheme` state machine, `ThemeProvider` placement) → Tasks 3-4, the chart color handling paragraph → Task 6, the migration → Task 1.
- **Placeholder scan:** no TBD/TODO; every step has complete, runnable code.
- **Type consistency:** `Theme`/`ThemeContextValue`/`useTheme()`'s return shape are defined once in Task 3 and consumed identically (destructuring `{ theme, toggle }` or just `{ theme }`) in Tasks 4 and 6. `Profile.theme_preference` is defined in Task 1 and consumed by name in Task 3. `ChartNeutrals`/`chartNeutralsFor` are defined in Task 6's own new file and consumed by the same task's other two file edits — no cross-task drift.
- **A known, deliberate one-render flash, not a bug to fix:** on first load of an authenticated page, `theme` starts from `localStorage` (Task 3) before `ThemeProvider`'s reconciliation effect can compare it against the account's real `profiles.theme_preference` (which requires `useAuth`'s own async profile fetch to resolve first). For a user whose account preference matches their last-used browser, this is invisible. For a user opening the app on a new device/browser (no matching localStorage) whose account preference is `dark`, there's a brief light-then-dark flash on that first load. This matches the spec's own accepted trade-off (§3, step 2) and isn't addressed further in this plan — flagging so it isn't mistaken for something to silently fix on your own initiative.
