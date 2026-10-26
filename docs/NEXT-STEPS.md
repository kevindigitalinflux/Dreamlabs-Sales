# Next steps (the to-do list for Codex and Claude)

Updated 2026-10-16 (stacked review fixes). [x] means built AND independently reviewed; local review fixes remain [ ] until rereview. Exact resume point: `docs/HANDOFF.md`. Order matters. Roles are the defaults of the shared workflow (vault `_Team/Shared agent workflow.md`): either agent may plan or build when Kevin confirms and records the assignment. Kevin merges unless he authorizes otherwise.

## 0. Right now (Kevin + Architect)
- [ ] Phone numbers: local build on `codex/phone-numbers`, tested code `1774e5b`. Read `docs/PHONE-NUMBERS-BUILD-REPORT.md`; 150 files / 2,402 tests and all local gates pass. Claude review, numeric Apollo allowance ruling, Deno/browser/provider verification and unapplied migration 068/audit remain pending. No push, merge or deployment authorized.
- [ ] Places API (New): local Enterprise build on codex/places-new; 141 files / 2,216 tests and all local gates pass. Review docs/PLACES-NEW-BUILD-REPORT.md, resolve legacy Details accounting, snapshot grants and cache lifetime; migration 067/audit/concurrency/runtime/browser/provider checks remain unrun. No publication authorized.
- [x] Platform owners: SHIPPED 2026-10-23 (`main` 9cf3eca). Migration 066 applied and its rollback audit passed; admin-users v18 and org-api-settings v22 deployed; front end live. Pending: Valentina confirms the invite modal hides the Admin role for her. Then phone numbers + WhatsApp specs. Gulf markets deferred.
- [ ] Guess-block fix merged `5bf88fa` and deployed 2026-10-22; only live UKRM verification pending (was: local `codex/guess-block-fix`, 2026-10-21): two distinct unverifiable addresses stop domain guesses; SMTP connection refusal stops immediately; existing Hunter suppression and caps remain. All gates pass (2,178 tests). Live UKRM verification and independent review remain pending; no commit or publication.
- [ ] Deep find A3 engine built locally on `codex/deepfind-a3`: bounded concurrent checks, blocked-domain stops, ranked fallbacks, dismissed_people and authorized Start fresh. Claude review, UI branch integration and live UKRM verification remain pending. See HANDOFF **Deep find A3 (engine)**. No publication authorized.
- [ ] Deep find one-engine Phase 1 (1a/1b/1c) built locally on `codex/deepfind-phase1` from `4ed8c40`: safe website links, confirmed website auto-update, owner LinkedIn search, generic change records and guarded Undo. TypeScript/build pass; 107 test files / 1,685 tests / 0 failures. Independent Claude review and browser/live checks are pending; no migration or deployment. Fix round 1 addresses I1/I2/M1/M3/M4/M7; M5 is deferred, M2 accepted, M6/M8 skipped. Exact checkpoint: HANDOFF **Fix round 1 — Deep find Phase 1**. Keep unchecked until independently reviewed; Phases 2/3 are not built.
- [ ] Person email finding Parts A-D built locally on `codex/person-email-finding`, independent Claude review pending. Common-format checks, people-time reserve, per-person reasons and the top primary company-choice button are implemented. Fix round 1 addresses I1/I2/M1/M2; the architect ruling preserves legacy behavior, including Hunter-only fills when the checker gives no answer. Independent rereview remains pending; browser/Deno/live checks remain pending. No SQL or deployment performed.
- [ ] Deep find suggestions/regions Parts A/B **built locally, awaiting Claude review** on `codex/deepfind-suggestions-regions`; tsc/build pass, 99 files / 1,550 tests. Add/Dismiss, role ordering, country and None of these are implemented. Do not mark reviewed yet.
- [ ] Migration 064 and rolled-back `supabase/audits/lead_country_dismissed.sql` **built, NOT applied/executed**. Claude reviews, Kevin applies/runs after approval; existing grants/RLS unchanged.
- [ ] After review and separate publication authorization: deploy `run-deep-find` and frontend, then check UX Tree Ireland, Add/Dismiss persistence, role mailbox order, phone width and focus. Deno/runtime checks remain pending. Full decisions/limitations in the final HANDOFF section.
- [x] Kevin reran Deep find on Love Living after `4eae38d`; Claude's 2026-10-15 handoff records 3 addresses / 3 phones, checker results, and no duplicate suggestion. Codex did not repeat this live check.
- [ ] Hostinger snapshot of the VPS expires 2026-10-15 12:39 UTC: refresh before any VPS change.

