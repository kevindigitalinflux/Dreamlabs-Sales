# Light/Dark Theme — Design Spec

## Context

The app is dark-mode-only today (`src/index.css`'s `@theme` block defines one fixed palette). Kevin wants a
light mode — mostly to reduce the "generic AI-generated SaaS" look a pure-dark UI can read as, and to improve
contrast — with dark mode kept as the alternative, not removed. This spec also covers a small, unrelated
piece of visual work bundled into the same session: adding the DI Dreamlabs logo icon above the sidebar
wordmark (already shipped, see `Sidebar.tsx` — noted here only for completeness, not part of this build).

## Decisions Locked (from brainstorming)

| Decision | Choice |
|---|---|
| Scope | A **real, full light theme** for all page content (cards, text, borders, buttons) — not just the outer page background. Off-white text on a light background would otherwise be illegible. |
| What never changes | The **Sidebar and mobile bottom nav** stay exactly as they look today, in both themes — this is the one piece of chrome that's theme-invariant. The **top bar** (Focus toggle, org switcher, avatar, sign out) is treated as page content and switches with the theme. |
| Toggle | A two-segment Sun/Moon pill in the top bar, mirroring the existing Analytics period-toggle's exact visual pattern (both options always visible, the active one highlighted) — not a single icon that swaps, so it's unambiguous which mode is active. |
| Default | **Light.** |
| Persistence | Per-account, via a new `profiles.theme_preference` column — follows the user across devices/browsers. Seeded from `localStorage` first on load (avoids a flash of the wrong theme before the account's `profiles` row loads), then reconciled once auth resolves. |
| Palette | **Brand-only.** No new arbitrary colors. Dark mode's neutrals (`bg`/`offwhite`) swap roles for light mode (the brand's existing off-white becomes the background; the brand's existing navy becomes the text color) rather than introducing invented hex values. The five brand accent colors (navy, violet, purple, magenta, cyan) are used identically in both themes — this is also what keeps the sidebar unaffected for free, since it uses `bg-navy` directly. One second light neutral (plain white, for card surfaces distinct from the off-white page background) was added by agreement — not a documented brand token, but the simplest, safest choice, swappable later if it doesn't feel right. |

## 1. The Sidebar/MobileNav Sharing Problem (and its fix)

A blanket global token swap doesn't work as-is: `Sidebar.tsx` and `MobileNav.tsx` currently use the *same*
shared tokens the rest of the app uses (`text-offwhite`, `text-muted`, `border-line`, `bg-surface` on hover)
— redefining those tokens for light mode would silently break the sidebar's own text into dark-on-dark.

**Fix:** three new, permanently-dark "nav chrome" tokens, added to `index.css`'s `@theme` block alongside the
existing ones, never redefined under `[data-theme="light"]`:

```css
--color-nav-text: #F4F4F8;              /* = current --color-offwhite value, locked */
--color-nav-muted: rgba(244, 244, 248, 0.55);   /* = current --color-muted value, locked */
--color-nav-line: rgba(255, 255, 255, 0.08);    /* = current --color-line value, locked */
```

Tailwind v4 auto-generates `text-nav-text`, `text-nav-muted`, `border-nav-line` utilities from these, the
same mechanism already generating `text-offwhite`/`text-muted`/`border-line`. `Sidebar.tsx` and
`MobileNav.tsx` swap their few uses of the shared tokens for these nav-specific ones; every other file in the
app is untouched. `bg-navy`/`bg-surface` (as used for the sidebar's own background/hover state) already work
correctly with no change, since `navy` is a constant accent and `surface`'s *dark-mode* value is what the
sidebar wants regardless of the active page theme — but `surface` itself DOES change for light mode (see
below), so the sidebar's hover state (`hover:bg-surface`) needs the same locked-token treatment. Add a fourth
token:

```css
--color-nav-hover: #1A2575;             /* = current --color-surface value, locked */
```

`Sidebar.tsx`'s nav-link hover state and `MobileNav`'s active/inactive text both move to these four `nav-*`
tokens. Nothing else in either file changes.

## 2. Palette

This table lists the VALUES only. The actual CSS selector structure (which set of values is the base
`@theme` definition vs. which is gated behind an attribute selector) is inverted from what this table's
column order might suggest — see §4, which governs the real mechanics and must be followed over any
assumption drawn from this table's left-to-right order.

| Token | Dark (unchanged) | Light (new) | Source |
|---|---|---|---|
| `--color-bg` | `#09102E` | `#F4F4F8` | existing brand offwhite, now used as background |
| `--color-card` | `#111C6A` | `#FFFFFF` | plain white — the one non-brand-token addition, by agreement |
| `--color-surface` | `#1A2575` | `rgba(4, 15, 73, 0.04)` | faint tint of brand navy |
| `--color-offwhite` | `#F4F4F8` | `#040F49` | existing brand navy, now used as primary text |
| `--color-muted` | `rgba(244,244,248,.55)` | `rgba(4,15,73,.55)` | brand navy at the same 55% opacity dark mode uses |
| `--color-line` | `rgba(255,255,255,.08)` | `rgba(4,15,73,.10)` | brand navy at low opacity (slightly higher than dark mode's 8%, since navy-on-white needs a touch more opacity to read at the same visual weight as white-on-navy) |
| `--color-navy`/`--color-violet`/`--color-purple`/`--color-magenta`/`--color-cyan` | unchanged | **unchanged** | accents stay identical in both themes |

`--color-offwhite` holding a dark color under `[data-theme="light"]` is a real naming mismatch (the token's
name describes its dark-mode value, not what it holds in light mode) — not worth a rename, since that would
mean touching every one of the ~40+ files that already use `text-offwhite`. A one-line comment in `index.css`
explains this rather than hiding it.

## 3. Architecture

```
src/index.css                     — @theme block gains the 4 nav-* tokens (always-dark) and a
                                     [data-theme="light"] block redefining bg/card/surface/offwhite/
                                     muted/line (never nav-*, never the 5 accent colors)
src/hooks/useTheme.tsx            — ThemeProvider + useTheme(), mirrors useFocusMode.tsx's exact
                                     shape: { theme: 'light' | 'dark', toggle: () => void }
src/components/layout/ThemeToggle.tsx — the Sun/Moon segmented pill, used only in TopBar.tsx
src/components/layout/TopBar.tsx  — renders <ThemeToggle /> next to the existing Focus button
src/components/layout/Sidebar.tsx — swaps text-offwhite/text-muted/border-line/hover:bg-surface
                                     for text-nav-text/text-nav-muted/border-nav-line/hover:bg-nav-hover
src/components/layout/MobileNav.tsx — same swap for its text-muted usage
supabase/migrations/0NN_theme_preference.sql — profiles.theme_preference column
src/components/analytics/BarChart.tsx, DonutChart.tsx, PipelineSection.tsx — theme-aware chart colors
```

### `useTheme` state machine

1. **Initial render:** read `localStorage.getItem('theme')`. If `'dark'`, start dark; anything else
   (including nothing stored) starts `'light'` — matching the locked default.
2. **Once `useAuth()`'s `profile` loads:** if `profile.theme_preference` differs from the current local
   state, adopt the account's value and update `localStorage` to match (the account is the source of truth
   once it's available — this only visibly changes anything for a user opening the app on a device/browser
   where they'd toggled differently before, or their first time on a new device).
   `theme_preference` is deliberately genuinely un-nullable in the profiles table (`DEFAULT 'light'`) so this
   step never needs to guess.
3. **On toggle:** flip the in-memory state immediately (instant UI response), write to `localStorage`
   immediately, and fire-and-forget a `supabase.from('profiles').update({ theme_preference })` call (no
   loading state needed for this — matches how `Settings.tsx`'s own profile-field save already works, and a
   failed write just means the next session falls back to the last-synced value, not a broken UI).
4. **Applying the theme:** a `useEffect` sets `document.documentElement.dataset.theme = theme` whenever
   `theme` changes (`'light'` or `'dark'` — always sets it explicitly, never removes the attribute, so there
   is no third "unset" state to account for in the CSS).

### `ThemeToggle` component

Two buttons in a bordered pill container, exactly matching `Analytics.tsx`'s period-toggle markup pattern:

```tsx
<div role="group" aria-label="Theme" className="flex items-center gap-1 rounded-lg border border-line p-1">
  <button aria-pressed={theme === 'light'} onClick={...}><Sun .../></button>
  <button aria-pressed={theme === 'dark'} onClick={...}><Moon .../></button>
</div>
```

The active button gets the same `bg-violet text-offwhite` highlight the period toggle uses; the inactive one
gets `text-muted hover:text-offwhite`.

### Chart color handling (`BarChart.tsx`, `DonutChart.tsx`, `PipelineSection.tsx`)

Recharts renders literal SVG attributes, so it cannot resolve Tailwind classes — the existing code already
hardcodes real hex/rgba values for this reason (established in the analytics build, not new to this spec).
Two kinds of hardcoded values exist there today:

- **Accent colors** (`#00DFDF`, `#8B32FF`, `#F0386B`, the `DEFAULT_COLORS` array in `DonutChart.tsx`) — these
  don't need to change, since accents are identical in both themes. No fix needed.
- **Neutral/grid values** (`rgba(255,255,255,0.08)` gridlines, `rgba(244,244,248,0.55)` axis-tick text,
  `#111C6A` tooltip background, `#F4F4F8` tooltip text) — these ARE dark-mode-specific and would be wrong
  (invisible or backwards) in light mode. Both chart components read `useTheme()` and select between two
  small constant objects (`DARK_CHART_COLORS`/`LIGHT_CHART_COLORS`) for exactly these neutral values, passed
  down to the relevant recharts sub-component props. This is the one place in the whole codebase where a
  component needs to be theme-*aware* in JS rather than just picking up the CSS swap for free.

### Unauthenticated pages, and exactly where `ThemeProvider` is placed

`Login.tsx`, `Welcome.tsx`, `AuthCallback.tsx`, `Unsubscribe.tsx` render before any `profiles` row is
loadable and must always render in light mode regardless of what an authenticated session previously set.
This requires a specific, deliberate placement decision, checked against `App.tsx`'s real current structure
(not assumed): today, `AuthProvider` → `FocusModeProvider` → `OrgProvider` all wrap the entire `<Routes>`
tree at the top of `App()`, including `/login`, `/welcome`, `/auth/callback`, and `/unsubscribe/:leadId` — so
mirroring `FocusModeProvider`'s placement exactly would leak a returning user's dark-mode `localStorage`
value onto their own login screen, contradicting the locked "unauthenticated pages always light" decision.

**`ThemeProvider` therefore does NOT go at that top level.** It wraps only `<AppShell />` — i.e., it mounts
for the first time inside `<Route element={<ProtectedRoute />}><Route element={<AppShell />}>`, after a user
is already authenticated. Every unauthenticated route never mounts a `ThemeProvider` at all, never reads
`localStorage`'s theme key, and never sets `document.documentElement.dataset.theme` — `<html>` simply has no
`data-theme` attribute for those pages, which resolves to the base (light) `@theme` values by construction
(see the CSS structure note below). This is a one-line placement difference from `FocusModeProvider`, not a
restructuring of the existing provider nesting.

## 4. CSS Structure Note (base = light, not base = dark)

Because light is the default and must render correctly even before `ThemeProvider` sets an explicit
attribute (unauthenticated pages, or a first paint before the effect runs), the **light values become the
base `@theme` definitions**, and dark mode is the one gated behind an attribute selector
(`[data-theme="dark"]`) — the reverse of how the current dark-only palette is structured today. This avoids
a flash-of-dark-then-light on every unauthenticated page load, at the cost of the diff touching every
existing dark value (moving it under a new selector) rather than only adding light ones. This is a deliberate
inversion, not an oversight — flag it clearly in the implementation plan so whoever builds it doesn't "fix"
it back to dark-as-base.

## Testing

- Manual verification (this app has no visual/snapshot test infrastructure): toggle between themes on
  Dashboard, Pipeline (Kanban + List), a lead detail page, Analytics (confirm both chart components render
  correctly in both themes, including tooltips/gridlines), and Settings. Confirm the sidebar and mobile nav
  are pixel-identical in both themes. Confirm an unauthenticated page (Login) renders light with no flash.
  Confirm toggling persists: reload the page, confirm the theme survives; sign out and back in, confirm it
  still holds (account-level persistence).
- No unit tests planned — this is CSS + a small stateful hook mirroring an already-untested existing pattern
  (`useFocusMode` has none either).

## Out of Scope

- Auto-following the OS/browser's `prefers-color-scheme` — explicit account-level toggle only, no system-
  preference detection, per the locked default decision (light is the default regardless of OS setting).
- Any other page/component redesign beyond what the token swap covers automatically — this is a palette
  change, not a broader visual refresh.
