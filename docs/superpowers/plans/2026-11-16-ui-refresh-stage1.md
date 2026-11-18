# Build brief: UI refresh stage 1 (Aurora look and new frame)

> **For the builder (Codex):** work task by task, in order. Steps use checkbox (`- [ ]`) syntax for tracking. Stop after Task 8's report. Nothing is pushed, merged or deployed.

**Goal:** Give every signed-in screen the approved Aurora look in one release, by changing the theme tokens, the shared building blocks and the app frame, with each screen's own layout left as it is.

**Architecture:** Values change in `src/index.css` under the existing token names, so existing classes pick up the new look; a few new tokens cover what the old set cannot express. Shared components in `src/components/ui/` are restyled in place with their props kept. The frame (`Sidebar`, `TopBar`, the jobs strip, `ReplyBanner`, `MobileNav`, `AppShell`) is rebuilt on three new shared pieces (`Popover`, `Collapsible`, `Tabs`). All decision logic lives in import-free modules with Vitest tests written first.

**Tech stack:** Vite, React 19, TypeScript strict, Tailwind v4 (`@theme` in `src/index.css`), `lucide-react`, Vitest. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-16-ui-refresh-design.md` (read it first). Approved mockup: `docs/superpowers/specs/assets/2026-11-16-ui-refresh-mockup.html` (open in a browser; it is the visual reference for anything this brief does not pin).

**Roles:** Kevin directs. Claude architect and reviewer. Codex builder. No role change.

## Setup

- Worktree: create `C:/Users/kevin/Projects/dreamlabs-sales-uistage1`, branch `codex/ui-refresh-stage1`, from `claude/ui-refresh-design` (it holds the spec, the mockup and this brief on top of `origin/main` `af22083`). Do not edit any other checkout.
- Gate environment: `VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=local-test-placeholder`.
- Gates, all five before every commit: `npx tsc --noEmit`, `npx vitest run`, `npm run build`, `git diff --check`, `node scripts/places-edge-typecheck.mjs`.
- Commits: `git -c core.hooksPath=NUL commit`, explicit paths only, never CRLF noise.

## Global constraints

- No feature, data, permission, RLS, edge function or database change. No migration. No new npm dependency.
- No file under `supabase/` changes. No file under `src/pages/` changes except the ones named in Tasks 4 and 7.
- Every existing prop and behaviour of a restyled shared component is kept. Callers do not change in Tasks 1 to 6.
- Brand colours only: `#8B32FF`, `#040F49`, `#64378B`, `#F0386B`, `#00DFDF`, `#F4F4F8`, plus `#FFFFFF` for light card surfaces, plus the derived text shades in Task 1. No neutral grey, no pure black. The existing stage colours stay.
- Magenta and cyan never sit in the same or adjacent elements.
- Every text colour measures at least 4.5:1 on the page base and on the raised surface, in both themes. Focus rings and control borders that carry meaning measure at least 3:1.
- Reading text is never below 14 px. 12 to 13 px only for counters, pills and short meta lines. No all-caps labels in new work. Sentence case.
- Corners: `rounded-control` (14 px) for buttons and fields, `rounded-surface` (16 px) for cards and panels, `rounded-nested` (12 px) for blocks inside a surface, `rounded-full` for pills. No other radius in files this brief touches.
- Motion only in answer to an action, 150 to 200 ms, and `motion-reduce:transition-none` on every transition. No entrance animations.
- `backdrop-blur` only on things that sit over content (popovers, dialogs, the lead record panel). Never on cards or rows.
- Project rules: named exports, components under 150 lines, JSDoc on exports, no `any`, every dropdown through `Listbox`, no bare `catch {}` around multi-step async work.
- The menu stays dark in both themes. Light stays the default theme. Signed-out pages render with no theme attribute and must keep their layout.

## Review focus

Each line is pinned by a test or check in the task named.