## 1. (DONE 2026-10-16, live) Stage 2: "Fill in missing details" and "Find decision maker" as background jobs (Builder, after the Architect's short spec)

Stage 2 is reviewed and LIVE at c929423 per Claude’s 2026-10-16 handoff. Kevin applied migration 061 and ran the rollback audit (63 PASS / 0 FAIL); functions and frontend deployed, live checks complete. The earlier build-only checkpoint is superseded.
- [x] Separate scrape-budget fix: 30 s downstream reserve plus 2 s overhead, minimum scrape 10 s, per-call client timeout and no-refund tests.
- [x] Pure lookup rules, guarded queue runner, cron/create/cancel endpoint and worker fallback.
- [x] Jobs source, mapper, results route, existing enrichment review UI, and both buttons switched to queue creation.
- [x] Complete reviewed migration 061 and rollback audit (applied/run by Kevin; 63 PASS, rolled back).
- [x] Result SELECT requires org membership plus `can_view_lead`; authenticated review requires membership plus `can_edit_lead` and changes only pending review to applied/dismissed.
- [x] Deleted leads cascade their result rows; `lead_count` stays a snapshot. Runner handles a vanished claim without crashing; no placeholder rows.
- [x] Apply supplied review fixes A and minors 1, 3–10, 12, 14; gates pass (82 files / 1,349 tests). See HANDOFF "Review fixes applied". Deferred items remain untouched.
- [x] Independent Stage 2 review completed; Important findings fixed in c929423 (Claude handoff).
- [x] Stage 2 migration applied, functions/frontend deployed and live UI/usage checks complete (Claude handoff). New stacked-branch publication remains unauthorized.
Original rationale: both buttons ran in one browser request; adding worker calls (scraper up to 25 s, email checks up to 20 s each) would time out. Make them queued background jobs that show in the Jobs tracker (`/jobs`).

What exists to reuse:
- Worker connection: `supabase/functions/_shared/workerClient.ts` + `workerRules.ts` (reserve usage first, refund at most once and only when the worker did no work, fail closed, stops a kind after the first limit/busy/unreachable). Tests in `src/lib/workerClient.test.ts`, `src/lib/workerRules.test.ts`.
- The per-lead logic to run in the background: `supabase/functions/_shared/enrichLead.ts` (`enrichOneLead`, used by `enrich-leads-bulk`) and `findDecisionMakers.ts` (`findAndStoreDecisionMakers`, used by `find-decision-makers`).
- The job engine pattern: Deep find (`deepFind.ts`: `runDeepFindTick`, claimed rows, wall-clock budget, cron tick via `run-deep-find`), tables `deep_find_runs` / `deep_find_leads`.
- The Jobs tracker: add ONE `JobSource` to `JOB_SOURCES` in `src/lib/jobs/sources.ts`, add its table to `JOB_TABLE` if deletable, and only watch tables that are in the `supabase_realtime` publication (an unpublished table makes Supabase reject the whole channel). Titles must name the leads.

Requirements (decided with Kevin):
- Click creates a job row and returns at once; a tick does the work (same style as Deep find); progress and results show in `/jobs`; stop and delete work like the other jobs.
- Worker calls only through `workerClient` (usage reserve/refund rules are binding). Never add found or guessed addresses to sequences; results are proposals the user reviews (review-before-send).
- Per-lead and per-day limits like Deep find (`checkRateLimit`), org keys via `resolveOrgApiKey`.
- New tables/policies need a migration + a rolled-back audit script in `supabase/audits/` (pattern: `jobs_delete_rls.sql`, `usage_quotas_*.sql`); the Architect reviews and Kevin applies migrations in the Supabase SQL editor.
- Docs: `CLAUDE.md` entry, `docs/AUTOMATIONS.md` row.
Process: Kevin approved the Stage 2 spec/build and supplied Claude's rulings on 2026-10-15; Codex remains builder and Claude architect/reviewer. Independent review precedes approval to apply/deploy.

