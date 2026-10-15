# Next steps (the to-do list for Codex and Claude)

Updated 2026-10-15 (checkpoint). Exact resume point: `docs/HANDOFF.md`. Order matters. Roles are the defaults of the shared workflow (vault `_Team/Shared agent workflow.md`): either agent may plan or build when Kevin confirms and records the assignment. Kevin merges unless he authorizes otherwise.

## 0. Right now (Kevin + Architect)
- [x] Kevin reran Deep find on Love Living after `4eae38d`; Claude's 2026-10-15 handoff records 3 addresses / 3 phones, checker results, and no duplicate suggestion. Codex did not repeat this live check.
- [ ] Hostinger snapshot of the VPS expires 2026-10-15 12:39 UTC: refresh before any VPS change.

## 1. Stage 2: "Fill in missing details" and "Find decision maker" as background jobs (Builder, after the Architect's short spec)

Build checkpoint (Codex, 2026-10-15): branch `codex/stage2-background-lookups`, local only. **Not ready to apply/deploy** until the security/data questions in `docs/HANDOFF.md` are resolved.
- [x] Separate scrape-budget fix: 30 s downstream reserve plus 2 s overhead, minimum scrape 10 s, per-call client timeout and no-refund tests.
- [x] Pure lookup rules, guarded queue runner, cron/create/cancel endpoint and worker fallback.
- [x] Jobs source, mapper, results route, existing enrichment review UI, and both buttons switched to queue creation.
- [x] Draft migration 061 and rolled-back audit written (neither executed; migration explicitly refuses to apply while blocked).
- [ ] Resolve result SELECT/review permissions: Stage 2's org-wide access versus existing `can_view_lead` restriction. SELECT policy withheld; review RPC fails closed.
- [ ] Resolve deleted-lead results: schema says cascade, edge-case text says retain a skipped row. No new retention semantics invented.
- [ ] Claude reviews implementation, database draft and audit; complete the blocked policy/RPC and extend the audit for the ruling.
- [ ] Kevin authorizes/applies the reviewed migration, then authorizes deployments and live UI/usage checks. No merge/push/deploy authorization exists for this branch.
Why: both buttons run in one browser request today; adding worker calls (scraper up to 25 s, email checks up to 20 s each) would time out. Make them queued background jobs that show in the Jobs tracker (`/jobs`).

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
Process: Kevin approved the Stage 2 spec/build on 2026-10-15; Codex remains builder and Claude architect/reviewer. Finish the explicit blockers before approval to apply/deploy.

## 2. After Stage 2 (each needs its own short spec first; Architect)
- Firecrawl as a BYO-key provider per organisation (no global fallback), used for team/about pages when roles are missing.
- Per-organisation worker address/secret (`lookup_worker` provider) so another organisation can bring its own worker; today all four organisations share the global worker via function secrets.
- Desktop pop-up notifications for the Jobs bar.

## 3. Known small items (any Builder, tiny)
- Jobs: Jobs link not in the phone nav; light-theme muted text contrast about 4.15:1 (app-wide); other deferred minors listed in `CLAUDE.md` under "Jobs tracker and notification bar" and "Worker integration, Stage 1".
- Worker integration deferred minors: scraped address stored as "Company contact" stops a matching built guess being checked; no date on the scrape label; scrape of an email-only domain shows "could not be reached"; `MAX_VERIFY_PER_LEAD` (6) is above the worker's 5 checks per domain per minute; the worker's own timeouts (30 s check, 170 s scrape) are longer than the client's (20 s, 25 s), so slow calls are not refunded.
- Firewall reboot test for the VPS scraper container (`worker/scraper-firewall.sh`) at a maintenance window.