1. **Storage unavailable or holding junk** (private window, blocked site data): the menu opens expanded and still toggles for the session; nothing throws. Task 5 tests.
2. **Many job lines at once** (more than three needs-you, running and finished): the pill shows one line of text and its list holds every line, scrolls inside itself and never runs off the screen. Task 6 tests and Task 4 placement tests.
3. **Narrow or short window** (400 px wide, or a popover opened near the right or bottom edge): the panel stays fully on screen with an 8 px margin. Task 4 tests.
4. **Light theme on the dark menu**: active and hover items in the menu and the phone tab bar stay readable in light mode (the page link colour is dark violet there, so the menu must not use it). Task 1 token test and Task 8 contrast table.
5. **Signed-out pages**: Login, Forgot password, Reset password, Welcome, Unsubscribe and the auth callback keep their layout. Task 8 screenshots.

---

### Task 1: Theme tokens and the backdrop glow

**Files:**
- Modify: `src/index.css`
- Modify: `src/components/layout/AppShell.tsx` (backdrop layer only; the rest of the frame is Task 6)
- Create: `src/lib/ui/tokens.test.ts`

**Produces (class names later tasks use):** `bg-raised`, `text-link`, `text-attention`, `bg-attention-soft`, `outline-focus` / `border-focus`, `text-nav-active`, `shadow-raised`, `shadow-glow`, `rounded-control`, `rounded-surface`, `rounded-nested`.

- [ ] **Step 1: Write the failing test** `src/lib/ui/tokens.test.ts`. Read `src/index.css` as text (`node:fs`), split it into the `@theme { ... }` block and the `:root[data-theme="dark"] { ... }` block, and assert:
  - `@theme` defines every name in: `--color-raised`, `--color-link`, `--color-attention`, `--color-attention-soft`, `--color-focus`, `--color-nav-active`, `--shadow-raised`, `--shadow-glow`, `--radius-control`, `--radius-surface`, `--radius-nested`.
  - the dark block redefines `--color-raised`, `--color-link`, `--color-attention`, `--color-attention-soft`, `--color-focus`, `--shadow-raised`.
  - the dark block does NOT contain any `--color-nav-` name (the menu is locked).
  - `--radius-control: 14px`, `--radius-surface: 16px`, `--radius-nested: 12px`.
- [ ] **Step 2: Run** `npx vitest run src/lib/ui/tokens.test.ts`. Expected: FAIL (names missing).
- [ ] **Step 3: Update `src/index.css`.** Keep every existing token name. Values:

| Token | Light (in `@theme`) | Dark (override block) |
|---|---|---|
| `--color-bg` | `#F4F4F8` | `#040F49` |
| `--color-card` (opaque: sticky headers, dialogs, popovers) | `#FFFFFF` | `#121D54` |
| `--color-raised` (cards, fields, tiles; lets the glow through) | `#FFFFFF` | `rgba(244, 244, 248, 0.06)` |
| `--color-surface` (nested blocks, hover fills) | `rgba(4, 15, 73, 0.05)` | `rgba(244, 244, 248, 0.10)` |
| `--color-muted` | `rgba(4, 15, 73, 0.70)` | `rgba(244, 244, 248, 0.66)` |
| `--color-line` | `rgba(4, 15, 73, 0.12)` | `rgba(244, 244, 248, 0.12)` |
| `--color-link` | `#6A1FD6` | `#C9A6FF` |
| `--color-attention` | `#C21850` | `#FF7A9D` |
| `--color-attention-soft` | `rgba(240, 56, 107, 0.10)` | `rgba(240, 56, 107, 0.16)` |
| `--color-focus` | `#007474` | `#00DFDF` |
| `--shadow-raised` | `0 14px 32px -18px rgba(4, 15, 73, 0.28)` | `0 18px 40px -18px rgba(2, 6, 40, 0.55)` |

  Same in both themes (in `@theme` only): `--shadow-glow: 0 8px 24px -8px rgba(139, 50, 255, 0.55)`, the three radii, `--color-nav-bg: #030A36`, `--color-nav-hover: rgba(244, 244, 248, 0.08)`, `--color-nav-line: rgba(244, 244, 248, 0.10)`, `--color-nav-active: #C9A6FF`. Leave `--color-nav-text`, `--color-nav-muted`, `--color-on-accent`, `--color-violet-line`, the stage, danger, success and warning tokens, and the fonts as they are. Rewrite the comment above the accents: violet used as text now differs per theme (`--color-link`), and say why (one value cannot pass contrast on both bases).

  The hex text colours are starting points. Measure each against its base and against the raised surface; if one falls under 4.5:1, change lightness only, and record the final values in the report.
