# UI refresh Stage 1: build report

Date 2026-11-17. Built by Claude (Fable 5.2, finished by Sonnet 5.5) at Kevin's direction, on branch `claude/ui-refresh-stage1` in worktree `C:/Users/kevin/Projects/dreamlabs-sales-uirefresh`. Brief: `docs/superpowers/plans/2026-11-16-ui-refresh-stage1.md`. Nothing is pushed, merged or deployed.

## What was built (one commit per task)

1. **Tokens and backdrop.** New colours, raised surface, link, attention, focus, shadows and the three corner sizes in `src/index.css`; two-glow backdrop mounted in `AppShell`.
2. **Buttons, cards, fields.** `buttonClasses`, `Button` (adds `size`), new `IconButton`, `Card` (raised or flat), restyled fields (40 px from md up, 44 px on phones).
3. **Shared pieces.** Dropdowns, dialogs, bulk bar, empty state, step progress restyled; no prop changes.
4. **New shared pieces.** `Popover` (placement logic tested), `Collapsible`, `Tabs`, and a dev-only `/preview/ui` page (route exists only when `import.meta.env.DEV`).
5. **Menu.** Real logo, collapse to icons, open by default, remembered per device (private-window safe). The menu stays one file (`Sidebar.tsx`, under 150 lines) instead of the brief's `SidebarLink`/`navItems` split.
6. **Top bar.** One "Needs you" pill (`pillView`, tested) opening a list of every line; `JobsAnnouncer` keeps the screen-reader announcements unchanged; account menu on the avatar holds the theme switch and Sign out; reply banner is one slim line; old `JobsBar` deleted.
7. **Colours.** `text-cyan` became `text-link` in 46 files (auth pages, splash, charts and the wordmark deliberately left); overdue dates now use magenta (`text-attention`) on the dashboard focus list, lead cards and the pipeline table. Errors and delete buttons stay red.

## Gates on the final revision

`tsc --noEmit` clean; `vitest run` 279 files, 3,538 passed, 1 skipped; `npm run build` passes (3,000 modules); `git diff --check` clean (only line-ending notices); `node scripts/places-edge-typecheck.mjs` exit 0. No change under `supabase/`, `package.json` or the lockfile. Earlier mail-test failures were only a missing untracked dependency folder (`.superpowers/reply-edge-deps`, now linked locally); not a code problem.

## Contrast (final values, measured)

| Colour | Light on page / card | Dark on page / card |
|---|---|---|
| text | 16.4 / 18.0 | 16.4 / 14.4 |
| muted | 6.4 / 7.0 | 7.5 / 6.6 |
| link | 6.9 / 7.6 | 8.9 / 7.8 |
| attention | 5.4 / 5.9 (on its tint 5.2) | 7.3 / 6.4 (on its tint 5.6) |
| danger-strong | 5.6 / 6.2 | 6.5 / 5.7 |
| success | 5.3 / 5.8 | 9.3 / 8.2 |
| warning | 5.6 / 6.1 | 10.8 / 9.5 |
| focus ring (needs 3) | 5.1 / 5.6 | 10.8 / 9.5 |

Menu on its dark background: text 17.4, muted 5.7, active 9.4. Button text on violet 4.8, on purple 7.8. Light success (`#1D8660` to `#17734F`) and warning (`#986E03` to `#7F5C02`) were darkened because they were under 4.5 on the page background before this work.

## Deviations and caveats

- The tokens test is `tokens.test.js` (plain JS) because `@types/node` is not installed.
- Two existing tests pinned old button class names and were updated: `src/pages/Settings.test.ts`, `src/lib/deepFindControls.test.ts`.
- Task 3 only covered style mapping in the shared components; raw buttons inside screens were left (Stage 2).
- The brief's Task 6 expected `AppShell` main padding and the top bar's right padding to widen on desktop; done.

## NOT verified

No browser check was done (no signed-in session). Still to look at, in both themes: the backdrop and contrast on real screens, a dropdown or dialog not hidden behind the glow, the menu collapse and its memory after reload, the pill list and Escape focus return, the account menu, the reply banner, 400 px phone width (no sideways scroll), the six signed-out pages (they may have picked up the new button shape through `Button`), and `/preview/ui` with the keyboard. Before-and-after screenshots were not taken. Nothing on the leave-alone list was touched, but `git grep text-cyan` still shows the wordmark, auth, splash, Unsubscribe icon and chart files by design.

## Next

Kevin runs `npm run dev`, signs in himself and looks at it. Fixes from that look come first; then Stage 2 (Pipeline and lead record first), each group with its own design and mockup.
