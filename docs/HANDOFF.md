# Handoff — Dreamlabs Sales (checkpoint 2026-10-15, written by Claude at Kevin's request near the weekly usage limit)

Authoritative task record. The vault copy (`Dreamlabs Sales/Handoff.md`) is a snapshot of this file, labelled with the revision below. Workflow rules: vault `_Team/Shared agent workflow.md`.

## Identity and authority
- Task ID: `worker-programme` (lookup worker -> Deep find; Stage 1 done, Stage 2 next). Project: Dreamlabs Sales. Author: Claude. Time: 2026-10-15 ~15:15 (local clock shows GMT; Kevin's timezone not confirmed).
- Outcome: Deep find and the two "lookup" buttons use the shared lookup worker (email checker, site scraper, page fetch) with per-organisation usage limits, visible in the Jobs tracker.
- Roles right now: Claude architect/reviewer, Codex builder (default). Kevin superseded the fixed-role policy on 2026-10-15: either agent may plan or build after Kevin confirms the role assignment; every role change must be confirmed and recorded.
- Active writer: nobody. Claude has stopped (usage limit). No job is running.
- Kevin's approved scope: Stage 1 (done, merged, deployed). Stage 2 is the NEXT task but is NOT started and has NO approved spec or plan yet.
- Role-change record: none yet (Codex has not taken over). Confirm with Kevin before Codex becomes architect or builder for Stage 2.
- Publishing authorization: Kevin authorised Claude to merge/push verified work and deploy edge functions during the 2026-10-14/15 session. That authorization is session-scoped; ask Kevin again for new work.
- Paid usage authorization: none. Hunter has 1 search left this month (renews 2026-10-17). No paid API fallback without Kevin's approval.
- Cross-agent call authorization: none recorded.

## Where the work is
- Repository/worktree: `C:\Users\kevin\Projects\dreamlabs-sales` (main checkout). Other worktrees exist under `.claude/worktrees/` (old: `bulk-lead-enrichment`, `decision-maker-enrichment`); leave them alone.
- Branch `main`, HEAD `f5be9b49245b449619a18a3a11dd5561b2f637b8` (pushed; equals `origin/main`). Before this handoff file was added the last code commit was `4eae38d` (scrape gate fix). Working tree clean except the CRLF/LF noise noted in AGENTS.md (never commit it).
- Specs and plans (approved): `docs/superpowers/specs/2026-10-14-worker-integration-design.md`, `docs/superpowers/plans/2026-10-14-worker-integration-stage1.md`, jobs tracker spec/plan `2026-10-14-jobs-tracker*.md`, usage quotas `2026-10-14-usage-quotas*.md`, worker phase 1 plan `2026-10-14-lookup-worker-phase1-infra.md`. Stage 2 spec/plan: not written.
- Vault: `C:/Users/kevin/OneDrive/Desktop/DI Dreamlabs Context Brain`; accepted repo docs are mirrored one-way into `Dreamlabs Sales/Repo/` by `scripts/sync-vault.sh` (git post-commit hook, this checkout only). Specs/plans are repo-authoritative; the vault copies are snapshots of `main` at the time of the last commit.

## Current state
- Completed (merged to main, tested, deployed):
  - Lookup worker live on the VPS (`https://lookup.didreamlabs.com`; scraper, email checker, page fetch; Cloudflare Tunnel; scraper egress firewall).
  - Sub-project A usage and quotas (migration 059 applied; meter in top bar).
  - Sub-project B Jobs tracker and bar (migration 060 applied; audit 11/11; live-checked: realtime, delete, phone width).
  - Sub-project C Stage 1: Deep find uses our email checker before Hunter and one browser scrape per lead when pages show nothing. `run-deep-find` deployed 2026-10-15 (code `4eae38d`). Supabase secrets `WORKER_URL`, `WORKER_SECRET` are set (names only here).
- Live evidence for Stage 1: Kevin's run on Love Living showed "Checked 2 email addresses with our own checker (0 valid, 0 not real, 2 could not be confirmed)" and the usage chip showed Email checks 2/150. The scrape did NOT run in that run (time gate was too strict); gate loosened in `4eae38d` (scrape needs more than 40 s left, 25 s timeout) and a duplicate built-address suggestion line was removed.
- In progress / partial edits: none.
- Remaining, in order:
  1. Kevin reruns Deep find on Love Living (Mr Brush & Co, `/pipeline/leads/9cb055e6-fbfb-45db-b9f8-8034090d3ab0`) and reports the step lines. Expected: a "Read ... with the browser scraper: found N addresses and N phone numbers." line and Site scrapes 0 -> 1 on the chip. If still missing: check whether `loveliving.uk` counts as a confirmed domain with no addresses on its pages (`supabase/functions/_shared/deepFind.ts`, step "1b-scrape", `hasContactDetails`, `verified`). Hunter has only 1 search left, so this run mostly exercises the worker.
  2. Stage 2 (see `docs/NEXT-STEPS.md` section 1): "Fill in missing details" (`enrichLead.ts`) and "Find decision maker" (`findDecisionMakers.ts`) become queued background jobs shown in `/jobs`, using `workerClient.ts`. Needs: kickoff questions to Kevin, a written spec (suggested path `docs/superpowers/specs/2026-10-15-background-lookups-design.md`), a plan, Kevin's approval, then build on a branch, independent review, migration (new table, audit script, Kevin applies in the SQL editor), deploy.
  3. Later: Firecrawl (BYO key per org), per-organisation worker address/secret, desktop pop-ups for the Jobs bar.
- Important implementation details:
  - Worker calls ONLY through `supabase/functions/_shared/workerClient.ts` (rules in `workerRules.ts`): reserve usage BEFORE the request, refund at most once and only if the worker did no work, fail closed, a client timeout is NOT refunded, a kind stops after limit/busy/unreachable/not-configured, 6 email checks per lead.
  - Only an address the checker calls `valid` is filled automatically; catch-all/unverifiable never count as valid; after the checker answered "could not decide", Hunter's "verified" is a suggestion, not a fill; found or guessed addresses never go into sequences automatically.
  - New realtime watches may only name tables in the `supabase_realtime` publication (deep_find_runs, deep_find_leads, autopilot_run_leads, scrape_jobs, raw_leads).
  - `deepFind.ts` imports `npm:` packages, so no test imports it; keep logic in import-free modules (like `workerRules.ts`). `deno` is not installed locally; edge functions are deployed with `npx supabase functions deploy <name> --project-ref wgomksxelyfkzepbnkdd`.
- Decisions worth keeping: see vault `Dreamlabs Sales/Decisions.md` (free tools first; Hunter only when the checker cannot decide; no n8n for new products; worker shared by Kevin's four orgs with per-org quotas; Hunter/Apollo/Firecrawl stay BYO key per org).
- Open questions for Kevin: Stage 2 kickoff (outcome and acceptance criteria, which agent plans and builds, whether review is by the other agent); call-frequency policy for cross-agent calls (workflow doc says it awaits his answer); refresh of the Hostinger snapshot.
- Known defects / risks: deferred minors are listed in `CLAUDE.md` ("Jobs tracker and notification bar", "Worker integration, Stage 1") and in `docs/NEXT-STEPS.md` section 3. `deno check` has never been run on the edge-function code. The VPS scraper firewall reboot test is pending.

## Verification and publication
- Last full checks (2026-10-15, branch `fix-scrape-gate` before merge): `npx vitest run` 76 files / 1292 tests passed; `npx tsc --noEmit` clean. Docs-only commits since then, not re-run.
- Not run: `deno check`; the live scrape path (awaiting Kevin's rerun).
- Independent review: Stage 1 had a task review per task and a final whole-branch review by a separate agent (Opus) plus a scoped re-review; the later scrape-gate fix (`4eae38d`, 3 small edits) had NO independent review: independent review pending for it (Codex or Claude can review the diff `git diff b391772 4eae38d`).
- State: merged to main and deployed: everything above. Local-only: nothing. Database migrations applied so far: up to 060 (059 and 060 applied by Kevin). No pending migration.
- Running jobs: none. Safe stopping point: now.
- Rollback: `run-deep-find` can be redeployed from an earlier commit; unsetting the `WORKER_URL`/`WORKER_SECRET` secrets makes Deep find run as before with one "not set up" line.
- Secret names and homes (values never recorded): `WORKER_URL`, `WORKER_SECRET` (Supabase function secrets; value of the second equals `WRAPPER_SECRET` in `/opt/lookup-worker/.env` on the VPS, mode 600); `REACHER_SECRET`, `SCRAPER_SECRET`, `TUNNEL_TOKEN` (VPS `.env` only); API keys in Supabase Vault / function secrets / gitignored `.env`.

## Usage and continuation
- Usage reading: Kevin reported Claude at about 97% of the weekly limit on 2026-10-15, reset Saturday 06:00 (user-reported, not telemetry; timezone unverified). Extra paid usage: none authorised.
- Last safe checkpoint: this file at the commit that adds it.
- Exact next action: Kevin reruns Deep find on Love Living and reports the step lines; then run the Stage 2 kickoff with Kevin.
- Required confirmation before takeover or publication: Kevin confirms who plans and who builds Stage 2 (record in Decisions.md); no deploy or merge of new work without Kevin's go-ahead.

## Resume prompt
Open `C:\Users\kevin\Projects\dreamlabs-sales`. Read the vault `_Team/Shared agent workflow.md`, `AGENTS.md`, `CLAUDE.md` (top section plus the entries "Jobs tracker and notification bar" and "Worker integration, Stage 1"), this file, `docs/NEXT-STEPS.md` and the Stage 1 spec. Verify `git status`/HEAD and that no one else is writing. Ask Kevin the short kickoff and obtain confirmation of roles. Continue with step 1 of "Remaining" (Love Living rerun result), then Stage 2 within Kevin's approved scope.