- [ ] **Step 4: Add the backdrop.** One class in `src/index.css`, outside `@theme`:

```css
/* Signed-in backdrop: two brand glows behind the whole app. Mounted once in AppShell. */
.app-backdrop {
  background:
    radial-gradient(60% 50% at 100% 0%, rgba(139, 50, 255, 0.16), transparent 70%),
    radial-gradient(55% 50% at 0% 100%, rgba(100, 55, 139, 0.14), transparent 70%);
}
:root[data-theme="dark"] .app-backdrop {
  background:
    radial-gradient(60% 50% at 100% 0%, rgba(139, 50, 255, 0.42), transparent 70%),
    radial-gradient(55% 50% at 0% 100%, rgba(100, 55, 139, 0.55), transparent 70%);
}
```

  In `AppShell`, render `<div aria-hidden className="app-backdrop pointer-events-none fixed inset-0" />` behind the content. How it is layered is yours to choose, with one rule: it must not create a stacking context that puts the body-level portals (`Listbox` panel, `Modal`) underneath app content. Compare the gradient positions with the mockup and adjust percentages if they visibly differ.
- [ ] **Step 5: Run the token test and all five gates.** Expected: PASS. Then `npm run dev`, open any screen in both themes: the page is navy with the glow in dark, off-white with a faint glow in light, and no dropdown or dialog is hidden behind content.
- [ ] **Step 6: Sweep opaque needs.** `--color-surface` is now see-through in dark. Grep `src` for `bg-surface` on elements that are `sticky`, `fixed` or portaled; switch only those to `bg-card`. List each change in the report.
- [ ] **Step 7: Commit** `feat(ui): Aurora theme tokens and backdrop glow`.

---

### Task 2: Button, icon button, card, badge and fields

**Files:**
- Modify: `src/components/ui/Button.tsx`, `src/components/ui/Card.tsx`, `src/components/ui/Badge.tsx`, `src/components/ui/Input.tsx`
- Create: `src/components/ui/IconButton.tsx`, `src/lib/ui/buttonClasses.ts`, `src/lib/ui/buttonClasses.test.ts`

**Produces:**
- `buttonClasses(variant: ButtonVariant, size: ButtonSize): string` and types `ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'`, `ButtonSize = 'md' | 'sm'` from `src/lib/ui/buttonClasses.ts`.
- `Button` gains `size?: ButtonSize` (default `'md'`). All other props unchanged.
- `IconButton({ label: string; icon: LucideIcon; variant?: ButtonVariant; size?: ButtonSize } & ButtonHTMLAttributes<HTMLButtonElement>)`: square, `aria-label={label}` and `title={label}`, default variant `'ghost'`.
- `Card` gains `variant?: 'raised' | 'flat'` (default `'raised'`).

- [ ] **Step 1: Write the failing test** `src/lib/ui/buttonClasses.test.ts`:
  - every variant and size returns a string containing `rounded-control`, `motion-reduce:transition-none` and `focus-visible:outline-focus`;
  - `md` contains `min-h-11` and `md:min-h-10`; `sm` contains `min-h-11` and `md:min-h-8`;
  - `primary` contains `from-violet`, `to-purple`, `text-on-accent` and `shadow-glow`; no other variant contains `shadow-glow`;
  - `secondary` contains `border-line` and `bg-transparent`;
  - no variant contains `cyan`.
