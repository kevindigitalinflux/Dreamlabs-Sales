# Build brief: lead readiness badge (Build B, part 3d) and autopilot reliability fixes

You are Codex, the builder. Claude is the architect and reviewer. Kevin directs (authorized this scope on 2026-10-26).

Work only in this worktree (`C:/Users/kevin/Projects/dreamlabs-sales-readiness`, branch `codex/readiness-and-fixes`, based on `origin/main` at `ece88ed`). Do not touch any other checkout. Dependencies are installed (`npm ci` was run).

## Read first

1. `CLAUDE.md` and `AGENTS.md` for project conventions and safety rules.
2. Part 1 spec: `docs/superpowers/specs/2026-10-19-deepfind-one-engine-design.md`, section **3d Ready / Needs work** (binding), and the "Build B" paragraph in `docs/superpowers/specs/2026-10-19-deepfind-effort-and-matching-design.md`.
3. Part 2: `docs/TODO.md` section C items 8, 9, 10, 11.
4. The phone-numbers work just merged (`docs/PHONE-NUMBERS-BUILD-REPORT.md`): leads now carry `phone_meta`, contacts carry `phone_kind`, and `src/hooks/useLeads.ts` selects contact phone fields. Your readiness rule must not break these.

## Part 1: readiness badge (3d only)

Build exactly 3d. **Do not build 3e** (smart depth, parallel leads): it stays for a later brief.

- Migration `supabase/migrations/065_lead_readiness.sql` (065 is reserved for this; the highest applied is 068, a gap is intended). Add to `public.leads`: `readiness text CHECK (readiness IN ('ready','almost','needs_work'))` and `readiness_missing text[]`. Null means "Not checked". Additive only. Do not weaken any RLS, grant or guard. Decide, and record in the report, whether clients may write these columns: preferred answer is that only server code (service role in `run-deep-find`) writes them, so add no UPDATE grant if the existing grants model allows it; check how `leads` UPDATE grants work (table-wide versus column-level) and follow the safest result.
- Write a rollback audit `supabase/audits/065_lead_readiness.sql` in the same style as `supabase/audits/068_phone_metadata.sql`. Note: the production database must not receive throwaway auth users; keep the fixture part separate and clearly marked so Claude can run only the read-only assertions on production.
- A pure rule module with tests (failing test first). Ready = at least one named decision maker (owner-like, or any contact with a role) AND a verified email on a contact or the lead AND a confirmed website. Almost = exactly one of those missing; `readiness_missing` says which. Needs work = two or more missing, OR the website/company is flagged as a likely wrong match (different company website, foreign phone numbers on a lead with country GB: reuse the shared `phoneNumbers.ts` module, do not duplicate its logic). Reuse existing definitions of "verified email", "named person" and "confirmed website" from the Deep find engine (`deepFind*.ts`, `registryEvidence.ts`, `personEmailFinding.ts`); do not invent a looser meaning. Record which existing definitions you reused.
- Compute and store readiness at the end of each Deep find lead in `supabase/functions/_shared/deepFind.ts` (or the file that finishes a lead; find it), and include "Almost: no verified email" style text in the run result.
- UI: a badge on the pipeline list, the lead card and the lead page. Sortable and filterable in the pipeline list (filter next to the new "Has phone" filters from the phone build). Accessible: do not rely on colour alone, include text, focus order sensible, works at phone width in both themes. Plain, short, jargon-free text. "Not checked" for null.
- Types: update `src/types` for the new columns.

## Part 2: autopilot reliability fixes (TODO C items 8 to 11)

Failing test first for each. Read each TODO line, then find the code (hints: `loadSenderMailbox` in `supabase/functions/_shared/selectedAutopilot.ts` and `sendLeadEmail.ts`; `supabase/functions/check-sequences/`; the "Waiting to release" bulk release in `src/pages/EmailsHub.tsx`; lead selection in `run-selected-autopilot` / `selectedAutopilot.ts`).

8. A database blip while loading the sender mailbox must retry (bounded, with logging), and must not be treated as "not verified" and cancel the day's run. A real "not verified" still stops safely.
9. A parked lead must not skip a follow-up step when the daily `check-sequences` runs before the parked draft is reviewed. Make `check-sequences` leave a lead with a parked, unsent draft alone, and prove Review and send still advances exactly once.
10. Parked and interrupted autopilot drafts must not be bulk-releasable from "Waiting to release". Filter them out of bulk release; they stay reviewable one by one with their needs-input context.
11. A later run must not pick a lead that still has an unsent parked draft from an earlier run. Add the guard in lead selection.

If any of these turns out to need a migration, STOP that item, record it in the report, and do not invent one. Keep behaviour changes minimal and explained.

## Constraints

- TDD: failing test first, then implementation.
- Never swallow errors with a bare `catch {}`; log with context.
- Do not change existing RLS, grants, guard triggers, review-before-send, usage caps or reserve behaviour.
- Do not call any external service. Do not push, merge, deploy, apply migrations, or write to any remote or to Supabase. No real credentials, emails or messages.
- Dummy env values only for local runs (`VITE_SUPABASE_URL=http://127.0.0.1:54321`, `VITE_SUPABASE_ANON_KEY=local-test-placeholder`). Do not add dependencies.
- Plain, short, jargon-free user text. Components under about 150 lines where practical.
- Stage explicit file paths only; never commit CRLF/LF noise. Small commits with `git -c core.hooksPath=NUL commit`, each ending with `Co-Authored-By: Codex <noreply@openai.com>`.

## Gates

`npx tsc --noEmit`, `npx vitest run`, `npm run build`, `git diff --check`, and `node scripts/places-edge-typecheck.mjs` if the edge graph changed. Report exact counts. Baseline before your changes: 157 files / 2,454 tests pass.

## Deliver

Write `docs/READINESS-AND-FIXES-BUILD-REPORT.md`: what was built per part, files changed, gate results, decisions where the spec was silent, what was not verified (Deno runtime, browser, phone width, the unapplied migration, live runs), and the exact list of edge functions that would need deploying. Then stop. Claude reviews before any merge.
