# Round 2 brief: Pause/Resume, migration 070, review fixes

You are Codex, the builder. Claude is the architect and reviewer. Kevin directs and approved this round on 2026-10-28. Same worktree and branch as round 1 (`C:/Users/kevin/Projects/dreamlabs-sales-ux`, `codex/run-controls-reply-ux`, tip `f3a13c9`). Do not touch any other checkout. The original brief (`docs/RUN-CONTROLS-REPLY-UX-BUILD-BRIEF.md`) still applies; this round finishes Part 1 and fixes the review findings.

Read first: `docs/RUN-CONTROLS-REPLY-UX-BUILD-REPORT.md` (your own report), then Part 1 and Part 2 of the original brief, then migrations 048 and 049.

## Architect ruling on the open question (binding)

Pause means "do not start the next lead". It does NOT try to recall an email already handed to SMTP.
- If a lead is mid-send when Pause is pressed, that one email finishes and is recorded normally (sent row, run counters, note, enrolment). Nothing after it starts.
- The run screen shows "Pausing, finishing the current email" until that lead has finished, then "Paused".
- Do NOT reject Pause because a lead is processing.
- At most one email can complete after the user presses Pause. Say so in the report. No second email may start or be reserved after the pause transition commits.

Other binding rules:
- A paused run never auto-resumes, across days, windows or restarts. It stays paused until the user presses Resume. Spend history and counters are preserved, never reset. Resuming must not raise the daily allowance or the spend cap.
- Queued rows are preserved for paused AND user-stopped runs. Fix the recovery path you found that treats every non-active run as ended (including queued rows). Add a test for it.
- Resume re-checks everything the start path checks: sender mailbox verified, send window (Europe/London), daily allowance and send cap, spend cap and reserve, creator still an org member, lead still eligible, no unsent parked draft, lead not replied or opted out meanwhile, address not sent within the existing 14-day guard. A lead that stopped being eligible is skipped with a plain reason, never sent. If the window is closed or allowance is used up, Resume succeeds but nothing sends until the window opens; the screen says so in plain words.
- "Resume this run" is offered only on runs the user stopped (cancel_reason `stopped by user`) that still have queued leads, never on failures, completed runs or runs stopped for another reason. Only the run's creator or an org admin may pause, resume or stop. Resuming a stopped run must not create a second live run: the one-live-run-per-org-and-mode rule must hold for active AND paused, and resume must fail with a plain message if another live run exists.

## Part A: serialization and migration 070 (design first, then tests, then code)

1. Serialize pause against claiming and reserving. A lead claim and `autopilot_reserve_send` must never succeed after the pause transition has committed. Prove with tests (including concurrent pause/claim/reserve ordering and a stale worker whose run turned paused between claim and reserve). Reserve must check live run status in the same transaction that reserves, with the run row locked, as the existing reserve does for active; extend to treat paused as not allowed. Keep claim-before-send semantics, send markers and reservations intact; a reservation already acquired before pause may complete (see ruling).
2. Migration `supabase/migrations/070_autopilot_run_pause.sql`: read the LIVE definitions from 048/049 and any later migration first, never guess. Add `paused` to the status CHECK; keep the live-run unique partial index covering `active` and `paused`; extend `autopilot_runs_guard_status` so browsers may only do `active->paused`, `paused->active`, `active->cancelled`, `paused->cancelled`, and the narrowest safe `cancelled->active` for user-stopped runs only (cancel_reason exactly `stopped by user`, queued rows remaining, creator or admin, no other live run). Preferred: do the sensitive transitions (resume of a stopped run, which must re-open queue rows or re-validate) through a SECURITY DEFINER RPC with a fixed search_path and explicit auth checks, rather than loosening the browser guard further; justify the choice in the report. Column-level grants only; do not weaken any RLS, grant or guard; add a `paused_at` column only if needed to show pause duration (additive, nullable). Cron and the edge function must skip paused runs and must not treat paused as finished.
3. Rollback audit `supabase/audits/070_autopilot_run_pause.sql` in the style of 065 and 069: a clearly separated read-only block that is safe on production, and a fixture block for a disposable local database only (it may insert throwaway auth users). Neither block is run by you.
4. If you find the design cannot be made safe, stop that item and record why. Do not invent.