- [ ] **Step 2: Run it.** Expected: FAIL (module missing).
- [ ] **Step 3: Implement `buttonClasses`** and make `Button` use it. Pinned classes: base `inline-flex cursor-pointer items-center justify-center gap-2 rounded-control font-semibold transition motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50`; `md` adds `px-4 text-[15px]`, `sm` adds `px-3 text-sm`; primary `bg-linear-to-br from-violet to-purple text-on-accent shadow-glow hover:brightness-110`; secondary `border border-line bg-transparent text-offwhite hover:bg-surface`; ghost `bg-transparent text-muted hover:bg-surface hover:text-offwhite`; danger keeps its current red classes. The spinner behaviour is unchanged.
- [ ] **Step 4: Implement `IconButton`** on top of `buttonClasses`, width equal to height, icon `h-4 w-4` with `aria-hidden`.
- [ ] **Step 5: Restyle `Card`, `Badge`, `Input`, `Textarea`, `SelectField`.**
  - `Card` raised: `rounded-surface border border-line bg-raised p-4 shadow-raised`. Flat: `rounded-nested bg-surface p-4`.
  - `Badge`: unchanged shape, `text-xs` kept (it is a pill).
  - Fields (`FIELD_CLASSES`): `rounded-control border border-line bg-raised`, `focus:border-focus`, heights `min-h-11 md:min-h-10`. Labels become `text-sm font-medium text-muted` (14 px; they are reading text). The textarea keeps its 18 px font.
- [ ] **Step 6: Run the test and all five gates.** Expected: PASS.
- [ ] **Step 7: Commit** `feat(ui): restyle buttons, cards and fields; add IconButton and button sizes`.

---

### Task 3: The other shared pieces

**Files (modify, style only):** `src/components/ui/Listbox.tsx`, `MultiSelect.tsx`, `CategorisedOptions.tsx`, `Modal.tsx`, `EmptyState.tsx`, `Skeleton.tsx`, `BulkActionBar.tsx`, `ConfirmDeleteButton.tsx`, `StepProgress.tsx`, `ReviewBatchControls.tsx`, `VoiceControls.tsx`.

No prop, behaviour, keyboard handling or markup order changes. Apply this mapping and nothing else:

| Was | Becomes |
|---|---|
| `rounded-md` / `rounded-lg` on a control or option row | `rounded-control` (option rows inside a panel: `rounded-nested`) |
| `rounded-lg` / `rounded-xl` on a panel, dialog or bar | `rounded-surface` |
| trigger or field fill `bg-surface` | `bg-raised` |
| open panel, dialog body, sticky bar fill | `bg-card` plus `shadow-raised`; dialogs and floating panels may add `backdrop-blur` with `bg-card/90` |
| `focus:border-cyan`, `ring-cyan`, cyan outlines | `focus:border-focus` / `outline-focus` |
| `text-cyan` | `text-link` |
| control height `min-h-11` | `min-h-11 md:min-h-10` |
| raw `<button>` that is plainly a primary, secondary, ghost or danger button | `Button` / `IconButton` with the same handler, label and disabled state |

- [ ] **Step 1:** Apply the mapping file by file.
- [ ] **Step 2:** All five gates. Expected: PASS, same test count as after Task 2.
- [ ] **Step 3:** In the running app, in both themes: open a `Listbox` near the bottom of a tall page (Admin, "Choose contractor") and a `Modal`; confirm keyboard use, Escape, and that the page height does not change when the list opens.
- [ ] **Step 4: Commit** `feat(ui): restyle dropdowns, dialogs and shared bars`.

---

### Task 4: Popover, Collapsible, Tabs and a preview page

**Files:**
- Create: `src/lib/ui/placePopover.ts`, `src/lib/ui/placePopover.test.ts`, `src/lib/ui/tabKeys.ts`, `src/lib/ui/tabKeys.test.ts`
- Create: `src/components/ui/Popover.tsx`, `src/components/ui/Collapsible.tsx`, `src/components/ui/Tabs.tsx`
- Create: `src/pages/UiPreview.tsx`; modify `src/App.tsx` (one route)