## 2. Approved follow-ups (built locally under the approved three-part spec; rereview pending)
- Firecrawl as a BYO-key provider per organisation (no global fallback), used for team/about pages when roles are missing.
- Per-organisation worker address/secret (`lookup_worker` provider) so another organisation can bring its own worker; four organisations retain shared worker access: two via the existing fallback flag; UX Tree/Academy require WORKER_SHARED_ORG_IDS. The paid-key flag stays false for those two.
- Desktop pop-up notifications for the Jobs bar.

## 3. Known small items (any Builder, tiny)
- Jobs: Jobs link not in the phone nav; light-theme muted text contrast about 4.15:1 (app-wide); other deferred minors listed in `CLAUDE.md` under "Jobs tracker and notification bar" and "Worker integration, Stage 1".
- Worker integration deferred minors: scraped address stored as "Company contact" stops a matching built guess being checked; no date on the scrape label; scrape of an email-only domain shows "could not be reached"; `MAX_VERIFY_PER_LEAD` (6) is above the worker's 5 checks per domain per minute; the worker's own timeouts (30 s check, 170 s scrape) are longer than the client's (20 s, 25 s), so slow calls are not refunded.
- Firewall reboot test for the VPS scraper container (`worker/scraper-firewall.sh`) at a maintenance window.

## 2026-10-16 approved three-part build (local stacked branches)
- [ ] Part 1: desktop popups built on codex/popups; 84 files / 1,366 tests; tsc/build pass. M7/M8 fixed; independent rereview/browser checks pending; not deployed.
- [ ] Part 2: per-organisation worker address/secret built on codex/worker-keys; migration 062/audit unexecuted; 87 files / 1,398 tests; tsc/build pass. Review fixes built; independent rereview pending. Org admin membership ruling confirmed. Worker-only allow-list must be configured before deployment.
- [ ] Part 3: Firecrawl BYO provider built on codex/firecrawl; migration 063/audit unexecuted; 92 files / 1,463 tests; tsc/build pass. Both architect rulings answered: org admin membership required; existing non-atomic daily limiter accepted. Review fixes built, independent rereview pending. No publication authorized.

- [ ] Kevin configures WORKER_SHARED_ORG_IDS for UX Tree/Academy (paid-key fallback remains false).
- [ ] After independent rereview and separate authorization, Kevin applies 062 then 063, runs rollback audits, and authorizes functions/frontend deployment and browser/provider checks. Nothing from these three branches is deployed.

- [ ] Popup M7/M8 review fixes built and gated on codex/popups (84 files / 1,366 tests); independent rereview and browser verification pending, not deployed.

- [ ] Fix round 2: M8 transition-based episodes built and gated (84 files / 1,368 tests); independent rereview/browser checks pending. Count changes are silent; same-count re-entry notifies once.
- [ ] Fix round 2: stacked merge gated on worker-keys (87 files / 1,400 tests); M3 authorisation-loss stop/transient-read continuation built and gated on Firecrawl (93 files / 1,484 tests). Typecheck/build pass on all three; independent rereview pending, nothing deployed. Automation table/comment fixes included; Claude refreshes the vault manually because Codex commit hooks were not run.
- [x] Deep find suggestions/regions review fix round 1: I1/I2, M1/M2/M3/M4/M7 and M9 audit checks built locally; M4 can-edit flag absent, documented fallback used. M5/M6/M8 skipped as requested. Migration 064/audit remain unexecuted; rereview and publication pending.

## Deep find one engine — Phase 2 (2026-10-19)