## Part B: run screen actions and status

Implement Part 2 of the original brief that was left pending: status line and primary actions by state: Active shows Pause and Stop; Pausing shows a disabled "Pausing, finishing the current email" plus Stop; Paused shows Resume and Stop and how long it has been paused; Stopped by the user with queue left shows "Resume this run" and "Start a new run"; Completed shows "Start a new run". Plain UK English. Real buttons, focus kept sensible after the state changes, announced with `role="status"`. Phone width and both themes.

## Part C: review fixes

1. "Needs your input" group must always start OPEN regardless of row count. Only other groups collapse above 8 rows. Test it.
2. Readiness badge: keep icon and text, add a tinted background and matching border per state (Ready green, Almost amber, Needs work red, Not checked grey) using existing tokens or soft tints of them. Recompute contrast of text on the tinted background for light and dark, all four states, and record the ratios; every one must be at least 4.5:1. Adjust until they are.
3. Greeting guard: extend with other common greetings so they are never saved as people (at least: hola, bonjour, g'day, gday, namaste, ni hao, kia ora, aloha, howdy, cheers, thanks, thank you). Prefer adding a light structural check where cheap (a greeting token anywhere in a two to three word candidate that has no surname-like second word is rejected), but keep real names such as "Hilary Hill" and "Hiroshi Tanaka" accepted; add tests for both directions.
4. Company-line phone dedupe: make the key a canonical form so the same number written as +44 and as 020 (with the lead's country GB) counts as one. Reuse `phoneNumbers.ts` normalisation with the lead's country, do not duplicate its logic. Test it.
5. Reply opened screen: tighten the hierarchy once more. Order: back link, header (business name large, subject below it in muted text), then a compact meta row (From address, time, stage chip), then the reply text card, then the actions, then the collapsed original, then Open lead as a text link in the meta row. Keep the opt-out warning box above the reply text. Do not add a fake sender name (the model has none); label the address "From". Keep all existing behaviour. This is layout and labels only.

## Constraints (unchanged, restated)

- TDD: failing test first. No bare `catch {}`; log with context, never log reply text, addresses or secrets.
- Review-before-send unchanged. Pause, Resume and Stop never send except through the existing guarded send path.
- No change to existing RLS, grants, guards, caps or reserve behaviour except the narrow, justified status changes above.
- No external service calls. Do not push, merge, deploy, apply migrations, or write to any remote or Supabase. No real credentials, mail or messages.
- Dummy env for local runs. No new application dependencies. Stage explicit paths only. Small commits with `git -c core.hooksPath=NUL commit`, each ending with `Co-Authored-By: Codex <noreply@openai.com>`.
- Do not edit the top of `AGENTS.md`, `CLAUDE.md` or `docs/HANDOFF.md` with another checkpoint block; instead, update the existing round 1 checkpoint block in place (replace it) so merging stays simple.

## Gates

`npx tsc --noEmit`, `npx vitest run`, `npm run build`, `git diff --check`, `node scripts/places-edge-typecheck.mjs`. Start from your round 1 count (180 files / 2,592 tests) and report exact counts.

## Deliver

Update `docs/RUN-CONTROLS-REPLY-UX-BUILD-REPORT.md` (replace the "not implemented" statements; keep the contrast tables current): what was built per part, concurrency proof description, files changed, gate results, decisions, what was not verified (Deno runtime, browser, phone width, themes, the unapplied migration, live runs), the exact edge functions to deploy, and the safe order (migration 070, then functions, then frontend). Then stop. Claude reviews before any merge.