**Produces:**
- `placePopover(anchor: Box, panel: Size, viewport: Size, align: 'start' | 'end', gap?: number): { top: number; left: number; maxHeight: number }` with `Box = { top: number; bottom: number; left: number; right: number }`, `Size = { width: number; height: number }`. `gap` defaults to 8, and 8 is also the screen margin.
- `nextTabIndex(current: number, key: string, count: number): number`.
- `Popover({ open: boolean; onClose: () => void; anchorRef: RefObject<HTMLElement | null>; label: string; align?: 'start' | 'end'; className?: string; children: ReactNode })`.
- `Collapsible({ title: string; summary?: ReactNode; defaultOpen?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void; className?: string; children: ReactNode })`.
- `Tabs({ tabs: { id: string; label: string; count?: number }[]; value: string; onChange: (id: string) => void; label: string })` and `TabPanel({ id: string; active: boolean; children: ReactNode })`.

- [ ] **Step 1: Write the failing tests.**

  `placePopover.test.ts` (viewport 1280 x 720 unless stated; panel 320 x 200):
  - anchor `{top:10,bottom:50,left:900,right:1000}`, align `end` gives `top: 58`, `left: 680` (right edges line up).
  - same anchor, align `start` gives `left: 900`.
  - anchor near the bottom `{top:650,bottom:690,...}` flips above: `top: 650 - 8 - 200`.
  - anchor at the right edge with align `start` (`left: 1200`) clamps: `left: 1280 - 320 - 8`.
  - viewport 400 x 700, panel 320 x 200, anchor `{top:10,bottom:50,left:10,right:60}`, align `end`: `left` is 8 (clamped, never negative).
  - panel taller than the room in both directions (panel height 900): it opens on the side with more room, `top` is never less than 8, and `maxHeight` equals the room on that side minus the margin; in every other case above `maxHeight` is at least the panel height.

  `tabKeys.test.ts`: `nextTabIndex(0,'ArrowRight',3)` is 1; `(2,'ArrowRight',3)` is 0; `(0,'ArrowLeft',3)` is 2; `(1,'Home',3)` is 0; `(1,'End',3)` is 2; any other key returns `current`; `count` of 0 returns 0.
- [ ] **Step 2: Run them.** Expected: FAIL (modules missing).
- [ ] **Step 3: Implement the two pure modules.** Run the tests. Expected: PASS.
- [ ] **Step 4: Implement `Popover`.** Follow the `Listbox` panel as the model: portal to `document.body`, `position: fixed`, placed with `placePopover` from the anchor's bounding rect, closes on scroll and resize. Also: `role="dialog"`, `aria-label={label}`, focus moves into the panel on open, Escape and a pointer-down outside both call `onClose`, and focus returns to the anchor on close. Styling: `rounded-surface border border-line bg-card/90 shadow-raised backdrop-blur`, `overflow-y-auto` with the returned `maxHeight`.
- [ ] **Step 5: Implement `Collapsible`.** A header `<button>` with `aria-expanded` and `aria-controls`, showing the title (Montserrat 600), the one-line `summary` in muted text, and a chevron that rotates; the body below, not rendered when closed. Works controlled (`open` + `onOpenChange`) or on its own (`defaultOpen`, default closed). It remembers nothing. Do not use `<details>`.
- [ ] **Step 6: Implement `Tabs`.** `role="tablist"` with `aria-label={label}`, each tab a `role="tab"` button with `aria-selected`, roving `tabIndex`, arrow, Home and End keys through `nextTabIndex` (moving focus selects). Active tab: `text-link` with a 2 px `border-violet-line` underline; others `text-muted`. `count` shows as a small round counter. `TabPanel` is `role="tabpanel"` and renders children only when `active`.
- [ ] **Step 7: Add the preview page.** `UiPreview` shows, with realistic lead data as content: every `Button` variant and size, an `IconButton`, both `Card` variants, an `Input`, a `SelectField`, three `Collapsible` sections, a `Tabs` strip with panels, and a button that opens a `Popover`. Register it in `src/App.tsx` inside the signed-in shell at `/preview/ui`, only when `import.meta.env.DEV` is true, so it is not a route in the production build.
- [ ] **Step 8:** All five gates. Then check `/preview/ui` in both themes with the keyboard only.
- [ ] **Step 9: Commit** `feat(ui): add Popover, Collapsible, Tabs and a dev-only preview page`.

