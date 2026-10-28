# Build brief: Autopilot run controls, Replies UX, readiness colours, "Kia Ora" fix

You are Codex, the builder. Claude is the architect and reviewer. Kevin directs (approved this scope on 2026-10-28).

Work only in this worktree (`C:/Users/kevin/Projects/dreamlabs-sales-ux`, branch `codex/run-controls-reply-ux`, based on `origin/main` at `c678d73`). Do not touch any other checkout.

## Read first
1. `CLAUDE.md`, `AGENTS.md`, then the top status section of `docs/HANDOFF.md` (UX backlog list).
2. Selected-leads run: `src/components/autopilot/SelectedRunSection.tsx`, `src/hooks/useSelectedRun.ts`, `src/lib/runLeadGroups.ts`, `supabase/functions/run-selected-autopilot/`, `supabase/functions/_shared/selectedAutopilot.ts`, migrations `048_autopilot_selected_leads.sql` and `049_selected_autopilot_cron.sql` (status guard trigger `autopilot_runs_guard_status`, column grant on `status, cancel_reason`).
3. Replies: `src/pages/EmailsHub.tsx` (`replies` tab), the Replies list and opened-reply components under `src/components/` (find them), and `docs/superpowers/specs/2026-10-27-reply-alerts-design.md` section 4.
4. The readiness badge component (see `docs/READINESS-AND-FIXES-BUILD-REPORT.md`) and Deep find person parsing (`supabase/functions/_shared/deepFind*.ts`, `personEmailFinding.ts`, website people extraction).

## Part 1: run controls (selected-leads Autopilot run screen)
Today a run has Stop only (`active` to `cancelled`, reason "stopped by user"), and afterwards only "Start a new run". Kevin stopped a run after 2 of 50 sends because Deep finds were needed first.
- **Pause** keeps the run and its queue; nothing sends while paused. **Resume** continues the same run. Pause must be safe: no half-sent lead, no double send on resume, queue order kept.
- **Resume a stopped run**: offer "Resume this run" on a run stopped by the user (not one stopped for a failure, and not a completed one), only while it still has queued leads. Reuse the same run; never duplicate leads already sent or skipped.
- On resume re-check everything the start path checks: sender mailbox verified, send window (Europe/London), daily allowance, spend cap and reserve, lead still eligible, lead has no unsent parked draft, lead not replied or opted out meanwhile. A lead that stopped being eligible is skipped with a plain reason, never sent.
- Show how long a run has been paused. Decide and record what happens to a pause that spans a day or the send window (recommended: it stays paused until the user resumes, never auto-resumes).
- This likely needs a migration (`070_autopilot_run_pause.sql`): add `paused` to the `status` CHECK; update the partial unique index so one live run per org and mode still holds for `active` AND `paused`; extend the status guard so browsers may only do `active->paused`, `paused->active`, `active->cancelled`, `paused->cancelled`, and (if you support resuming a stopped run) the narrowest safe `cancelled->active`, limited to user-stopped runs. Read the LIVE constraint and index definitions from the earlier migrations first, never guess. Keep grants column-level. Do not weaken any RLS, grant or guard. Write a rollback audit `supabase/audits/070_autopilot_run_pause.sql` in the style of `065`/`069`, with a read-only production-safe block and a separate disposable-local fixture block. If you find a safer design without a migration, explain it and use it. Do NOT apply anything.
- The cron and edge function that send must skip paused runs and must not treat paused as finished.

## Part 2: run screen layout
- Sections (Sent, Skipped, Still queued, and any others) collapse and expand. The header shows label, count and a chevron. Use a real `button` with `aria-expanded` and `aria-controls`; keyboard operable; state not conveyed by colour alone.
- Lists longer than about 8 start collapsed; short ones start open. Component state only, nothing stored server-side.
- Clear status line and primary actions by state: Active shows Pause and Stop; Paused shows Resume and Stop; Stopped by user with queue left shows "Resume this run" and "Start a new run"; Completed shows "Start a new run". Plain, short, jargon-free UK English.
- Works at phone width and in both themes.

## Part 3: Replies UX
- **List rows** must look clickable: the whole row is the link or button, with a chevron, hover and focus-visible states, an unread style that is not colour-only (for example bold plus a "New" label), a preview line and relative time. Add a short hint above the list ("Select a reply to read it and answer").
- **Opened reply**: header with business name, sender name and address, received time and lead stage chip. The reply text comes first, large and readable. The quoted original email is collapsed by default under "Show original email" (accessible). Actions are grouped: primary "Draft an answer with AI", secondary "Write my own", tertiary "Mark handled", and "Open lead" as a link. Keep the opt-out and automatic-reply warnings, visually distinct. Add a clear "Back to replies". Keyboard order must make sense.
- Do not change reply detection, its effects or the draft flow behaviour.

## Part 4: readiness badge colours
Colour-code the readiness badge in every place it appears: Ready green, Almost amber, Needs work red, Not checked grey. Keep the text label and an icon so colour is never the only signal. Meet WCAG AA contrast in both themes, using existing theme tokens where possible. Record the ratios in the report.

## Part 5: "Kia Ora" false person (Deep find)
A website greeting ("Kia Ora") was saved as a person named "Kia Ora" for the 24/7 Fitness lead. Failing test first, then fix the website people extraction so greetings and common non-name phrases (kia ora, hello, hi, hey, welcome, dear, good morning and similar) are never accepted as person names, in every extraction path (check all callers). Find the real cause. Prefer a structural guard (must look like a name in a name context, not a greeting or heading) over a two-word blocklist if feasible.

Also fix: the same switchboard phone number is suggested once per person on a lead. Dedupe so a company-line number appears once, labelled as the company line. Reuse `phoneNumbers.ts`; do not duplicate its logic.

## Constraints
- TDD: failing test first, then implementation. No bare `catch {}`; log with context, and never log reply text, addresses or secrets.
- Review-before-send is unchanged. Pause, Resume and Stop never send anything except through the existing guarded send path.
- Do not change existing RLS, grants, guards, usage caps, reserve behaviour or reply alert behaviour, except the narrow status changes in Part 1.
- No external service calls. Do not push, merge, deploy, apply migrations, or write to any remote or Supabase. No real credentials, mail or messages.
- Dummy env for local runs: `VITE_SUPABASE_URL=http://127.0.0.1:54321`, `VITE_SUPABASE_ANON_KEY=local-test-placeholder`. No new dependencies.
- Components under about 150 lines where practical. Accessible, phone width, both themes.
- If anything needs a decision only Kevin can make, stop that item and record it in the report. Do not invent.
- Stage explicit paths only; no CRLF/LF noise. Small commits with `git -c core.hooksPath=NUL commit`, each ending with `Co-Authored-By: Codex <noreply@openai.com>`.

## Gates
`npx tsc --noEmit`, `npx vitest run` (dummy env), `npm run build`, `git diff --check`, `node scripts/places-edge-typecheck.mjs` (add entrypoints if missing). Record baseline counts first (expected 176 files / 2,580 tests) and report exact counts.

## Deliver
`docs/RUN-CONTROLS-REPLY-UX-BUILD-REPORT.md`: what was built per part, files changed, gate results, decisions where the brief was silent, contrast ratios, what was not verified (Deno runtime, browser, phone width, themes, the unapplied migration, live runs), the exact edge functions to deploy, and the safe order (migration, functions, frontend). Then stop. Claude reviews before any merge.
