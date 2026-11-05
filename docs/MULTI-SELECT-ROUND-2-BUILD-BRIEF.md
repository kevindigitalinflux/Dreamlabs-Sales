# Build brief: bulk review round 2 (the screens not covered by the 50-lead build)

Builder: Codex. Reviewer: Claude. Director: Kevin. Roles unchanged. Start from `origin/main` in a fresh worktree after the email-outcome-learning round is merged or paused (one writer per checkout). Tests first, small commits, no push, merge, deploy, migration or secrets.

## Why
Kevin (2026-11-02): wherever users manually approve or dismiss several suggestions, they need multi-select with a bulk action. Round 1 (merged `d779777`) covered four screens: Deep find suggestions (`DecisionMakerReview`), `ScraperJob` ("Remove selected"), `LookupSuggestions`, and the scrape result approvals. Reuse the existing primitives: `useRowSelection`, `BulkActionBar`, `runRowBatch` in `src/lib/rowSelection.ts`, and the Round 1 patterns (select all actionable, per-row result, partial failure stays visible, plain confirm text, keyboard and screen-reader labels, the 50-item batch cap).

## Screens, in priority order (verify each exists and how it works today before changing it)
1. `EnrichmentReview` ("Fill missing details" review): Apply selected, Dismiss selected; keep the from-to diff, blank-only fill rules and `applyLeadUpdate` ordering.
2. `ReleaseQueue` (Emails, Waiting to release): add "Reject selected" next to the existing "Release selected".
3. Autopilot parked drafts: Release selected, Discard selected; parked drafts must still be excluded from bulk release elsewhere.
4. Dream Agent action rows: Confirm selected, Skip selected; every row still shows its own confirm text and nothing is written without an explicit per-row selection.
5. `ReplacementRows` and `DismissedPeople` (restore selected).
6. `LookupJob` result rows and `ImportPreview`: Apply or Skip selected.

## Rules
- No schema, RLS, grant or edge-function change. Every bulk action calls the same single-row code path in a loop with `runRowBatch`, so permissions and audit behaviour are identical to clicking each row.
- Rows the user cannot act on stay unselectable with the existing written reason.
- Partial failure: succeeded rows leave the list, failed rows stay selected with their error; one summary line.
- Components stay under 150 lines (extract sub-components); named exports; Tailwind only; loading, error, empty states; light and dark themes; 400 px width.
- Tests per screen: select all, select some, partial failure, cap, empty selection disabled.

## Deliver
`docs/MULTI-SELECT-ROUND-2-BUILD-REPORT.md`: screens done and skipped (with the reason), gate counts (`npx tsc --noEmit`, `npx vitest run`, `npm run build`, `git diff --check`, `node scripts/places-edge-typecheck.mjs` with `VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=local-test-placeholder`), what is not verified (real browser, phone width). Frontend only, so no function deploy. Then stop for Claude's review.