---

### Task 5: The menu (logo, collapse) and the phone tab bar

**Files:**
- Create: `src/lib/ui/navCollapse.ts`, `src/lib/ui/navCollapse.test.ts`, `src/hooks/useNavCollapsed.ts`
- Create: `src/components/layout/navItems.ts`, `src/components/layout/SidebarLink.tsx`
- Modify: `src/components/layout/Sidebar.tsx`, `src/components/layout/MobileNav.tsx`

**Produces:**
- `NAV_COLLAPSE_KEY = 'dreamlabs.nav.collapsed'`, `readNavCollapsed(storage: Pick<Storage, 'getItem'> | null): boolean`, `writeNavCollapsed(storage: Pick<Storage, 'setItem'> | null, collapsed: boolean): void`.
- `useNavCollapsed(): { collapsed: boolean; toggle: () => void }` (uses `localStorage`, guarded).

- [ ] **Step 1: Write the failing test** `navCollapse.test.ts`:
  - `readNavCollapsed(null)` is `false`;
  - storage returning `null` gives `false`; `'1'` gives `true`; `'0'`, `''`, `'true'` and `'{'` give `false`;
  - storage whose `getItem` throws gives `false`;
  - `writeNavCollapsed` stores `'1'` for true and `'0'` for false under `NAV_COLLAPSE_KEY`;
  - `writeNavCollapsed` with a `setItem` that throws does not throw, and with `null` does nothing.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement the module and the hook.** The hook keeps the choice in state, so the toggle still works for the session when storage is unavailable.
- [ ] **Step 4: Rebuild `Sidebar`.**
  - Move `NAV_ITEMS` (unchanged order and routes) to `navItems.ts` and one link row to `SidebarLink.tsx`, so each file stays under 150 lines.
  - The aside is `sticky top-0 h-dvh` with its own `overflow-y-auto`, flush to the left edge, `bg-nav-bg`, `border-r border-nav-line`. Width `w-56` open, `w-[60px]` collapsed, `transition-[width] duration-200 motion-reduce:transition-none`. Still `hidden` below `md`.
  - Top: the real logo image (`src/assets/logo/logo-icon.png`, never redrawn) and, when open, the wordmark "Dreamlabs" + "Sales" with "Sales" in `text-cyan` as today. Collapsed: the logo image alone, centred.
  - Rows: icon plus label. Collapsed: the label is `sr-only` and the link has `title={label}`. Active row `bg-violet/20 text-nav-text`; others `text-nav-muted hover:bg-nav-hover hover:text-nav-text`. Rows use `rounded-control`.
  - The three count badges keep their conditions and their exact `aria-label` text. The Autopilot badge changes from cyan to `bg-violet/25 text-nav-active`. Collapsed: each badge becomes a small round counter pinned to the icon's top right corner.
  - The Admin row keeps its `currentOrg?.role === 'admin'` condition.
  - Bottom (`mt-auto`): a button with `aria-expanded={!collapsed}`, text "Collapse menu" when open, and when collapsed an `sr-only` "Expand menu" plus `title`; icons `PanelLeftClose` / `PanelLeftOpen`.
- [ ] **Step 5: Restyle `MobileNav`.** Same four items and routes. Active item `text-nav-active`, others `text-nav-muted`. No cyan.
- [ ] **Step 6:** Run the test and all five gates. In the browser: collapse, reload (stays collapsed), expand, reload (stays open); Tab through the collapsed menu and confirm each link is announced by name; long pages scroll while the menu stays put.
- [ ] **Step 7: Commit** `feat(ui): collapsible menu with logo, remembered per device`.

