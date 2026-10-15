# Handoff — Dreamlabs Sales (checkpoint 2026-10-15, written by Claude at Kevin's request near the weekly usage limit)

Authoritative task record. The vault copy (`Dreamlabs Sales/Handoff.md`) is a snapshot of this file, labelled with the revision below. Workflow rules: vault `_Team/Shared agent workflow.md`.

**Latest resume point:** the final section, **Review fixes applied (2026-10-15, Codex)**. Earlier sections are historical checkpoints; their unresolved database questions are superseded below. The vault snapshot has not been updated by this branch.

## Identity and authority
- Task ID: `worker-programme` (lookup worker -> Deep find; Stage 1 done, Stage 2 next). Project: Dreamlabs Sales. Author: Claude. Time: 2026-10-15 ~15:15 (local clock shows GMT; Kevin's timezone not confirmed).
- Outcome: Deep find and the two "lookup" buttons use the shared lookup worker (email checker, site scraper, page fetch) with per-organisation usage limits, visible in the Jobs tracker.
- Roles right now: Claude architect/reviewer, Codex builder (default). Kevin superseded the fixed-role policy on 2026-10-15: either agent may plan or build after Kevin confirms the role assignment; every role change must be confirmed and recorded.
- Active writer: nobody. Claude has stopped (usage limit). No job is running.
- Kevin's approved scope: Stage 1 (done, merged, deployed). Stage 2 is the NEXT task but is NOT started and has NO approved spec or plan yet.
- Role-change record: none yet (Codex has not taken over). Confirm with Kevin before Codex becomes architect or builder for Stage 2.
- Publishing authorization: Kevin authorised Claude to merge/push verified work and deploy edge functions during the 2026-10-14/15 session. That authorization is session-scoped; ask Kevin again for new work.
- Paid usage authorization: none. Hunter has 1 search left this month (renews 2026-10-17). No paid API fallback without Kevin's approval.
- Cross-agent call authorization: Kevin approved automatic cross-agent calls on 2026-10-15 (vault `_Team/Shared agent workflow.md`, "Cross-agent calls"): call at agreed review checkpoints or whenever needed and available within the approved task, without asking per call; calls are focused, bounded and read-only by default; record reason, scope and result here. Both directions (Codex plugin in Claude Code, ask-claude helper for Codex) passed live smoke tests on 2026-10-15 (per Kevin). Not authorized: paid API fallback, recursive calls, automatic repair/review loops, testing a model that is near its allowance.

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
- Open questions for Kevin: Stage 2 kickoff (outcome and acceptance criteria, which agent plans and builds, whether review is by the other agent); refresh of the Hostinger snapshot.
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
- Usage reading: the earlier 97% weekly reading (2026-10-15) was superseded the same day: Kevin reports his Claude allowance has reset (workflow doc: session/week 0% used, weekly 100% available, reset Saturday 06:00, displayed timezone unverified; a small Claude smoke test succeeded 20:41 UTC). User-reported, not live telemetry; recheck before a long step. Extra paid usage: none authorised (usage credits off, GBP 0 balance per Kevin's page).
- Last safe checkpoint: this file at the commit that adds it.
- Exact next action: Kevin reruns Deep find on Love Living and reports the step lines; then run the Stage 2 kickoff with Kevin.
- Required confirmation before takeover or publication: Kevin confirms who plans and who builds Stage 2 (record in Decisions.md); no deploy or merge of new work without Kevin's go-ahead.

## Resume prompt
Open `C:\Users\kevin\Projects\dreamlabs-sales`. Read the vault `_Team/Shared agent workflow.md`, `AGENTS.md`, `CLAUDE.md` (top section plus the entries "Jobs tracker and notification bar" and "Worker integration, Stage 1"), this file, `docs/NEXT-STEPS.md` and the Stage 1 spec. Verify `git status`/HEAD and that no one else is writing. Ask Kevin the short kickoff and obtain confirmation of roles. Continue with step 1 of "Remaining" (Love Living rerun result), then Stage 2 within Kevin's approved scope.

## Update 2026-10-15 (Claude, after the Codex calls)
- Live check: Kevin's rerun of Deep find on Love Living PASSED the scraper path: "Read loveliving.uk with the browser scraper: found 3 addresses and 3 phone numbers", checker tally "3 checked (0 valid, 1 not real, 2 could not be confirmed)", no duplicate suggestion, catch-all built addresses stayed unconfirmed.
- Codex independent review of `4eae38d` (read-only, via the Codex plugin, one round; Codex used GitHub only because its local tools failed): ONE Important finding, no Critical or Minor. A scrape admitted at `left() > 40_000` with a 25 s timeout can leave ~16 s and make the email-format checks (need > 25 s) and Hunter lists (need > 20 s) skip. Recommended fix: keep an explicit 30 s downstream reserve and a per-call scrape timeout of `min(25 s, left - 30 s - overhead)`, admit only if >= 10 s. Status: NOT fixed yet.
- Stage 2 spec written and pushed: `docs/superpowers/specs/2026-10-15-background-lookups-design.md` (commit `86a9f3c`). Kevin approved building it (and the fix above) on 2026-10-15.
- Codex BUILD attempt (branch `codex/stage2-background-lookups`, task: the scrape-budget fix, then Stage 2): FAILED before starting. Codex's local execution failed at the first command: `CreateProcess ... helper_unknown_error: setup refresh had errors` (its Windows sandbox setup). No branch, commit or file change was made; `main` is untouched at `86a9f3c`. Nothing applied or deployed.
- Exact next action: Kevin (or Codex's own session) fixes Codex's local sandbox (for example run Codex interactively in the project folder, or its sandbox/permissions setup), then re-send the same build task: the prompt is "PART 1 scrape budget fix, PART 2 Stage 2 per the spec" with the rules in `AGENTS.md`. Alternative if Kevin prefers: Claude builds it now with subagents (role change: Claude becomes builder for this task; needs Kevin's confirmation and must be recorded in Decisions.md).

## Update 2026-10-15 (Codex local build checkpoint)

### Authority and state
- Kevin explicitly assigned **Codex BUILDER, Claude architect/reviewer**, approved the Stage 2 build and scrape-budget fix, and prohibited push, merge, deploy, live SQL, all remote writes, secret reads and touching anything outside this project. No role change. This explicit prompt supplied the kickoff; no second approval was requested for the build.
- Initial checks: clean `main`, HEAD `57f0187a5ba014e5c36899990c3024416d802036`. Created **`codex/stage2-background-lookups`** from that main. Work stays local.
- **Part 1 complete. Stage 2 application code and database draft written, but Stage 2 is NOT complete or deployable.** The security/data questions below stop the affected database items, following Kevin's explicit instruction to stop instead of guessing.
- No other agent was invoked; no independent review performed. Claude review is the next step. No credential files were opened; no remote service was called by the new code/tests. Existing test fixtures use fake clients/providers.
- Commit hooks disabled per commit using `git -c core.hooksPath=NUL commit` to prevent the vault sync writing outside this project. No vault files read or changed. Do not run the vault sync within the current authorization.

### Commits
- `7420343` — fix: reserve downstream time after browser scrape (separate first commit).
- `cef0fad` — feat: add pure background lookup rules.
- `861d581` — feat: run queued lookups with guarded worker fallback.
- `5fcc2bc` — feat: draft lookup job schema and rollback audit (blocked policy explicitly marked).
- `d33d9b0` — feat: show background lookups and reviewed proposals in Jobs.
- The following checkpoint commit contains this handoff, other documentation and an explicit migration refusal guard. Use `git log 57f0187..HEAD` / `git rev-parse HEAD` for its final hash; a commit cannot contain its own hash.

### Implemented and tested
- Scrape budget: `scrapeTimeoutFor(leftMs)` returns `min(25_000, leftMs - 32_000)` or null below 10_000; Deep find passes it to the new optional per-call scrape timeout. Default worker timeout and all accounting rules retained. Tests at 39/41/42/60/100 seconds plus fake-timer timeout/no-refund case were red before implementation, then green (42 worker tests total).
- Queue runner: create validates JWT, org membership and `can_edit_lead`; service-only transactional create repeats explicit-user rights checks. Cron uses `cronSecretMatches`; cancel requires creator/admin membership. `runLookupTick` claims, rechecks rights, enforces daily limits, uses the existing enrichment/decision-maker functions, stores fixed sentences and completes jobs with fenced result writes.
- Free reader -> optional one worker scrape -> remaining registry/paid lookups. Optional callbacks preserve existing callers' behavior. Worker host passes `parseSafeWebsiteUrl`; output still passes `parseScrapeReply`. Results are proposals. No email or sequence operations added.
- Jobs: source/mapper, correct action/name/progress, pending review wins over active, creator/admin delete and stop rules, results route, steps, Apply/Dismiss, existing `EnrichmentReview`, `mergeAdditions` and `applyLeadUpdate`. Apply succeeds before marking review; write failure leaves review pending. Generic buttons queue and show Jobs links. Known-person lookup remains synchronous.
- SQL draft: tables/checks/FKs, explicit grants, ended-job delete policy, service-only create/claim/cancel/finish RPCs, retry handling and realtime publication, minute cron. **SELECT policy for result rows is withheld; review RPC raises a fixed refusal. An initial exception inside the migration transaction blocks applying the whole draft.** These must be completed before removing that guard.
- Rolled-back audit covers org job reads, own-org result read/review expectations, creator/admin/active/other-org/anon deletion, no direct client writes, service-only RPC privileges, cascades, lease retry exhaustion, old-attempt fencing, cancellation and realtime. Not executed. Success assertions for the withheld result/review policy are expected to fail against the unfinished body; they are not reported as passing.

### Decisions made by Codex
1. Added service-only create/cancel/finish RPCs beyond the specified claim RPC so queuing is transactional, cancel/result writes lock the parent, and stale responses cannot overwrite a later attempt or revive cancelled work.
2. At most one running lookup row per organisation, serialised at claim time with a transaction advisory lock. This keeps the existing count-and-log `checkRateLimit` calls sequential for this job type. Limits: 300 org leads/day, 5 per lead/day, 30 create requests/user/day, 50 leads/job. Duplicate jobs are not silently merged.
3. Stale lease is 5 minutes with at most two attempts. Invocation wall budget 140 s, lead budget 100 s; do not claim a new lead without the lead reserve. Provider checkpoints check time, job/claim state, current org membership, lead org and edit rights. Existing provider timeouts remain; cancellation cannot undo work already completed by a provider.
4. Cancel skips running rows as well as queued rows to fence late result writes. Previously completed proposals remain reviewable once the review policy is resolved. Existing stored candidates are not removed by stopping or deleting a job.
5. Decision-maker `stored` is the number the existing helper returns (available undismissed candidates, including earlier finds), not an invented count of inserts. The page links to the lead's existing contact review controls. Migration **053**, not 050, governs the current `include_in_sequences=false` default. The tentative concern about 050 was corrected after checking later migrations; no approval is required and no sequence-default change was made.
6. Added optional callbacks to the shared per-lead helpers; existing callers retain their old behavior. The worker callback executes immediately after the free website read, before paid lookups. No second free scrape is performed just to determine fallback eligibility.
7. The detail page polls every 5 s with organisation/request fencing; the central Jobs adapter uses its existing realtime + 30 s refresh. Minimal Jobs kind-label registration was necessary because its label maps were exhaustive; no Jobs page/bar layout rewrite.
8. Runtime runner integration tests are `.test.js` (included by Vite) so Deno-only imports do not enter the browser's TypeScript graph. Pure rules/mapper tests remain TypeScript. A separate temporary project-local TypeScript config checks the new edge entrypoint against the installed Supabase declarations and minimal Deno globals; this is **not** `deno check`.
9. Existing `ON DELETE CASCADE` was written as explicitly specified, but the contradictory request to retain a deleted lead as skipped was **not** invented or implemented. Resolve with Claude before finalising the schema.

### Questions for Claude / Kevin — blocking database completion
1. **Result visibility and review:** Stage 2 says org members can SELECT results; migration 057 and candidate/LinkedIn policies also require `can_view_lead`, preventing contractors reading restricted pipelines' contact details. Should `lookup_job_leads` require `is_org_member(org_id) AND can_view_lead(lead_id)`? Should review require `can_edit_lead` or only visibility + membership? Codex recommends preserving lead visibility and limiting review to editors, but has not enacted that security decision. An async question about visibility was sent; no answer received at this checkpoint. Complete the SELECT policy + review RPC and extend the audit to cover restricted leads and the agreed review rights.
2. **Deleted leads:** Should results disappear via the specified FK cascade, or remain as skipped with a nullable lead reference/name snapshot? These are incompatible data-retention rules. The draft follows the explicit FK shape, and retention is left unresolved. Do not remove the migration guard until this is settled.

### Gates and limitations
- Final code gates: `npx tsc --noEmit` **PASS**, zero diagnostics; `npx vitest run` **PASS, 81 files / 1,334 tests**, zero failed; `npm run build` **PASS**, 2,746 modules transformed. The existing Vite >500 kB chunk warning remains.
- Additional local check: `npx tsc --noEmit -p .superpowers/lookup-check/tsconfig.json` **PASS** for `run-lookup-jobs` and its imports. Minimal Deno globals + installed Supabase type mapping only; no Deno runtime installed. Ignored scratch files stay inside this project.
- `git diff --check` clean (only normal Windows LF/CRLF conversion notices).
- **NOT run/applied/deployed:** migration 061, rollback audit, any live database query or write, any edge deployment, VPS/worker action, remote API call, browser/live UI/phone-width check, or independent review. Build/test success does not validate RLS, SQL concurrency or actual EdgeRuntime behavior.
- **Next action:** Claude resolves both database questions and reviews the branch; Codex can finish the withheld policy/RPC, audit expectations and any review fixes. After that Kevin separately authorizes applying the migration and deployment. The frontend must not ship before both new tables are published; otherwise the Jobs realtime channel can reject the subscription. Part 1 also remains local and undeployed.

### Changed files (relative to starting main; 40 files including this handoff)
- Documentation: `CLAUDE.md`, `docs/AUTOMATIONS.md`, `docs/NEXT-STEPS.md`, `docs/HANDOFF.md`.
- Database/config: `supabase/migrations/061_lookup_jobs.sql`, `supabase/audits/lookup_jobs_rls.sql`, `supabase/config.toml`.
- Edge functions: `supabase/functions/run-lookup-jobs/index.ts`, `supabase/functions/_shared/lookupJobs.ts`, `lookupJobRules.ts`, `enrichLead.ts`, `findDecisionMakers.ts`, `deepFind.ts`, `workerClient.ts`, `workerRules.ts` (the latter seven share `_shared/`).
- Routes/pages: `src/App.tsx`, `src/pages/LookupJob.tsx`, `src/pages/PipelineList.tsx`, `src/pages/Jobs.tsx`.
- Hooks: `src/hooks/useLeadEnrichment.ts`, `src/hooks/useDecisionMakers.ts`, `src/hooks/useJobs.tsx`.
- UI: `src/components/jobs/JobRow.tsx`, `src/components/pipeline/EnrichmentReview.tsx`, `FindDecisionMakerPanel.tsx`, `KnownPersonArea.tsx`, `DecisionMakersCard.tsx` (the latter three share `pipeline/`).
- Browser logic: `src/lib/lookupJobs.ts`, `src/lib/applyLookupProposal.ts`, `src/lib/jobs/lookup.ts`, `src/lib/jobs/model.ts`, `src/lib/jobs/sources.ts`.
- Tests: `src/lib/workerRules.test.ts`, `workerClient.test.ts`, `lookupJobRules.test.ts`, `lookupJobs.test.js`, `enrichWorkerFallback.test.ts`, `applyLookupProposal.test.ts` (all under `src/lib/`), `src/lib/jobs/lookup.test.ts`; `vite.config.ts` adds runtime JS test discovery.

## Update 2026-10-15 (Codex database completion under Claude's rulings)

### Authority and revision
- Kevin explicitly resumed Codex as BUILDER, with Claude architect/reviewer. No role change and no unresolved kickoff question: Kevin supplied the outcome, rulings, gates and restrictions in the continuation prompt.
- Same checkout `C:\Users\kevin\Projects\dreamlabs-sales`, same branch **`codex/stage2-background-lookups`**. Verified clean starting HEAD **`86b951ffd1632069b9e70eb1ff4488bf7601d1b1`**.
- Implementation/spec/audit/test commit: **`5c836145115e9ee3b9f7a68226bd01b7ade134e5`** (`fix: complete lookup job policies under architect rulings`). A following docs-only commit contains this checkpoint, CLAUDE.md, NEXT-STEPS and AUTOMATIONS updates; use `git rev-parse HEAD` for the final revision.
- Local work only. No push, merge, deploy, live database/VPS action, secret read or SQL execution. No other writer or agent invoked. No paid fallback. No running tasks remain at handoff.
- Continued the project-only write boundary: commit hooks disabled per commit (`git -c core.hooksPath=NUL commit`), no vault writes/sync. The existing sync script would overwrite accepted `Repo/` references with branch docs; reconcile the vault separately when authorized. Workflow and vault status/decisions were read for context.

### Rulings 2026-10-15 — Claude, supplied by Kevin
1. Keep lead-level restrictions: `lookup_jobs` SELECT requires `is_org_member(org_id)`; `lookup_job_leads` SELECT also requires **`can_view_lead(lead_id)`**, the real function in migrations 018/019 and Deep find policy 057. Review requires **`can_edit_lead(lead_id)`** AND membership of the row's organisation, a non-anon signed-in caller, SECURITY DEFINER with fixed search_path, and only `review: pending -> applied/dismissed`. No other column may change.
2. Deleted leads use the specified **ON DELETE CASCADE**, removing their result rows without placeholders. `lead_count` stays the enqueue-time snapshot. An in-flight runner handles a missing lead with a plain skip reason; its finish RPC can safely return false because the row vanished.
These rulings are also recorded in the spec's **Rulings 2026-10-15** section and replace the two blocking questions above.

### Completed
- Migration 061: result SELECT policy added and review refusal replaced with the authorised transition. Explicit `auth.uid()` and `auth.role()` check rejects unsigned/anon calls; unauthorised, missing or already-reviewed rows return false. The RPC updates **only review**, including leaving `updated_at` unchanged. Fixed empty search_path and qualified public/auth references retained.
- Checked the existing completed parts: authenticated SELECT on both tables and DELETE on job headers only; no client INSERT/UPDATE or child DELETE; anon no access; job DELETE mirrors 060 (membership, creator/admin, never active), cascading to result rows. Create/cancel/finish/claim RPCs remain service-only. Claim retains atomic row locking, lease recovery and attempt fencing.
- Both tables are added to `supabase_realtime`. Cron `run-lookup-jobs-tick` remains every minute (`* * * * *`), POSTing `{"action":"tick"}` through `net.http_post`, with `x-cron-secret` read from existing Vault `cron_secret` at execution time, matching Deep find's mechanism and the AUTOMATIONS row. No secret value is in SQL. The migration refusal guard is removed.
- Rollback audit expanded using the 060 audit's borrowed lead/throwaway users pattern plus a private temporary pipeline. Checks cover own-org headers, hidden results and pending counts, view-only member read/no-review, edit rights without membership, both allowed transitions, rejected invalid/repeated/non-pending transitions, every non-review column unchanged, other-org/anon denial, direct write/claim denial, creator/admin/non-active delete rules, job/lead cascades, immutable count snapshot and harmless finishing of a vanished claim. Existing lease/cancellation/realtime checks retained. **Audit not run.**
- Confirmed `src/lib/jobs/sources.ts` queries result rows through the browser's signed-in Supabase client; `mapLookupJob` counts only those returned rows for `needsYou`. No service aggregation bypass or header-count substitution; no adapter change needed.
- Added a runner regression: deleted lead returns the fixed missing-lead skip reason; a false finish result is harmless; no providers or rate-limit reservations occur. Existing runner implementation already handles this case, so no production TypeScript change was needed.

### Decisions made by Codex
1. Implemented Claude's rulings exactly; no new visibility or retention rule. Kept the review RPC's boolean contract: false for unavailable/unauthorised/non-pending rows, error for invalid review choices or missing authenticated identity.
2. Left `updated_at` unchanged on review because the ruling permits changing only `review`. Audit compares complete row JSON excluding `review`, not merely the proposal payload.
3. Used a throwaway private pipeline to make audit visibility deterministic regardless of the borrowed lead's original sharing. The final exception rolls back the pipeline move, membership changes, deletion and all fixtures. No audit execution was attempted.
4. Kept existing grants/claim/cron/realtime code after checking it against 057, 060 and AUTOMATIONS; only the withheld policy/RPC, guard and explanatory comments needed migration changes.

### Gates, remaining work and resume
- `npx tsc --noEmit`: **PASS, zero diagnostics**.
- `npx vitest run`: **PASS, 81 files / 1,335 tests, zero failures** (one added test). Focused runner check also passed: 1 file / 11 tests.
- `npm run build`: **PASS, 2,746 modules transformed**. Existing Vite >500 kB chunk warning remains.
- `git diff --check`: clean apart from normal LF/CRLF conversion notices. Explicit files staged; both new commits include the Codex trailer.
- **NOT applied/deployed/run:** migration 061, rollback audit, any production SQL, any edge/worker/frontend deployment, browser/live/phone checks or independent review. Build gates do not validate SQL syntax, RLS behaviour, concurrency or actual EdgeRuntime execution. No Deno check this continuation; previous local TypeScript shim check remains historical evidence only.
- Independent review is pending for the full branch, including this database completion. No implementation question remains for Kevin. Next: Claude reviews the branch at final HEAD (code at `5c83614`), especially 061/audit and the previous application changes. Kevin then separately authorizes/applies reviewed SQL and deployment; do not ship the frontend before the new tables exist in realtime.
- Resume: read this section and the spec's rulings, verify branch/HEAD/status, then perform the independent review. All work remains local; application, publication and live checks are not authorised by this continuation.

## Review fixes applied (2026-10-15, Codex)

### Authority and revision
- Kevin continued Codex as BUILDER on `codex/stage2-background-lookups`, starting from clean HEAD `0a8f386`. Same checkout; no role change or unanswered kickoff item. Kevin supplied the independent review findings and reported no Critical issues. This continuation implements A and minors 1, 3–10, 12 and 14 only.
- One local fix commit includes code, regression tests, migration/audit edits and this checkpoint. Use `git log 0a8f386..HEAD` and `git rev-parse HEAD` for its exact revision; this document cannot contain its own commit hash. Explicit files staged with the required Codex trailer.
- No push, merge, deployment, live Supabase/VPS action, SQL execution, credential read or paid fallback. No other agent invoked. Commit hook disabled for this commit (`git -c core.hooksPath=NUL commit`) to preserve the continuation's project-only write boundary and avoid overwriting accepted vault `Repo/` references with branch work. Vault remains stale; no sync run.

### Implemented
- Wall budget is **130,000 ms**, explicitly mirroring Deep find. `startedAt` is captured as the first handler statement and passed to both create and cron ticks, including all validation time. A **110,000 ms lead reserve** covers the existing 100,000 ms lead budget plus 10,000 ms for final persistence; the existing 10,000 ms checkpoint margin remains. The runner rechecks after claim/job read, bounds the lead deadline by request end, and checks time again after permission RPCs. If a slow claim exhausts the reserve, that row is skipped with a plain retry reason, without providers or daily lead reservations.
- Claim locks a deterministic set of parent job rows first (`FOR UPDATE ... SKIP LOCKED`), before result rows. Lease recovery, cancellation cleanup, header completion and claims all operate only on that locked set. Function bodies only changed; service-only RPC grants and security settings are unchanged.
- Worker fallback calls `scrapeTimeoutFor` and accepts only the lead's saved `lead.website`, never a Google Places website proposal. Free-reader and ordinary provider behavior otherwise stay intact.
- Creator membership/edit loss at later checkpoints becomes `skipped` with the existing plain reason; database errors remain failures. Catches in runner, endpoint and result page log a fixed context plus error name/unknown, or database error code only, never message/details. Database read errors retain their code for classification.
- The 30-create/day allowance is reserved only after valid body, visible leads in one org, membership and every edit-right check.
- Ended/cancelled job progress and names use visible result rows, including zero rows after cascade/RLS filtering. Active jobs retain the enqueue snapshot total. The results page clears its 5-second interval on completed/cancelled status; manual review/stop refreshes still work.
- Both start notices use `1 lead`. The existing lead-contact realtime channel also listens to published `lookup_job_leads` updates scoped to that lead and reloads contacts when its lookup completes. No known decision-maker-refresh gap remains for that completion path. The published-table comment includes both lookup tables.
- Rollback audit adds actual anon-role SELECT attempts on both tables (zero rows or permission denial expected) plus active cron name/schedule and whole-command comparison against the Vault-subquery form, without logging the command or reading its secret value. Its final `RAISE EXCEPTION` remains. **Not executed.**

### Verification and remaining work
- Test-first run reproduced **11 failures** covering the requested timing, quota, permissions, fallback, logging and progress changes; then focused tests passed **5 files / 48 tests**. Fixtures use fake clients/providers only.
- `npx tsc --noEmit`: **PASS, zero diagnostics**.
- `npx vitest run`: **PASS, 82 files / 1,349 tests, zero failures** (14 added tests).
- `npm run build`: **PASS, 2,747 modules transformed**; existing >500 kB bundle warning remains.
- Additional `npx tsc --noEmit -p .superpowers/lookup-check/tsconfig.json`: **PASS** using the existing ignored local Deno shim, not `deno check`. `git diff --check`: clean.
- **Still NOT applied/deployed/audited live:** migration 061, rollback audit, edge function, frontend or worker. No SQL concurrency/RLS runtime verification or browser/phone/live UI checks. These gates do not prove live database or EdgeRuntime behavior. The initial independent review is Kevin-supplied; this exact fix revision has not had an independent rereview.
- Deferred exactly as requested: `(org_id,status)` index, `getUser()` per refresh, removing unused `DecisionMakerReview.tsx`, and the spec-edit process note. No outstanding implementation question for Kevin.
- Resume: inspect this commit against the supplied findings, especially SQL lock ordering and audit assertions. After independent rereview, Kevin must separately authorize applying SQL and deploying. Publish neither frontend nor its new subscriptions before migration 061 is applied. No background work remains running at handoff.

## Update 2026-10-16 (Claude): Stage 2 LIVE
- Merged to `main` at `c929423` (Codex built on `codex/stage2-background-lookups`; independent Opus review found no Critical issues; Important findings fixed in `c929423`). Migration `061_lookup_jobs.sql` APPLIED by Kevin (SQL editor, returned cron job id 7). Audit `supabase/audits/lookup_jobs_rls.sql` run by Kevin: 63 PASS, 0 FAIL, rolled back. Edge functions `run-lookup-jobs` (verify_jwt=false, required for the cron call) and `run-deep-find` (scrape time reserve) deployed from `c929423`. Site build live (bundle contains `lookup_job_leads`).
- Live check (Claude, signed in as the Mr Brush & Co account): "Find decision maker" on Love Living created a job, the cron tick completed it in under a minute ("Found 0 people", Hunter exhausted), it shows in `/jobs` ("Find decision makers: Love Living, 1 of 1 leads done"). "Fill missing details" on Creative Works London created a job, found a phone on the site, `/jobs` showed "Needs you ... 1 lead has details to review" (tab title (1)), `/jobs/lookup/:id` showed the proposal with Review and apply / Dismiss; Dismiss set `review = dismissed` and left the lead unchanged.
- Not live-checked: Apply (writes to the lead), Stop on a running lookup job, Delete of a lookup job through the UI, phone width of `/jobs/lookup/:id`, light theme. Two test jobs remain in Mr Brush & Co (finished, deletable from `/jobs`).
- Minor to track: an `enrich` proposal can differ from the lead's value only by formatting ("+44 (0) 207 735 4316" vs "020 7735 4316"); pre-existing enrich behaviour, could be normalised later. Reviewer minors deferred: index on (org_id,status), `getUser()` per Jobs refresh, unused `DecisionMakerReview.tsx`.
- Remaining roadmap: Firecrawl (BYO key per org), per-organisation worker address/secret, desktop pop-ups. Each needs a kickoff with Kevin and a spec first.
- Codex setup facts: `~/.codex/config.toml` has `sandbox_mode = "danger-full-access"` (Kevin's choice, backup in `C:/Users/kevin/.agent-collaboration/`); the Codex PLUGIN path (`/codex:rescue`) still failed with `setup refresh had errors` because its shared runtime keeps the old setup; direct `codex exec -s danger-full-access -C <project> -` worked and is how Stage 2 was built.

## Update 2026-10-16 (later, Claude): Stage 2 live checks COMPLETE
Verified live on the deployed site with a throwaway lead (since deleted): Apply (phone written to the lead, review `applied`), Dismiss (lead unchanged), Stop (a 10-lead job stopped mid-run: status cancelled, 6 done, 4 skipped; a stopped job with unreviewed proposals correctly shows under "Needs you"), Delete from the page (dialog warns that unreviewed proposals are removed too; job and rows gone, leads untouched), phone width of `/jobs/lookup/:id` (no sideways scroll at 400 px), light theme (sampled text at least 4.5:1). Jobs complete within seconds because the create call kicks an immediate tick (the minute cron is the backstop). All test jobs and the test lead were removed (org back to 58 leads). Nothing from Stage 2 remains unchecked.
Next (each needs Kevin's kickoff answers and a spec first): Firecrawl (BYO key per org), per-organisation worker address/secret, desktop pop-ups for the Jobs bar. Kevin asked on 2026-10-16 for Codex to build them with a model he called "SOl 6.1": the exact model name must be confirmed (Codex config currently `model = "gpt-6-astra"`).