- [ ] Scraper merged sources built on `codex/deepfind-phase2`: configured country-gated checkboxes, durable grouped review, tested merge/dedupe, registry-FK/officer-preserving approvals and shared Jobs markers. No migration. Gates: TypeScript 0 diagnostics; 113 files / 1,727 tests / 0 failures; build 0 errors. Independent Claude review remains pending; leave unchecked until reviewed. See HANDOFF section **Phase 2**.
- [ ] After review and Kevin's separate publication authorization, deploy parser/scraper functions with the frontend and verify grouped reloads, source failures, approval/officer copying, phone width, focus and both themes. Nothing from Phase 2 is deployed; Phase 3 is not started.
- [ ] Phase 2 Fix round 1: I1/I2/I3/I4/M2/M3 fixed locally from `40e4b5d`; Claude rereview pending. Registry per-company Places lookups are restored, including their extra cost. M1/M4/M5/M6 are intentionally skipped. See HANDOFF for timeout, polling and merge regression evidence.


## Deep find one engine — Phase 3a-c (2026-10-19)

- [ ] Phase 3a/b/c built locally on `codex/deepfind-phase3a`: parity matrix, Places/registry/site/Hunter/Apollo coverage, one Deep find action, blank-only automatic fields with existing Undo, and uncertain Add/Dismiss proposals. Independent Claude review is pending; do not tick until built and reviewed. See HANDOFF **Phase 3a-c**.
- [ ] Claude reviews this branch against `5720ffd0247a8d0b17f1460487c951cef5c41361`, including checker-only email writes, concurrent blank fills, owner evidence, provider caps, historical lookup routes, and scraper approval/resolution.
- [ ] After review and separate Kevin authorization: deploy frontend and `run-deep-find`, then verify a name-only Places lead, registry/own-page owner, Apollo candidates/phone, valid versus catch-all email, Add/Dismiss/Undo, phone width, focus and both themes. No deployment is authorized by this build.
- [ ] Phase 3d/e remains separate and unbuilt: readiness migration/badge, smart depth and concurrency. No SQL is required or authorized for Phase 3a-c.

Phase 3a-c gates at `2877d787d90e3a921a293ea1365accbb3239e2c5`: TypeScript 0 diagnostics; 119 files / 1,796 tests / 0 failures; build 0 errors. The checklist remains unchecked because independent review is pending.

- [x] Phase 3a-c Fix round 1: I1–I5, M1–M5 and M7 fixed locally on `codex/deepfind-phase3a` from `7892d0f`; M6/M8 skipped as requested. Implementation complete; independent rereview and publication remain pending. See HANDOFF for limits and final gates.

## Deep find effort and company matching — Build A (2026-10-19)

- Storage ruling resolved by the architect and supplied by Kevin: use each queued lead's existing `domains` JSONB; missing effort means Custom. A run-level effort column may accompany migration 065 later. No migration is part of Build A.
- [ ] Build A1/A2 implemented locally on `codex/deepfind-effort-matching`; independent Claude review pending. Evidence-based matching, Most likely/reasons, effort controls/totals, free-first conditional depth, per-lead caps and persisted policy are built. Fix-round gates: TypeScript 0 diagnostics; 128 files / 1,984 tests / 0 failures; build 0 errors. Leave unchecked until reviewed. Fix round 1 addresses all review findings; independent rereview remains pending. See HANDOFF **Build A — Fix round 1**.
- [ ] After independent review and separate publication authorization: deploy frontend and `run-deep-find`, then verify BK matching, effort/allowances, free versus deep outcomes, Undo/dismissals, keyboard focus and phone width. No publication is authorized by this build.
- [ ] Build B remains excluded and unbuilt: readiness badge, migration 065 and parallel leads. Migration needs review and Kevin's explicit authorization.

## Deep find A2 (2026-10-20)

- [ ] All four approved A2 parts are built locally on `codex/deepfind-a2`; independent Claude review is pending. Gates: TypeScript 0 diagnostics; 130 files / 2,033 tests / 0 failures; build 0 errors. See HANDOFF **Deep find A2**. Leave unchecked until independently reviewed.
- [ ] After review and separate publication authorization, verify real UKRM matching, provider/credit behavior, unverified Add/Dismiss, phone width and keyboard focus. Browser, Deno and live checks remain pending. No migration is needed or authorized.

- [ ] A2 fix round 1: review domain/contact evidence, unique-person writes, Hunter labels and local main UI integration. Keep unchecked until Claude rereview; see HANDOFF **A2 fix round 1**.