---

### Task 6: The top bar, the "Needs you" pill and the reply banner

**Files:**
- Modify: `src/lib/jobs/view.ts`, `src/lib/jobs/view.test.ts`
- Create: `src/components/jobs/NeedsYouPill.tsx`, `src/components/jobs/JobsAnnouncer.tsx`, `src/components/layout/UserMenu.tsx`
- Delete: `src/components/jobs/JobsBar.tsx`
- Modify: `src/components/layout/TopBar.tsx`, `src/components/layout/AppShell.tsx`, `src/components/layout/ThemeToggle.tsx` (style only), `src/components/emails/ReplyAlertParts.tsx`, and `OrgSwitcher.tsx` / `UsageMeter.tsx` (style only, Task 3 mapping)

**Produces:** `pillView(items: JobItem[], seen: ReadonlySet<string>, now: Date): { text: string; tone: NotifyLine['tone']; lines: NotifyLine[] } | null` in `src/lib/jobs/view.ts`.

- [ ] **Step 1: Write the failing tests** in `view.test.ts`, reusing that file's existing job fixtures:
  - no jobs: `pillView` returns `null`;
  - whenever `summaryLine(...)` is a string, `pillView(...).text` equals it exactly;
  - with five lines' worth of jobs (mixed needs-you, running, unseen finished), `lines.length` is 5 and equals `notifyLines(items, seen, now, Number.POSITIVE_INFINITY).lines` (same order, nothing cut);
  - `tone` equals `lines[0].tone`;
  - a finished job already in `seen` is not in `lines`.
- [ ] **Step 2: Run** `npx vitest run src/lib/jobs/view.test.ts`. Expected: the new cases FAIL.
- [ ] **Step 3: Implement `pillView`** from `notifyLines` and `summaryLine`. Do not change either of those or any existing export. Run the tests. Expected: PASS.
- [ ] **Step 4: `JobsAnnouncer`.** Move the announcement code out of `JobsBar` unchanged: the `sr-only` `role="status"` span, the `announcedRef` logic, the `TONE_WORD` wording, and `notifyLines(jobs, seen, now)` with its default limit of three. It renders nothing visible.
- [ ] **Step 5: `NeedsYouPill`.** Renders nothing when `pillView` is `null`. Otherwise a pill button (`rounded-full border border-line bg-raised`, `min-h-11 md:min-h-10`, `max-w-full`, text truncates): a tone dot (`needs_you` violet, `running` cyan, `finished` success, as today), the `text`, and `aria-expanded`. It opens a `Popover` (label "Background jobs", align `end`, width `w-[min(26rem,calc(100vw-1rem))]`) holding one row per line: dot, tone word, text (wraps, not truncated), the link ("Open" for needs-you, else "View") to `line.href`, and for `dismissible` lines an `IconButton` with `aria-label` `Dismiss: ${line.text}` calling `dismiss(line.key)`. Footer link "All jobs" to `/jobs`. Following a link closes the popover. Links in the list use `text-link`.
- [ ] **Step 6: `UserMenu`.** The avatar (image or initials, as today) becomes a button with `aria-label` "Account menu" and the name beside it from `sm` up. It opens a `Popover` (label "Account", align `end`) with the name and email, the `ThemeToggle`, and a "Sign out" button calling `signOut()` as today.
- [ ] **Step 7: Rebuild `TopBar`.** Order: Focus button (left, `mr-auto`), `NeedsYouPill`, `UsageMeter`, `OrgSwitcher`, `UserMenu`. Keep `flex-wrap` and the current wrapping behaviour on phones. The Focus button keeps `aria-pressed` and its two labels; its active style becomes `bg-violet/20 text-link`. `ThemeToggle` and the Sign out button leave the bar (they live in `UserMenu`). In focus mode the pill is not rendered.
- [ ] **Step 8: `AppShell`.** Replace `{!focusMode && <JobsBar />}` with `{!focusMode && <JobsAnnouncer />}`. Main padding becomes `p-4 pb-20 md:px-7 md:py-6 md:pb-6`. Provider order unchanged.
- [ ] **Step 9: `ReplyBanner`.** Same conditions, same link target, same text, same session-only dismissal and the same `aria-label` on dismiss. One slim line: `bg-raised border-b border-line`, the link truncates to one line (`truncate`, `text-link`), and Dismiss becomes an `IconButton` with an X.
- [ ] **Step 10:** All five gates. In the browser with at least one job present: the pill shows one line; the list shows every line; Open, View and Dismiss work; Escape closes and focus returns to the pill; focus mode hides menu, pill and reply banner; at 400 px wide nothing scrolls sideways.
- [ ] **Step 11: Commit** `feat(ui): slim top bar with Needs you pill and account menu`.

