# Round 3 brief: resumed-run caps, small review fixes

You are Codex, the builder. Claude is the architect and reviewer. Kevin approved this round on 2026-10-28. Same worktree and branch (`C:/Users/kevin/Projects/dreamlabs-sales-ux`, `codex/run-controls-reply-ux`, tip `e600cc9`). Do not touch any other checkout. Read your report and `docs/RUN-CONTROLS-REPLY-UX-ROUND2-BRIEF.md` first.

Claude's dry run of migration 070 on production (rolled back, nothing changed) passed: the SQL is valid and all functions behave on empty input. Do NOT change migration 070's SQL unless a fix below truly requires it; if it does, stop and say why.

## 1. Resumed runs must not wait forever on caps (must fix)
Today `resumedDecision` (`supabase/functions/_shared/runPauseRules.ts`) turns `complete_window_closed`, `complete_send_cap` AND `complete_spend_cap` into `wait` for a resumed run. Window closed may keep waiting (the next window will open; Resume was the user's explicit choice). The two caps must NOT wait: a cap never resets, so waiting blocks the org's one live run for ever.
- Send cap reached or spend cap reached on a resumed run: finish the run normally with the same finish notes as a non-resumed run (queued rows become `not_reached` with the existing cap reasons, run `completed`).
- Window closed on a resumed run: keep `wait`. The run screen text must say it will continue at the next send window and that Stop is available.
- UI (`RunControls.tsx`): the "Waiting: send allowance used" and "Waiting: spend cap" texts must no longer appear as waiting; the engine will finish the run on its next tick, so show "This run has reached its send allowance and will finish shortly" (and the spend equivalent).
- Failing tests first: resumed + send cap, resumed + spend cap, resumed + window closed (still waits), non-resumed behaviour unchanged.

## 2. Respect the run's own timezone on resume
Remove the hardcoded `'Europe/London'` for resumed runs in `selectedAutopilot.ts` `computeBounds` and in `RunControls.tsx`. Use `run.timezone` (fall back to `'Europe/London'` only when it is null). A resumed run uses today's date in that timezone with the run's own window times. Tests: a run with timezone `Europe/London` behaves as now; a run with a different timezone uses it.

## 3. Greeting guard: keep real surnames
The anywhere-in-name greeting match can reject real surnames such as Dear, Hey, Thanks, Cheers. Keep rejecting greetings at the START of a name (any of the current greeting words) and as a whole one-to-two-word candidate that is only greeting words ("Thank you", "Kia Ora"). Do not reject when a greeting word appears as the last word of a longer name that otherwise looks like a person ("Mary Dear", "John Hey" stay accepted). Tests both directions, including the existing Hilary Hill and Hiroshi Tanaka.

## Constraints
TDD, failing test first. No bare `catch {}`. Review-before-send unchanged. No migration application, no push, merge or deploy, no external service, no new dependency. Stage explicit paths only; small commits with `git -c core.hooksPath=NUL commit`, each ending with `Co-Authored-By: Codex <noreply@openai.com>`. Update the existing checkpoint block in `AGENTS.md`, `CLAUDE.md` and `docs/HANDOFF.md` in place; do not add a new one.

## Gates
`npx tsc --noEmit`, `npx vitest run`, `npm run build`, `git diff --check`, `node scripts/places-edge-typecheck.mjs`. Start from 186 files / 2,635 tests and report exact counts.

## Deliver
Update `docs/RUN-CONTROLS-REPLY-UX-BUILD-REPORT.md` with a short Round 3 section (what changed, tests, gate counts, anything not verified). Then stop.