---

### Task 7: Colour sweep (cyan text, overdue)

One commit of mechanical class changes across screens, kept separate so it can be redone on top of other branches if they collide. No markup, logic or copy changes.

- [ ] **Step 1: Cyan as text.** Across `src`, replace `text-cyan` with `text-link`. On any element where that happens and a `bg-cyan/NN` sits on the same element, change it to `bg-violet/15`. Replace `focus:border-cyan` and cyan focus rings with the `focus` token. **Leave alone:** the "Sales" wordmark in `Sidebar.tsx`, `src/components/auth/**`, `src/components/branding/**`, the signed-out pages, `chartColors.ts` and chart components, and tone dots (`bg-cyan` with no text).
- [ ] **Step 2: Overdue and attention.** Find where overdue follow-up dates and "needs attention" states are coloured (start from the due and overdue helpers in `src/lib/utils.ts` and their callers). Change those class strings from the red or danger text to `text-attention`, with `bg-attention-soft` where they have a tinted background. Errors, validation messages and destructive buttons stay red. If an overdue element sits next to a cyan element, report it instead of shipping it.
- [ ] **Step 3:** `git grep -n "text-cyan" -- src` returns only the files in the leave-alone list. All five gates pass. List every file changed in the report.
- [ ] **Step 4: Commit** `refactor(ui): links and active states use violet; overdue uses magenta`.

---

### Task 8: Checks and the build report

**Files:** Create `docs/UI-REFRESH-STAGE1-BUILD-REPORT.md`.

- [ ] **Step 1:** All five gates on the final revision; record file, test and module counts.
- [ ] **Step 2: Contrast table.** For each of `offwhite`, `muted`, `link`, `attention`, `danger-strong`, `success`, `warning` on `bg` and on the raised surface, in both themes; `attention` on `attention-soft`; `on-accent` on the darkest and lightest point of the primary gradient; `nav-text`, `nav-muted`, `nav-active` on `nav-bg`; and `focus` against `bg` (3:1). Give the final hex and ratio for each. Any failure is fixed (lightness only) before the report is written.
- [ ] **Step 3: Scope check.** `git diff --stat claude/ui-refresh-design...HEAD -- supabase package.json package-lock.json` is empty. List every file under `src/pages/` that changed and why.
- [ ] **Step 4: Screenshots, if a signed-in local session is available** (Kevin types the password himself; never enter credentials): before (from `origin/main`) and after, in dark and light, at 1280 px and 400 px, for Dashboard, Pipeline list, a lead record, Emails, Jobs, Settings, plus the six signed-out pages. Save under `docs/ui-refresh/stage1/`. If no session is available, say so plainly and list what was not seen.
- [ ] **Step 5: Write the report:** what was built per task with commit hashes; gate results; the contrast table; every deviation from this brief and why; every place a one-off style looked broken under the new tokens and what was done; what was not verified. Then stop. No push, merge, deploy or vault sync.

## Out of scope for this brief

- Any change to a screen's layout, the lead record, Settings grouping, filters or tables (stage 2, each with its own design).
- Page title and section title sizes inside pages.
- Replacing raw `<button>` elements inside screens.
- The sign-in redirect bug (`docs/SIGNIN-REDIRECT-BUILD-BRIEF.md`).
